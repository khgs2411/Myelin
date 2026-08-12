# Classes, discovery, and lifecycle

ClassKit's user-facing unit is a concrete class: registrations, capacity, visibility, publication, attendance, and lifecycle all belong to one class record rather than to a template or schedule.

The documented snapshot is `master` at `4f55d94506f181d179f705173ecd54606b44c90c`, with the registered repository and `origin` recorded in [repository identity](../state/repository-identity.json). The implementation evidence below comes from that snapshot's API, SQL migrations, SDK types, and SQL regressions.

## Concrete-class model

`class_kit.classes` requires a product, name, start and end timestamps, and positive capacity; `ends_at` must be after `starts_at` (`class-kit-api/supabase/migrations/20260607134535_template_class_core.sql`). A class may carry a `template_id`; this supplies defaults at manual creation time, but does not make the result a template or a generated occurrence. A schedule-generated class additionally has schedule provenance (`schedule_id`, `generated_for_date`, and `source_timezone`). Direct class create/update rejects those schedule source fields, and a generated class cannot have its template changed through normal update (`class-kit-api/supabase/functions/class-kit-classes/index.ts`).

Templates and schedules are therefore upstream authoring tools, not customer resources: users discover and register for concrete classes only. Manual creation can use an active template for defaults; it always creates a standalone class. Schedule generation owns generated source fields and is documented separately under templates and schedules.

## Independent state dimensions

The record carries several independent, behavior-shaping values. They should not be collapsed into one generic “status.”

| Dimension | Supported values | User-visible consequence |
| --- | --- | --- |
| Publication `status` | `draft`, `published` | Only `published` classes are returned by customer-facing reads and can be registered for. New manual classes default to `draft`. |
| Lifecycle `lifecycle_status` | `created`, `cancelled`, `in_progress`, `completed` | `cancelled` is excluded from customer reads and registration; `in_progress` and `completed` also close registration. Attendance start moves `created -> in_progress`; completion moves `in_progress -> completed`. |
| Derived temporal status | `upcoming`, `started`, `ended`, `cancelled` | `cancelled` wins when lifecycle is cancelled; `in_progress` maps to `started`; `completed` maps to `ended`; otherwise time maps to `upcoming`, `started`, or `ended` using `starts_at` and `ends_at`. It is response-derived, not a stored enum. |
| Visibility | `public`, `hidden`, `members_only` | `hidden` is not registerable; `members_only` requires an active membership grant to register. The intended discovery audience depends on which API action is used; see the known gap below. |
| Registration policy | `auto_approve`, `member_auto_approve`, `approval_required` | After eligibility succeeds, it produces `approved`, member-dependent `approved`/`pending`, or `pending` respectively. |
| Membership requirement | `none`, `required` | `required` denies registration without an active grant, regardless of registration policy. |

The default `registration_policy` is `member_auto_approve`, membership requirement defaults to `none`, and visibility defaults to `public`. Class templates can provide replacement defaults for these values during manual creation. `notes` and custom data are operational fields; the customer-safe response shaping described below does not expose notes.

## Discovery and customer-safe reads

The supported SDK facade is `classes.list(options?)` and `classes.get(classId, options?)`, backed by `class-kit-classes` actions `list` and `get` (`docs/api/class-api-map.md`, `class-kit-sdk/src/types.ts`). `list` defaults to the current UTC month; a supplied range must have a valid `start < end`. `get` has no range restriction. Both are origin/product-resolved and anonymous-aware.

Their standard response is deliberately shaped rather than passing through the database row:

- Always returned: identity, name, start/end, location, capacity, registration policy, derived temporal status, `registrationOpen`, `canRegister`, and `canCancelRegistration`.
- `get` also returns description and category by default; `list` returns either only when requested.
- The caller's live pending/approved registration is returned only to that signed-in caller. No default response includes notes, attendance participants, raw registration rows, or other registered users’ identities.
- `registeredUsersCount` is included when the class public-field policy permits it (the default is enabled). `registeredUsersRoster` is returned only when requested and either the class policy explicitly enables it or the caller has `classes.extra_fields.read`; email fallbacks are supplied only for the permissioned path. `pendingRegistrationCount` and other protected requested fields require that same explicit permission. An unauthorized protected-field request fails rather than silently returning a reduced response.

The policy object requires boolean `registeredUsersCount`; optional `registeredUsersRoster` is also boolean. New API-created classes use `{ registeredUsersCount: true, registeredUsersRoster: false }`. This makes roster identity opt-in, while approved-registration count is public by default (`20260622150445_class_api_pattern_foundation.sql`, `20260624090000_class_roster_public_field_policy.sql`).

### Current visibility behavior

`list/get` query `published`, non-cancelled classes with either `public` or `members_only` visibility, then calculate `canRegister` from membership requirement and the caller’s active grant. Thus an anonymous or non-member caller can currently receive a `members_only` class through the caller-aware SDK path but cannot register when membership is required. This differs from the legacy actions and RLS policy:

