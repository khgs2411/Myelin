# Class discovery, registration, and lifecycle

ClassKit exposes concrete classes—not templates or schedule rules—as the units that visitors discover and users register for. This page records the current database and Edge Function contract for their visibility, registration, cancellation, capacity, and lifecycle behavior.

## Class and template state

`class_kit.class_templates` supplies defaults for future classes: `default_visibility` is `public`, `default_registration_policy` is `member_auto_approve`, `default_membership_requirement` is `none`, and `status` is either `active` or `inactive`. A class records its own copied values, so template changes do not retroactively change an existing class. Both template and class capacity values must be positive. See `class-kit-api/supabase/migrations/20260607134535_template_class_core.sql` and the create path in `class-kit-api/supabase/functions/class-kit-classes/index.ts`.

Each concrete class has two independent state fields:

| Field | Supported values | Effect |
| --- | --- | --- |
| Publication `status` | `draft`, `published` | Only published classes are discoverable or registerable. Managers can publish or return a class to draft through the class API. |
| `lifecycle_status` | `created`, `cancelled`, `in_progress`, `completed` | New classes start `created`. Cancellation is terminal for discovery and registration. Attendance starts a class (`created` → `in_progress`) and completes it (`in_progress` → `completed`). |

The database registration guard rejects a class that is not published, is cancelled/in progress/completed, or has already started (`starts_at <= now()`), returning `class_not_registerable`. This is the authoritative write gate in `class_kit_private.ensure_class_registerable`; the API's `registration_open` mirrors the user-facing condition of a published, temporally upcoming class. A class can therefore still appear in certain discovery listings after it starts or completes, but it cannot accept a new registration.

## Discovery and visibility

Visibility is one of `public`, `hidden`, or `members_only`.

| Caller and API surface | Classes returned |
| --- | --- |
| Anonymous public listing (`class-kit-classes`, `list_public`) | Future, published, non-cancelled `public` classes only. |
| Authenticated active product user (`list_user`) | Future, published, non-cancelled `public` classes; an active membership additionally reveals `members_only`. |
| Caller-aware list/detail (`list`, `get`) | Published, non-cancelled `public` and `members_only` classes; a non-member may receive the row through this surface, but cannot register for `members_only`. |
| Product manager (`list_manager`, `get_manager`) | All product classes, including drafts, hidden classes, and cancelled classes. |

`hidden` is intentionally absent from public and user discovery and is rejected by the registration guard even if its identifier is known. `members_only` has two gates: it is discoverable only to an active member in the user listing, and the registration RPC requires an active membership. The current RLS policy also permits `members_only` reads only for an authenticated product user with an active membership. These current policies are from `class-kit-api/supabase/migrations/20260702121000_public_class_discovery_non_cancelled.sql`; that migration deliberately changed the original policy so in-progress and completed classes remain readable while cancelled ones do not.

## Registration decision order

The user registration Edge Function first requires authenticated, active product-user access. It then calls `class_kit.register_for_class`, which locks the class row and applies this order:

1. The class must exist in the requested product.
2. It must be published, still `created`, not started, and not `hidden`.
3. The caller must be an active product user.
4. Approved registrations must be below capacity. Pending rows do not consume capacity.
5. The system resolves an active membership grant. A grant is required when either `membership_requirement = required` or `visibility = members_only`.
6. The registration policy determines the initial status.

The supported policies are:

| `registration_policy` | No active membership, after prior gates | Active membership |
| --- | --- | --- |
| `auto_approve` | `approved` | `approved` |
| `member_auto_approve` | `pending` | `approved` |
| `approval_required` | `pending` | `pending` |

The membership gate takes precedence over policy: a non-member cannot use `auto_approve` to bypass `required` membership or `members_only` visibility. A unique partial index permits only one live (`pending` or `approved`) registration per user/class; a duplicate maps to `registration_already_exists` / HTTP 409. The decisive `member_auto_approve` behavior is the latest replacement function in `class-kit-api/supabase/migrations/20260701084833_fix_member_auto_approve_registration.sql`, verified by `class-kit-api/supabase/tests/member_auto_approve_registration.sql`: non-members become pending, members become approved and consume eligible stock, `auto_approve` approves a non-member, and required membership fails.

