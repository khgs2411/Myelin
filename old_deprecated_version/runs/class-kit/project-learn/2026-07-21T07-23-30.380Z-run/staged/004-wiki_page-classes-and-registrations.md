# Classes and registrations

ClassKit exposes concrete, product-scoped classes for discovery and registration, with service-enforced gates for product access, class availability, membership, capacity, approval, cancellation, and stock restoration.

## Browser and API boundary

The supported browser entry point is the published `@class-kit/react` SDK, not direct table or RPC access. `class-kit-sdk/src/index.ts` exports the client, ProductProvider/context, auth, profile, classes, documents, signup links, and management surfaces. For this subject, `ClassKitClient.classes.list`, `get`, `register`, and `cancelRegistration` call the `class-kit-classes` and `class-kit-register-class` Edge Functions; the functional helpers in `class-kit-sdk/src/client/product-api.ts` provide the same calls. Requests add the browser's current site URL and, for local origins, a configured product key before calling the `class-kit-*` function family.

The public class types describe `ClassVisibility` (`public`, `hidden`, `members_only`), `RegistrationPolicy` (`auto_approve`, `member_auto_approve`, `approval_required`), `MembershipRequirement` (`none`, `required`), class temporal status (`upcoming`, `started`, `ended`, `cancelled`), and registration status (`pending`, `approved`, `rejected`, `cancelled`) in `class-kit-sdk/src/types.ts`.

The Edge Functions resolve the product context and enforce the browser authority boundary. A user must have an active product-user record to register or cancel their own registration (`class-kit-register-class/index.ts`); an unauthenticated caller can only use discovery actions that resolve anonymous product context. The service role alone can execute the database registration functions, so SDK/UI calculations such as `canRegister` are advisory availability information, not a way to bypass the transactional checks.

## Class views and visibility

`class-kit-classes/index.ts` has three user-facing view families and a manager view:

- `list` and `get` return published, non-cancelled classes with `public` or `members_only` visibility. `list` omits a members-only row unless the caller has an eligible active membership; `get` returns a generic `403 forbidden` (`Class access is forbidden.`) for a requested members-only row the caller cannot use, without disclosing class or membership details. A requested detail field outside the small public set requires `classes.extra_fields.read`.
- `list_public` is the anonymous/public calendar view: only future, published, non-cancelled `public` classes. It reports approved capacity count and class cancellation availability but has no caller registration.
- `list_user` requires an active product user and returns future, published, non-cancelled public classes; active members additionally see `members_only` classes. It returns the caller's pending/approved registration, approved count, cancellation window, and availability.
- `list_manager` and `get_manager` require product level 75. They see all classes in the selected range, including draft, hidden, and cancelled rows, plus pending and approved counts. `ManagedClass.read_only` is true once a class is started, ended, or cancelled; `read_only_reason` reports that temporal state.

`hidden` is deliberately neither publicly discoverable nor registerable. `members_only` is discoverable only to a caller with an eligible active membership and requires that same eligibility again at registration time. The anonymous public-list action filters to future, published, non-cancelled public rows; the table's direct public RLS policy is stricter still, permitting only published, lifecycle-`created`, public rows. The class API derives temporal state with lifecycle precedence: lifecycle `cancelled` wins, then explicit `in_progress`/`completed`, then timestamps; otherwise the class is upcoming. Registration is open only for an upcoming, published class.

Class managers create, update, publish, return to draft, and cancel classes through `client.management.classes` in `class-kit-sdk/src/client/class-kit-client.ts`. The corresponding permissions are `classes.create`, `classes.update`, `classes.publish`, `classes.draft`, and `classes.cancel`; schedule-owned source fields cannot be supplied through ordinary class CRUD. A template may supply defaults, but only an active template can be used. Class status is `draft` or `published`; lifecycle status is `created`, `cancelled`, `in_progress`, or `completed` (`20260607134535_template_class_core.sql`).

## Structured lesson locations and autocomplete

Classes retain their nullable free-text `location` and can additionally persist a nullable, version-one `location_snapshot`; templates have the equivalent `default_location` pair. A snapshot is provider-neutral display/navigation data: label, formatted address, coordinates, opaque provider reference, and ordered attribution entries. Existing text-only rows remain valid. The stored snapshot is not an authorization input or a raw provider payload.

