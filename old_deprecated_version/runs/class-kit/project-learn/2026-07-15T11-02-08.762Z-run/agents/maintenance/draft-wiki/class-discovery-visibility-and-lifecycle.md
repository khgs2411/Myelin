# Class discovery, visibility, and lifecycle

Concrete classes are product-scoped scheduled offerings: publication, visibility, time, lifecycle state, membership, and registration policy jointly determine whether a caller can discover or register for one. Templates supply defaults, but users register only for concrete `class_kit.classes` records.

## Core record and publication contract

`class_kit.classes` requires a positive capacity and `ends_at > starts_at`. Its independently controlled state fields are:

| Field | Supported values | Effect |
| --- | --- | --- |
| `status` | `draft`, `published` | A class is discoverable or registerable only when published. New API-created classes default to draft. |
| `lifecycle_status` | `created`, `in_progress`, `completed`, `cancelled` | Drives operational lifecycle. Cancelled classes are excluded from current public/user discovery and cannot be registered. |
| `visibility` | `public`, `hidden`, `members_only` | Determines intended audience and is also a registration gate. |
| `registration_policy` | `auto_approve`, `member_auto_approve`, `approval_required` | Determines the initial registration outcome after eligibility succeeds. |
| `membership_requirement` | `none`, `required` | Independently requires an active membership grant to register. |

The create action can override template defaults for these fields and otherwise uses the active template's defaults; without a template it defaults to `draft`, `public`, `member_auto_approve`, and `none`. Update can alter all five fields. `publish` and `draft` only change `status`; they do not reset lifecycle. Creation, update, publish, draft, and cancellation require their respective product permissions (`classes.create`, `classes.update`, `classes.publish`, `classes.draft`, and `classes.cancel`).

## Discovery routes and their actual filters

The Edge Function has four externally meaningful listing shapes. All function queries use the service client, so handler filters—not table RLS—are the effective API boundary.

| Route | Caller | Class filters | Response shape |
| --- | --- | --- | --- |
| `list` / `get` (the SDK user facade) | Anonymous product context is allowed | published; not cancelled; `public` or `members_only`; `list` defaults to the current UTC month, while `get` uses an ID | caller-safe `ClassSummary` / `ClassInformation` |
| `list_public` | Anonymous product context | published, not cancelled, `public`, and `starts_at >= now()` | raw `classes` row plus `approved_count` and cancellation availability |
| `list_user` | authenticated active product user | published, not cancelled, future; active members see `public` and `members_only`, other active users see `public` | raw `classes` row plus registration/cancellation availability |
| `list_manager` / `get_manager` | product permission level 75+ | scoped only by product and optional range/ID; draft, hidden, cancelled, and historical classes remain visible | raw management row with derived temporal/read-only state and registration counts |

The current database RLS policy is stricter for direct table reads: anonymous callers receive only published, non-cancelled public classes; authenticated product users receive `members_only` classes only with an active membership. This is consistent with `list_public` and `list_user`, but not with `list`/`get`: those service-client handlers include `members_only` rows without first filtering the query by active membership. The same handler reports `canRegister` based on `membership_requirement`, but does not include `visibility = members_only` in that boolean. The registration RPC remains the final gate and rejects a non-member for a members-only class, so this is a discovery/availability-hint mismatch rather than a registration bypass.

`hidden` is never returned by the user-facing routes and is rejected by the registration RPC. `members_only` means an active membership grant is required even if `membership_requirement` is `none`; `membership_requirement = required` adds that requirement to a public class as well. Eligibility therefore takes precedence over approval policy:

1. The class must be published, neither cancelled/in-progress/completed, and start in the future; hidden classes fail as well.
2. An active membership grant is required when either `visibility = members_only` or `membership_requirement = required`.
3. `auto_approve` creates an approved registration; `member_auto_approve` approves only a member and otherwise creates pending; `approval_required` creates pending.

The SQL regression test covers the three approval-policy outcomes and the required-membership rejection. It does not cover the Edge Function's discovery filters.

## Temporal and operational lifecycle

The API derives a caller-facing temporal value rather than returning database lifecycle values directly:

| Derived `temporalStatus` | Precedence / condition |
| --- | --- |
| `cancelled` | `lifecycle_status = cancelled` |
| `started` | `lifecycle_status = in_progress`, otherwise current time is at or after `starts_at` |
| `ended` | `lifecycle_status = completed`, otherwise current time is at or after `ends_at` |
| `upcoming` | remaining case |