When an approval has an active stock or limited-stock grant, registration consumes one unit atomically; unavailable stock fails with `membership_stock_depleted`. Other valid membership modes consume zero. The registration stores the grant, amount consumed, and approval timestamp, and membership-ledger entries preserve the outcome. Detailed membership/grant semantics are documented in [Memberships and stock](memberships-and-stock.md).

## Registration transitions and manager controls

A registration is `pending`, `approved`, `rejected`, or `cancelled`. Only `pending` and `approved` are live for the uniqueness constraint and for user cancellation.

| Transition | Preconditions and outcome |
| --- | --- |
| Create | Reaches `pending` or `approved` according to the decision order above. |
| Manager approve | `pending` → `approved`, only while the class remains registerable and has approved-capacity; membership-linked approval consumes stock. |
| Manager reject | A live registration → `rejected`; an approved registration restores eligible pre-start stock. The manager Edge Function permits stale pending rows to be rejected after a class is ended/cancelled, and its pending-list operation performs that cleanup. |
| Manager cancel | `pending`/`approved` → `cancelled`; eligible approved pre-start stock is restored. The API only offers registration-changing actions while a class is upcoming, except stale-pending rejection. |
| User cancel | `pending`/`approved` → `cancelled`; pending registrations may cancel at any time, while an approved registration closes at the product cancellation cutoff unless a privileged caller sets `p_force_restore`. |
| Rejected recovery | The database manager RPC also supports `approve_rejected` and `allow_reregister`; it prevents recovery if another live replacement exists. The exposed manager Edge Function's current temporal gate may prevent those actions once the class is no longer upcoming. |

The approved-user cancellation cutoff is `starts_at - products.registration_cancellation_cutoff_hours` (default 24, non-negative). The later migration `20260702055851_allow_pending_registration_cancellation_after_cutoff.sql` makes the cutoff apply only to approved rows. Its pgTAP regression `pending_registration_cancellation.sql` verifies that a pending registration for a past class is cancelled, while an approved one raises `registration_cancellation_closed`.

## Capacity, cancellation, and class lifecycle

Capacity counts only approved registrations. Both direct registration and manager approval lock the class before comparing that count, so a full class rejects a new approved registration or approval with `class_capacity_full`; it may still accumulate pending requests.

A manager class cancellation calls `cancel_class_with_registration_restoration`, which locks the class, cancels every live registration, restores any consumed stock, and sets `lifecycle_status = cancelled`. The class remains manager-readable but is removed from all non-manager discovery policies. User or manager registration cancellation restores consumed stock only before the class starts, unless a privileged forced restoration is requested; the ledger records whether restoration occurred.

Attendance owns the remaining lifecycle transitions: it may start only an eligible created class, making it `in_progress`, and may complete only an in-progress class, making it `completed` (`class-kit-api/supabase/migrations/20260607170000_attendance_engine.sql`). Once started, ended, or cancelled, the registration guard blocks new registrations and the manager API reports the class as read-only.

## Evidence and known gaps

Primary implementation evidence is the class schema and registration migrations, the later policy/cancellation/member-auto-approval migrations, and the `class-kit-classes`, `class-kit-register-class`, and `class-kit-manage-registrations` Edge Functions. The supplied pgTAP regressions specifically cover the member auto-approval matrix and cancellation-after-cutoff distinction.

Known gaps:

- The snapshot does not provide broad regression coverage for every visibility/listing combination, hidden-class direct registration, concurrent capacity contention, manager recovery actions, or the full attendance lifecycle.
- `list`/`get` return `members_only` rows before the registration membership check, whereas `list_user` applies member filtering. This is a caller-aware API distinction that should be retained or covered explicitly, not inferred as equivalent discovery behavior.
- The latest migration function bodies were inspected statically; no live Supabase database or complete migration/test run was available in this documentation task.
