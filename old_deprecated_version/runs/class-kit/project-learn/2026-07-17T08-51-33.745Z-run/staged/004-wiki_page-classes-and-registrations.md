# Classes and registrations

ClassKit exposes concrete, product-scoped classes for discovery and registration, with service-enforced gates for product access, class availability, membership, capacity, approval, cancellation, and stock restoration.

## Browser and API boundary

The supported browser entry point is the published `@class-kit/react` SDK, not direct table or RPC access. `class-kit-sdk/src/index.ts` exports the client, ProductProvider/context, auth, profile, classes, documents, signup links, and management surfaces. For this subject, `ClassKitClient.classes.list`, `get`, `register`, and `cancelRegistration` call the `class-kit-classes` and `class-kit-register-class` Edge Functions; the functional helpers in `class-kit-sdk/src/client/product-api.ts` provide the same calls. Requests add the browser's current site URL and, for local origins, a configured product key before calling the `class-kit-*` function family.

The public class types describe `ClassVisibility` (`public`, `hidden`, `members_only`), `RegistrationPolicy` (`auto_approve`, `member_auto_approve`, `approval_required`), `MembershipRequirement` (`none`, `required`), class temporal status (`upcoming`, `started`, `ended`, `cancelled`), and registration status (`pending`, `approved`, `rejected`, `cancelled`) in `class-kit-sdk/src/types.ts`.

The Edge Functions resolve the product context and enforce the browser authority boundary. A user must have an active product-user record to register or cancel their own registration (`class-kit-register-class/index.ts`); an unauthenticated caller can only use discovery actions that resolve anonymous product context. The service role alone can execute the database registration functions, so SDK/UI calculations such as `canRegister` are advisory availability information, not a way to bypass the transactional checks.

## Class views and visibility

`class-kit-classes/index.ts` has three user-facing view families and a manager view:

- `list` and `get` return published, non-cancelled classes with `public` or `members_only` visibility. They can resolve an anonymous visitor, but only an authenticated active product user with an active membership can register for a members-only class. A requested detail field outside the small public set requires `classes.extra_fields.read`.
- `list_public` is the anonymous/public calendar view: only future, published, non-cancelled `public` classes. It reports approved capacity count and class cancellation availability but has no caller registration.
- `list_user` requires an active product user and returns future, published, non-cancelled public classes; active members additionally see `members_only` classes. It returns the caller's pending/approved registration, approved count, cancellation window, and availability.
- `list_manager` and `get_manager` require product level 75. They see all classes in the selected range, including draft, hidden, and cancelled rows, plus pending and approved counts. `ManagedClass.read_only` is true once a class is started, ended, or cancelled; `read_only_reason` reports that temporal state.

`hidden` is deliberately neither publicly discoverable nor registerable. `members_only` can appear in the caller-aware `list`/`get` result but still requires an active membership at registration time. The anonymous public-list action filters to future, published, non-cancelled public rows; the table's direct public RLS policy is stricter still, permitting only published, lifecycle-`created`, public rows. The class API derives temporal state with lifecycle precedence: lifecycle `cancelled` wins, then explicit `in_progress`/`completed`, then timestamps; otherwise the class is upcoming. Registration is open only for an upcoming, published class.

Class managers create, update, publish, return to draft, and cancel classes through `client.management.classes` in `class-kit-sdk/src/client/class-kit-client.ts`. The corresponding permissions are `classes.create`, `classes.update`, `classes.publish`, `classes.draft`, and `classes.cancel`; schedule-owned source fields cannot be supplied through ordinary class CRUD. A template may supply defaults, but only an active template can be used. Class status is `draft` or `published`; lifecycle status is `created`, `cancelled`, `in_progress`, or `completed` (`20260607134535_template_class_core.sql`).

## Registration gate order and outcomes

`register_for_class` locks the concrete class row and applies the authoritative order below. It creates at most one live (`pending` or `approved`) registration per user/class; a duplicate becomes a conflict.

1. **Class and product scope:** the class must exist in the resolved product.
2. **Class availability:** it must be published, not cancelled/in progress/completed, future-starting, and not hidden. Otherwise the result is `class_not_registerable`.
3. **Active product access:** the caller must be an active product user; otherwise `product_user_not_found` (the Edge Function normally returns 403 before the RPC).
4. **Approved capacity:** only approved registrations count toward `capacity`; a full class returns `class_capacity_full`. Pending rows do not consume class capacity.
5. **Membership eligibility:** an active membership grant is required when `membership_requirement` is `required` or visibility is `members_only`; otherwise `membership_required`.
6. **Approval policy:** `auto_approve` approves every eligible product user; `member_auto_approve` approves only a caller with an active grant and leaves a non-member pending; `approval_required` leaves the registration pending. The SQL regression test `member_auto_approve_registration.sql` covers all three outcomes and confirms that required membership rejects a non-member.
7. **Membership stock:** an immediately approved registration with an active stock or limited-stock grant consumes one unit transactionally; unavailable stock returns `membership_stock_depleted`. Non-stock grants consume zero. The registration stores both its linked grant and `stock_consumed`, and the membership ledger records the class-registration event.

