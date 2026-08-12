# Attendance

Attendance is a product-scoped management workflow that turns a published class into an in-progress session, records its participants, and explicitly completes the class.

## Supported surface and access gates

The browser-facing surface is `client.management.attendance`, which invokes `class-kit-attendance` through the SDK's automatic `class-kit-` function-name prefix. The public methods are `listForClass`, `start`, `updateParticipant`, `addWalkIn`, `addTrial`, and `complete`; their input and result shapes are defined in `class-kit-sdk/src/manager/manager-api.ts` and wired in `class-kit-sdk/src/client/class-kit-client.ts`.

Every operation first resolves product context and requires an authenticated caller. Product resolution/authentication therefore precede both capability checks and class/participant checks. The capability gate then differs by action:

| Operation | Edge Function action | Required product capability | Outcome after authorization |
| --- | --- | --- |
| List a class's participants | `list_class` | Numeric product permission level at least `75` | Returns participants for the resolved product and requested class, ordered by creation time. It does not separately validate that the class exists, so an absent or other-product class produces an empty list. |
| Start attendance | `start` | Explicit `attendance.manage` grant | Runs `start_class_attendance`. |
| Change a participant's status | `update_attendance` | Explicit `attendance.manage` grant | Runs `update_class_participant_attendance`. |
| Add a walk-in | `add_walk_in` | Explicit `attendance.manage` grant | Runs `add_class_walk_in`. |
| Add a trial participant | `add_trial` | Explicit `attendance.manage` grant | Runs `add_class_trial_participant`. |
| Complete attendance | `complete` | Explicit `attendance.manage` grant | Runs `complete_class_attendance`. |

The level-75 read gate can be satisfied through the product-level permission hierarchy; the mutation gate is deliberately different: `attendance.manage` is a product permission key and must be explicitly granted in the applicable scope. The requirement catalog in `class-kit-api/supabase/migrations/20260612122000_permission_requirement_catalog.sql` records the same split. The database RPCs are executable only by `service_role`, so the Edge Function remains the mutation boundary.

## Participants and attendance values

`class_kit.class_participants` is the durable attendance roster. Every row belongs to one product and one class and has one of two attendance values:

| Value | Meaning and use |
| --- | --- |
| `present` | Valid stored attendance value; the default for a walk-in and for every new trial participant. |
| `absent` | Valid stored attendance value; the default for registered participants when attendance starts, and the default if an update request omits `attendance_status`. |

The API rejects any other supplied value. A caller may explicitly pass either supported value when starting registered attendance, updating a participant, or adding a walk-in. Trial creation always stores `present`; it accepts no attendance-status input.

| Participant kind | Required identity fields | Prohibited identity fields | Creation path and constraints |
| --- | --- | --- |
| `registered` | `user_id`, `registration_id` | `trial_name`, `trial_contact` | Created only by start, from currently `approved` registrations. A registration can produce at most one registered participant. |
| `walk_in` | `user_id` | `registration_id`, `trial_name`, `trial_contact` | Added only to an in-progress class for an active product user who has no pending or approved registration for that class. |
| `trial` | Non-blank `trial_name` | `user_id`, `registration_id` | Added only to an in-progress class. Optional contact is trimmed and stored as null when blank. Multiple trial rows are not prevented by a name-based uniqueness rule. |

The table also prevents a registered participant and a walk-in participant from sharing the same `(class_id, user_id)`. That invariant catches duplicate participant creation even where the walk-in's live-registration check no longer applies. Trial participants are intentionally anonymous to the product-user relation.

## Class attendance lifecycle

Attendance changes the class `lifecycle_status`; it is not a separate session status. The presently supported transitions and their precedence are implemented by the RPCs in `class-kit-api/supabase/migrations/20260607170000_attendance_engine.sql`.

| Command | Preconditions, in order after authorization | Effect |
| --- | --- | --- |
| Start | Valid class in the resolved product; lifecycle is not `cancelled` or `completed`; class publication `status` is `published`; lifecycle is `created` or `in_progress`. | `created -> in_progress`. For every currently approved registration, inserts a `registered` participant or, on a repeated start, overwrites that participant's attendance value with the supplied/default value. An already `in_progress` class remains in progress and refreshes only registered participant defaults. |
| Update attendance | Valid participant in the resolved product; its class exists in that product; class lifecycle is `in_progress` or `completed`. | Replaces that participant's `present`/`absent` value. Final corrections remain possible after completion. |
| Add walk-in | Valid class in the resolved product; class lifecycle is `in_progress`; supplied user is an active user of that product; user has no `pending` or `approved` registration for the class; participant uniqueness holds. | Adds a `walk_in` participant with supplied value or default `present`. |
| Add trial | Non-blank name; valid class in the resolved product; class lifecycle is `in_progress`. | Adds a `trial` participant with `present`. |
| Complete | Valid class in the resolved product; lifecycle is exactly `in_progress`. | `in_progress -> completed`. |

Thus a draft class cannot start attendance even if its lifecycle is `created`, and a cancelled or completed class cannot restart. Participants cannot be created before start or after completion; participant status can still be corrected after completion. Starting does not apply registration capacity, membership, approval-policy, or stock gates itself: it consumes the already-authoritative set of registrations whose status is `approved`. For a walk-in, product-user eligibility is checked before the live-registration exclusion; both precede the insert/duplicate constraint. For trial participants, the name check occurs before the class lookup.

## Operational use

Managers should start attendance, list/adjust the roster and add exceptions while the class is in progress, then complete it:

```ts
await client.management.attendance.start(classId, {
  defaultAttendanceStatus: "absent",
});

await client.management.attendance.updateParticipant(participantId, {
  attendanceStatus: "present",
});

await client.management.attendance.addWalkIn(classId, { userId });
await client.management.attendance.addTrial(classId, { name: "Guest", contact: "guest@example.com" });
await client.management.attendance.complete(classId);
```

The SDK method names conceal Edge Function action strings, but they do not replace backend validation. The Edge Function maps missing required identifiers, unsupported statuses, lifecycle failures, inactive/missing product users, blank trial names, and conflicting participants into API errors; product/participant lookups are scoped to the resolved product.

## Evidence and known gaps

Current behavior is grounded in `class-kit-api/supabase/functions/class-kit-attendance/index.ts`, `class-kit-api/supabase/migrations/20260607170000_attendance_engine.sql`, the permission catalog migration, and the SDK source noted above. `docs/api/class-api-map.md` and `docs/sdk/client-sdk.md` agree on the public management namespace, but the implementation is the authority for state checks and defaults.

Known gaps:

- The snapshot contains no dedicated attendance lifecycle, participant-constraint, or permission-gate regression test. `class-kit-api/supabase/tests/truncate_product_admin_action.sql` only incidentally proves that administrative product truncation removes participant rows.
- There is no verified end-to-end test here for the SDK-to-Edge-Function deployment path or for repeated start behavior; that behavior is documented from the current SDK, Edge Function, and SQL implementation.