- `list_public` returns only future `public`, published, non-cancelled classes.
- `list_user` requires an active product user; it returns future `public` classes to non-members and adds `members_only` only for an active member.
- Direct table RLS permits anonymous `public` reads and permits `members_only` reads only to a product-role holder with an active membership (`20260702121000_public_class_discovery_non_cancelled.sql`).

The newer service-role Edge Function path is authoritative for the SDK, so this is a real behavior difference, not a guarantee supplied by RLS. Treat member-only discovery privacy as needing review until the `list/get` filter and its intended contract are reconciled.

## Registration availability and precedence

The database RPC is the final authority. Its checks are ordered as follows (`20260701084833_fix_member_auto_approve_registration.sql`):

1. The class must exist in the resolved product, then be published, not hidden, not cancelled/in progress/completed, and not started. Otherwise it is not registerable.
2. The caller must be an active product user.
3. Approved registrations must remain below capacity.
4. The active membership grant is loaded. A class with `membership_requirement = required` or `visibility = members_only` rejects a caller without one.
5. Only then does registration policy select the status: `auto_approve` is approved; `member_auto_approve` is approved with a grant and pending without one; `approval_required` is pending.

Approved registrations consume stock only through an active stock-based membership grant; the registration keeps its resulting status and consumed-stock count. A partial unique index permits at most one live (`pending` or `approved`) registration for each class/user pair. The SQL regression `supabase/tests/member_auto_approve_registration.sql` confirms the member/non-member outcomes and that a required-membership class rejects before policy can create a pending registration.

`canRegister` in the SDK response is advisory UI state: it excludes an existing live registration, requires derived `upcoming` plus `published`, and requires a membership only when `membership_requirement` is `required`. The RPC still enforces hidden visibility, `members_only`, product-user state, capacity, grant validity/stock, and concurrency-sensitive state; clients must not treat the flag as authorization.

For self-cancellation, a pending or approved registration is the eligible starting state. Pending cancellation is allowed even after the product cancellation cutoff; approved cancellation after that cutoff is rejected unless an authorized operation forces restoration. Approved stock restores only before the class starts, except for forced restoration. `supabase/tests/pending_registration_cancellation.sql` verifies the pending-versus-approved cutoff distinction.

## Management operations

`management.classes.*` is a separate operational surface. `list/get` require the product level-75 gate and return the full management-safe row, including publication/lifecycle fields, notes, custom data, cancellation metadata, and counts. It sees all product classes, including drafts, hidden classes, and terminal classes. Create, update, cancel, publish, and draft each require their own explicit product permission (`classes.create`, `classes.update`, `classes.cancel`, `classes.publish`, or `classes.draft`); high role level alone is not a substitute for those keys.

- `create` validates times, positive capacity, supported enum values, active template references, custom data, and schedule-field ownership. It may create directly published classes when the caller supplies `status: published`; `publish` is still the explicit availability command for an existing class.
- `update` changes ordinary editable values, including publication status, but rejects schedule-controlled source fields. It preserves the timestamp invariant. This means `status` can also be set in update, while `publish()` and `draft()` remain the explicit SDK lifecycle commands.
- `publish` and `draft` change publication only. Neither cancels registrations or changes lifecycle state.
- `cancel` invokes `cancel_class_with_registration_restoration`, which marks lifecycle cancelled and performs registration restoration behavior, then stores an optional reason and an `expose_cancellation_reason_to_users` flag. Cancellation is not deletion.

Attendance owns the lifecycle transitions rather than ordinary class update. `management.attendance.start` requires `attendance.manage`, rejects draft/cancelled/completed classes, changes `created` to `in_progress`, and creates participant rows for approved registrations (default attendance `absent`, or explicit `present`). Starting an already in-progress class remains permitted and refreshes those registered participant rows. `complete` requires `in_progress` and changes it to `completed`; no supported operation reopens a completed class. Attendance roster listing uses the level-75 gate; all attendance mutations use `attendance.manage` (`class-kit-api/supabase/functions/class-kit-attendance/index.ts`, `20260607170000_attendance_engine.sql`).

## Known gaps

- No inspected automated regression directly covers caller-aware `classes.list/get` visibility, response field shaping, `public_field_policy`, publication/draft commands, cancellation reason exposure, or attendance lifecycle transitions. Existing SQL regressions cover registration policy and cancellation cutoff, not these discovery/lifecycle contracts.
- `expose_cancellation_reason_to_users` is persisted and returned on management rows, but the current customer summary shaper does not return a cancellation reason or exposure flag. The flag’s intended customer-facing effect is therefore unverified and currently absent from the supported `classes.list/get` response.
- The caller-aware `list/get` action includes `members_only` rows for anonymous/non-member callers, whereas legacy actions and direct RLS restrict that audience. This high-impact discovery/privacy contradiction needs product and implementation resolution before member-only visibility can be described as complete.