The response returns the registration ID, status, stock consumed, and registration object. Listing surfaces expose `canRegister` only when there is no live registration, registration is open, the start time has not passed, and any required membership is active. This represents the same user-visible eligibility shape, but the RPC remains final authority under concurrency.

## Manager registration workflow

`class-kit-manage-registrations/index.ts` requires level 75 to list pending/approved registrations or a class roster, and `registrations.manage` to change one. The released SDK facade exposes pending/approved lists plus approve/reject; the Edge Function and current `manage_class_registration` RPC also support manager `cancel`, `approve_rejected`, and `allow_reregister` actions.

- Approve requires pending status (or converts an explicit approve of a rejected row to `approve_rejected`), a currently open class, available capacity, no live replacement registration, and usable membership stock when the original row links a grant. It changes the row to approved and records any stock consumption.
- Reject accepts a pending or approved registration. Rejecting an approved future class restores consumed stock through the membership ledger, then moves the row to rejected. `allow_reregister` leaves a rejected historical row rejected but records recovery metadata so a new registration can be created; `approve_rejected` instead restores it to approved when the ordinary approval gates pass.
- Manager cancellation accepts pending or approved rows. Future approved stock is restored and ledgered; the row becomes cancelled. A cancellation/rejection changes entitlement and availability even though history remains preserved.
- Manager changes are normally allowed only while the class is upcoming and published. There is a narrow cleanup exception: a stale pending row for an ended or cancelled class may be rejected. `list_pending` performs that rejection cleanup before returning its refreshed list.

## Cancellation and irreversible effects

A user may cancel only their own live registration through `class-kit-register-class`. Pending registrations can be cancelled even after the product's cancellation cutoff; the regression test `pending_registration_cancellation.sql` verifies this exception. An approved registration cannot be cancelled at or after `starts_at - registration_cancellation_cutoff_hours` unless an internal forced restore is used. Before the class starts, cancellation of an approved registration restores any consumed membership stock and writes a `registration_cancelled` ledger event; after start, cancellation does not restore stock. Cancellation is a durable state transition (`cancelled_at` is recorded), not deletion.

Class cancellation is stronger: `classes.cancel` calls `cancel_class_with_registration_restoration`, marks lifecycle status `cancelled`, and cancels every live registration. Approved registrations with consumed stock are restored and ledgered with `class_cancelled_restore`. The class no longer appears in discovery or registration; its cancellation reason is only explicitly exposed when the manager sets `expose_cancellation_reason_to_users`.

This lifecycle sits within the broader destructive-state boundary: product truncation permanently deletes product-scoped operational records; document pruning can remove excess non-published versions; change-request deletion is soft deletion; and membership revocation/archive/deactivation/cancellation can remove availability or entitlement. See `class-kit-api/supabase/functions/class-kit-admin-products/index.ts`, `20260702120000_truncate_product_admin_action.sql`, `20260705060042_product_documents.sql`, `class-kit-admin-product-change-requests/index.ts`, and `class-kit-memberships/index.ts`. These operations are outside the class API but can invalidate the data or grants on which class views and registrations depend.

## Operator and dogfood consumers

`apps/class-kit-admin` and `apps/demo2` are Vite consumers of the released `@class-kit/react` tag, not product-source implementations. The admin app is the deployed management/control surface; Demo2 uses `useClassKitClient` and the public class methods to list, inspect, register, and cancel. `docs/repositories/structure.md` explicitly assigns apps the consumer/admin role. Its statement that the parent documentation repository has no remote conflicts with current deterministic checkout evidence: [repository identity](../../state/class-kit/repository-identity.json) records an available `master` checkout with an `origin` remote. Treat the authored no-remote statement as stale/conflicting, not as current repository identity.

## Evidence and known gaps

Current implementation evidence is `class-kit-api/supabase/functions/class-kit-classes/index.ts`, `class-kit-register-class/index.ts`, and `class-kit-manage-registrations/index.ts`; the persistent model and transactional gates are in migrations `20260607134535_template_class_core.sql`, `20260607160000_registration_engine.sql`, `20260622150445_class_api_pattern_foundation.sql`, `20260701084833_fix_member_auto_approve_registration.sql`, and `20260702055851_allow_pending_registration_cancellation_after_cutoff.sql`. Focused SQL regression coverage exists for member auto-approval/membership requirement and the pending-after-cutoff cancellation exception.

Known gaps: this snapshot has no focused regression test for visibility/listing permutations, capacity races, manager recovery actions, class-wide cancellation restoration, public-field disclosure policy, or the browser/SDK authority boundary. Those behaviors are implementation-grounded above but should not be treated as independently regression-verified.