The text/snapshot pair is one contract rather than two independent optional fields:

| Write condition | Stored outcome |
| --- | --- |
| Non-null snapshot | Its `label` becomes the compatibility text; separately supplied text must match exactly. |
| Text without snapshot | The class remains in free-text mode. |
| Explicit `null` snapshot | Demotes the structured value while preserving its label as free text. |
| Changed or null text | Clears an existing snapshot. |
| Unchanged text with snapshot omitted | Preserves the snapshot for legacy full-form clients. |
| Both fields omitted on template-backed creation | Inherits the template's complete pair. |
| Schedule generation | Copies the pair only to newly generated classes; an existing generation conflict is not refreshed. |

Canonical customer `classes.list`/`get` responses expose nullable `locationSnapshot`; legacy customer and manager class reads use `location_snapshot`. Template reads use `default_location_snapshot`. A response family exposes only its own alias, while the nested snapshot remains snake case and includes all attribution entries. Consumers use coordinates when present and otherwise the free-text location; they must render stored attribution safely.

Location suggestions are a separate backend capability. `class-kit-locations` accepts `autocomplete` only after normal product resolution and an explicit product-scoped `locations.autocomplete` permission; role name or permission level alone is not a fallback. Its request accepts a trimmed 2–200-code-point query, limit 1–10 (default 5), and documented language/country/proximity constraints. Invalid input, authentication, or authorization fails through the normal 400/401/403 paths. A valid lookup returns either `availability: "available"` with suggestions or `availability: "temporarily_unavailable"` with an empty suggestion list. Missing configuration, timeout, network/provider failure, or an invalid provider response takes the latter HTTP-200 path, so autocomplete never blocks a free-text class or template save. The server holds `GEOAPIFY_API_KEY`; product applications receive neither it nor raw provider controls/payloads.

The backend capability has no released SDK facade in this snapshot. Product applications must not invoke the raw Edge Function; they wait for the typed facade before enabling autocomplete UI.

## Custom-data query and response boundary

Concrete classes persist object-valued `custom_data`. When a class has a template, create and update validate submitted keys and values against that template's `custom_fields`, merge its `custom_defaults`, and enforce required fields. A class without a template may still store an object, but it has no template schema validation.

The current backend class-list contract makes template policy authoritative for discovery. It applies the normal product-resolution and class-read/visibility gates first, then evaluates custom-data policy against the class's template; a template-less class never matches a custom-data filter. Stored malformed, duplicate, invalid, or legacy field definitions decode per field and fail closed: they do not make a field searchable or visible. This is a backend contract; the released SDK does not yet type or send the `fields: ["customData"]` or `filters` inputs.

| Surface | Supported input and policy gate | Outcome |
| --- | --- | --- |
| Customer backend `list` / `get` | Request `fields: ["customData"]` after ordinary class-read access. Each value must be defined by the class template, `visible`, and valid for its declared type; no extra-field permission is needed for this projection. | `customData` is absent unless requested. When requested, it contains only visible valid values; missing template policy or a template-less class returns `{}`. Raw `custom_data` never appears in customer results. |
| Customer backend `list` | Optional `filters.custom_data` after product and class visibility filtering. Every referenced field must be both `visible` and `searchable`, and every `equals` value must be valid for that field's declared type. | Matching classes satisfy every `has` key and every `equals` pair (AND semantics). Filtering alone does not add `customData` to the response. |
| Management backend `list_manager` | The same optional `filters.custom_data` grammar, after the manager's ordinary level-75 read gate. | It applies the same policy and matching rules, while the manager-shaped result retains complete stored `custom_data`. |
| Other class actions | `filters` is not accepted. | A supplied filter returns `bad_request`; filter parsing/invalid policy is rejected before class queries rather than silently broadening discovery. |

The exact filter grammar is one top-level `filters.custom_data` object with optional `has` (unique identifier-like field keys) and `equals` (identifier-like keys mapped only to finite string, number, or boolean scalar values). Missing `filters`, an empty `has` plus empty `equals`, or no `custom_data` key is a no-op. Unknown keys, duplicate `has` values, non-scalar equality values, unsupported fields, fields that are not both visible and searchable, or values invalid for the field type return `bad_request`. A valid filter whose policies have no common eligible template returns an empty list without querying classes.