`registrationOpen` is true only for a derived `upcoming` class that is published. Management responses additionally mark `started`, `ended`, and `cancelled` classes read-only, with that value as `read_only_reason`.

Attendance starts a published `created` class by moving it to `in_progress`; starting an already in-progress class is allowed, while cancelled/completed and draft classes are rejected. Completion is permitted only from `in_progress` and writes `completed`. Cancellation calls `cancel_class_with_registration_restoration`: it cancels pending and approved registrations, restores consumed membership stock for approved registrations, then writes `cancelled`. The cancellation RPC has no lifecycle-state guard, so the current implementation permits cancellation of any existing product class, including one already in progress or completed.

## Caller-safe fields and roster policy

The SDK uses `list` and `get`, whose baseline summary is limited to identity, name, timing, location, capacity, registration policy, temporal/registration flags, and the caller's live registration. `get` always includes description and category; `list` includes them only when requested. The SDK types make the optional fields explicit in `class-kit-sdk/src/types.ts`.

`fields` can request `description`, `category`, `membershipRequirement`, `cancellationCutoff`, `registeredUsersCount`, `registeredUsersRoster`, and `pendingRegistrationCount`. The handler treats description, category, cancellation cutoff, and pending count as permission-gated when explicitly requested; `classes.extra_fields.read` is required. The `get` default description/category exception means an anonymous caller can receive those two fields without requesting them.

Each class has a JSON `public_field_policy` object. New API-created records default to `{ registeredUsersCount: true, registeredUsersRoster: false }`; the roster migration backfilled the latter false value. Its current effects in the safe routes are:

| Field | Without `classes.extra_fields.read` | With permission |
| --- | --- | --- |
| `registeredUsersCount` | Included whenever policy permits it (default true), even if not requested | Included when policy permits, or when explicitly requested despite policy |
| `registeredUsersRoster` | Included only when requested and policy allows it; entries contain `userId`, `displayName`, and `email: null` | Included when requested regardless of policy; email fallback may be populated |
| `pendingRegistrationCount` | Never included | Included when requested |

The legacy `list_public` and `list_user` paths bypass this summary and return `select('*')` rows. They therefore do not enforce the public-field-policy shaping contract. Cancellation reason fields are persisted by the manager cancellation action, but the safe summary routes do not expose either the reason or its `expose_cancellation_reason_to_users` flag; no implemented user-facing rule was found that consumes that flag.

## Evidence

- `class-kit-api/supabase/migrations/20260607134535_template_class_core.sql` defines the concrete-class state enums, constraints, defaults, and original RLS policies.
- `class-kit-api/supabase/migrations/20260702121000_public_class_discovery_non_cancelled.sql` is the current RLS/index refinement: published, non-cancelled discovery and membership-conditioned `members_only` table access.
- `class-kit-api/supabase/functions/class-kit-classes/index.ts` implements the route-specific service-client filters, caller-safe summary, public-field policy, derived temporal status, and lifecycle actions.
- `class-kit-api/supabase/migrations/20260607160000_registration_engine.sql` and `20260701084833_fix_member_auto_approve_registration.sql` establish registration eligibility, membership precedence, approval outcomes, and cancellation restoration.
- `class-kit-api/supabase/migrations/20260607170000_attendance_engine.sql` establishes the attendance lifecycle transitions.
- `class-kit-api/supabase/migrations/20260622150445_class_api_pattern_foundation.sql` and `20260624090000_class_roster_public_field_policy.sql` establish and backfill field policy.
- `class-kit-sdk/src/types.ts` and `class-kit-sdk/src/client/class-kit-client.ts` show the supported user and management caller contracts.
- `class-kit-api/supabase/tests/member_auto_approve_registration.sql` corroborates approval and membership outcomes; `pending_registration_cancellation.sql` corroborates the different cancellation treatment for pending versus approved registrations.

## Known gaps

- No focused regression test was found for `list`, `get`, `list_public`, `list_user`, or the field-policy/roster response matrix. In particular, the generic service-client `list`/`get` inclusion of `members_only` classes for non-members, and its optimistic `canRegister` value, should be covered or reconciled with the RLS and registration contracts.
- Raw `list_public` and `list_user` responses are not verified to be intentionally public-safe; they bypass the safe summary and `public_field_policy` shaping.
- No tested or implemented safe-route behavior was found for `cancellation_reason` or `expose_cancellation_reason_to_users`; the flag's user-facing effect is therefore unknown.