## Registration gate order and outcomes

`register_for_class` locks the concrete class row and applies the authoritative order below. It creates at most one live (`pending` or `approved`) registration per customer/class; a duplicate becomes a conflict.

1. **Class and product scope:** the class must exist in the resolved product.
2. **Class availability:** it must be published, not cancelled/in progress/completed, future-starting, and not hidden. Otherwise the result is `class_not_registerable`.
3. **Active product access and linked customer:** self-service requires an active product user, then resolves that authenticated identity to its product customer; otherwise it is rejected before a class registration is written (the Edge Function normally returns 403 for missing active access). A ghost cannot use this path because it has no authenticated identity.
4. **Approved capacity:** only approved registrations count toward `capacity`; a full class returns `class_capacity_full`. Pending rows do not consume class capacity.
5. **Membership eligibility:** an active membership grant is required when `membership_requirement` is `required` or visibility is `members_only`; no grant produces `membership_required`. A membership type can bind to one active template. An unrestricted type (`template_id = null`) applies to every class, including template-less classes; a bound type applies only to a class with that exact template. A present but mismatched or template-less restricted grant produces `membership_not_eligible` when this gate is required.
6. **Approval policy:** `auto_approve` approves every eligible product user. `member_auto_approve` approves only a caller whose active grant is eligible for this class and otherwise leaves the registration pending. `approval_required` leaves the registration pending. For a public class with no membership requirement, a mismatched restricted grant is treated as no eligible grant: `auto_approve` still approves without attaching or consuming it, while `member_auto_approve` leaves the registration pending. The SQL regressions `member_auto_approve_registration.sql` and `membership_template_eligibility.sql` cover these outcomes, including required-membership rejection and template mismatch.
7. **Membership stock:** an immediately approved registration with an active stock or limited-stock grant consumes one unit transactionally; unavailable stock returns `membership_stock_depleted`. Non-stock grants consume zero. The registration stores both its linked grant and `stock_consumed`, and the membership ledger records the class-registration event.

The response returns the registration ID, status, stock consumed, and registration object. Listing surfaces expose `canRegister` only when there is no live registration, registration is open, the start time has not passed, and any required membership is eligible for the class template. This represents the same user-visible eligibility shape, but the RPC remains final authority under concurrency.

## Manager registration workflow

`class-kit-manage-registrations/index.ts` requires level 75 to list pending/approved registrations or a class roster, and `registrations.manage` to change one. The released SDK facade exposes pending/approved lists plus approve/reject; the Edge Function and current `manage_class_registration` RPC also support manager `cancel`, `approve_rejected`, and `allow_reregister` actions.

`register_customer` is the customer-canonical manager action. Its gate order is origin/product resolution, authenticated manager identity, `registrations.manage`, a product-scoped active `customer_id`, then the ordinary class availability, capacity, membership eligibility, and stock gates. It directly approves the resulting registration and records the manager as both initiator and approver. This works for linked and ghost customers alike; a ghost response has `user_id: null` and no access-user projection. An inactive customer fails with `409 customer_inactive`, before it can consume membership or class capacity. Legacy self-service registration remains linked-user-only and resolves its caller's customer internally.

- Approve requires pending status (or converts an explicit approve of a rejected row to `approve_rejected`), a currently open class, available capacity, no live replacement registration, and usable membership stock when the original row links a grant. It changes the row to approved and records any stock consumption.
- Reject accepts a pending or approved registration. Rejecting an approved future class restores consumed stock through the membership ledger, then moves the row to rejected. `allow_reregister` leaves a rejected historical row rejected but records recovery metadata so a new registration can be created; `approve_rejected` instead restores it to approved when the ordinary approval gates pass.
- Manager cancellation accepts pending or approved rows. Future approved stock is restored and ledgered; the row becomes cancelled. A cancellation/rejection changes entitlement and availability even though history remains preserved.
- Manager changes are normally allowed only while the class is upcoming and published. There is a narrow cleanup exception: a stale pending row for an ended or cancelled class may be rejected. `list_pending` performs that rejection cleanup before returning its refreshed list.

## Cancellation and irreversible effects

A user may cancel only their own live registration through `class-kit-register-class`. Pending registrations can be cancelled even after the product's cancellation cutoff; the regression test `pending_registration_cancellation.sql` verifies this exception. An approved registration cannot be cancelled at or after `starts_at - registration_cancellation_cutoff_hours` unless an internal forced restore is used. Before the class starts, cancellation of an approved registration restores any consumed membership stock and writes a `registration_cancelled` ledger event; after start, cancellation does not restore stock. Cancellation is a durable state transition (`cancelled_at` is recorded), not deletion.

Class cancellation is stronger: `classes.cancel` calls `cancel_class_with_registration_restoration`, marks lifecycle status `cancelled`, and cancels every live registration. Approved registrations with consumed stock are restored and ledgered with `class_cancelled_restore`. The class no longer appears in discovery or registration; its cancellation reason is only explicitly exposed when the manager sets `expose_cancellation_reason_to_users`.

This lifecycle sits within the broader destructive-state boundary: product truncation permanently deletes product-scoped operational records; document pruning can remove excess non-published versions; change-request deletion is soft deletion; and membership revocation/archive/deactivation/cancellation can remove availability or entitlement. See `class-kit-api/supabase/functions/class-kit-admin-products/index.ts`, `20260702120000_truncate_product_admin_action.sql`, `20260705060042_product_documents.sql`, `class-kit-admin-product-change-requests/index.ts`, and `class-kit-memberships/index.ts`. These operations are outside the class API but can invalidate the data or grants on which class views and registrations depend.

## Operator and dogfood consumers

`apps/class-kit-admin` and `apps/demo2` are Vite consumers of the released `@class-kit/react` tag, not product-source implementations. The admin app is the deployed management/control surface; Demo2 uses `useClassKitClient` and the public class methods to list, inspect, register, and cancel. `docs/repositories/structure.md` explicitly assigns apps the consumer/admin role. Its statement that the parent documentation repository has no remote conflicts with the sanitized checkout evidence inspected for this maintenance pass. Treat that authored no-remote statement as stale/conflicting, not as current repository identity; checkout identity remains run evidence rather than a canonical wiki fact.

## Evidence and known gaps

Current implementation evidence is `class-kit-api/supabase/functions/class-kit-classes/index.ts`, `class-kit-register-class/index.ts`, and `class-kit-manage-registrations/index.ts`; the persistent model and transactional gates are in migrations `20260607134535_template_class_core.sql`, `20260607160000_registration_engine.sql`, `20260622150445_class_api_pattern_foundation.sql`, `20260701084833_fix_member_auto_approve_registration.sql`, `20260702055851_allow_pending_registration_cancellation_after_cutoff.sql`, `20260719084853_membership_template_binding.sql`, and `20260720092141_customer_registration_entrypoints.sql`. The structured-location migration is `20260718090129_lesson_location_snapshots.sql`. Focused SQL regression coverage exists for member auto-approval/membership requirement, template-bound membership eligibility, and the pending-after-cutoff cancellation exception; `class-kit-classes/index.test.ts` specifically covers list omission and generic-403 detail denial for ineligible members-only classes. `class-kit-manage-registrations/index.test.ts` additionally covers direct approval and nullable-user projection for a ghost customer. Focused Edge Function regression source also covers location pair transitions, provider degradation/authorization, custom-data projection, filtering, malformed policy fail-closed behavior, and filter early-rejection in `location.test.ts`, `geoapify.test.ts`, `class-kit-locations/index.test.ts`, `class_custom_data.test.ts`, and `class-kit-classes/index.test.ts`.

Known gaps: this snapshot has no focused regression test for visibility/listing permutations outside the custom-data boundary, capacity races, manager recovery actions, class-wide cancellation restoration, public-field disclosure policy, the complete ghost-registration lifecycle, or the browser/SDK authority boundary. The current typed SDK also does not expose the backend's structured-location autocomplete or custom-data projection/filter inputs, so product applications cannot treat those raw Edge Function inputs as a supported browser facade. Those behaviors are implementation-grounded above but should not be treated as independently regression-verified.
