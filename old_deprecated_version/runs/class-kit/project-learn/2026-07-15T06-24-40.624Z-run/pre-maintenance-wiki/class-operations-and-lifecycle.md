# Class Operations and Lifecycle

ClassKit treats a concrete class as the operational record: customers discover, register for, cancel, and attend a class, while staff manage its publication, roster, attendance, and cancellation lifecycle. Templates and schedules are management tools that create or organize those concrete records; neither is customer-registerable. See `docs/api/class-api-map.md` and `docs/sdk/client-sdk.md`.

## Supported class creation paths

There are three distinct paths, each producing a concrete class:

- A manual one-off uses `management.classes.create(input)` without `templateId`; it has no template or schedule provenance.
- A template-backed manual class uses `management.classes.create({ templateId, ... })`. Omitted fields are seeded from the template, but the resulting class remains a standalone, manually managed record.
- A schedule-generated class comes from an active schedule create/update with `generationCount` or from `management.schedules.generate(...)`. It carries `scheduleId`, `templateId`, `generatedForDate`, and `sourceTimezone` provenance.

The backend, rather than the browser, owns this distinction. The class create API rejects caller-provided schedule provenance fields, and a generated class must have the complete source set. Use a schedule only where recurring or one-time generation provenance, skip/unskip behavior, or later generation management is needed; do not turn ordinary one-off classes into schedules. `docs/api/backend-api.md` documents these invariants.

## Customer class flow

Customer-facing websites use `classes.*`, not management APIs or raw Edge Functions:

- `classes.list({ range, fields? })` returns caller-safe discovery results. Its default range is the current month; calendar UIs should pass their visible date range explicitly.
- `classes.get(classId, { fields? })` returns caller-safe detail. It includes description and category by default, unlike the list response.
- `classes.register(classId)` and `classes.cancelRegistration(registrationId)` are self-service commands.

The default-safe response includes identity, timing, location, capacity, and the caller's registration state/capabilities. Management notes, rosters, attendance participants, and registered identities are not exposed through these reads. Some additional fields require `classes.extra_fields.read`; public aggregate exposure is also controlled by the class public-field policy. `registeredUsersCount` means approved, active registrations; `pendingRegistrationCount` is for requests awaiting approval. The backend makes the final decisions on visibility, registration policy, capacity, membership eligibility or stock, and cancellation cutoff, so product UIs should use returned state for guidance but must not precompute authorization.

## Management class and registration lifecycle

Operational dashboards use product-context, permission-guarded `management.*` APIs. The name intentionally does not imply the built-in manager role: custom product roles may hold the required permissions.

`management.classes.list/get/create/update` cover ordinary resource operations. Publication and cancellation are separate commands because they have lifecycle effects:

- `publish(classId)` and `draft(classId)` change publication/visibility state; drafting is not cancellation.
- `cancel(classId, { reason?, exposeReasonToUsers? })` is not a soft delete. It records cancellation metadata and invokes backend registration-restoration rules.
- `update(...)` can set ordinary editable fields, including `publicFieldPolicy`; hiding a count in the frontend does not restrict its backend exposure.

Customer registration starts through `classes.register`, while staff review uses `management.registrations.listPending`, `listRegistered`, `approve`, and `reject`. Registration summaries are enriched with user and class context. Approval/rejection transitions, capacity, membership stock consumption or restoration, and invalid-state handling remain backend-owned. When staff request the pending queue, the backend first rejects stale pending requests for ended or cancelled classes and omits them from the result; it leaves approved, already rejected, cancelled, upcoming, and in-progress registrations unchanged. Managers may also explicitly reject a pending request after a class ends or is cancelled.

## Attendance lifecycle

Attendance belongs to the class session rather than the class list or registration API:

1. Start with `management.attendance.start(classId, { defaultAttendanceStatus? })`.
2. Read participants with `listForClass(classId)` and mark them with `updateParticipant(participantId, { attendanceStatus })`.
3. Add an existing-user walk-in with `addWalkIn`, or record a non-user trial guest with `addTrial`.
4. Finalize with `complete(classId)`.

The available attendance statuses are `present` and `absent`. A walk-in intentionally bypasses normal registration; a trial participant has no product-user id. Starting and completing attendance are explicit lifecycle commands, not incidental class updates.

## Templates and schedule rules

`management.templates.*` manages reusable defaults: list, get, create, update, and deactivate. Templates define defaults for future manual creation and generation; editing one does not automatically rewrite existing standalone manual classes.

`management.schedules.*` manages schedule rules, which materialize classes rather than acting as recurring classes themselves. Every schedule requires a template. A rule is either `weekly` (one or more unique weekdays, with `0` Sunday through `6` Saturday) or `one_time` (empty weekdays and no end date). Dates use `YYYY-MM-DD`, local start time uses `HH:MM` or `HH:MM:SS` in a valid IANA timezone, duration is 1–1440 minutes, and optional generation count is 1–52.

The management flow is `list/get/create/update`, `preview` for a non-mutating occurrence calculation, and explicit `generate`, `pause`, `archive`, `skipDate`, and `unskipDate` commands. Generation attached to schedule create or update runs only when the resulting rule is active; draft, paused, and archived schedules return no generation result until later activation/generation. A one-time rule can still be appropriate when staff need source provenance, skip behavior, or generation management.

## Lifecycle boundary and future direction

The living API and SDK documentation establish today’s supported commands and provenance rules. `docs/design/2026-06-25-schedule-lifecycle-management/spec.md` is explicitly a **working draft, not approved for implementation planning**, and must not be treated as current behavior.

That draft proposes a stronger future model: idempotent range ensure/refresh, protection for staff-edited generated classes, durable exclusions for deleted/skipped generated occurrences, safe stale-class cleanup only when no operational activity exists, and explicit outcome counts. Its unresolved questions include which edits set protection and whether deletion and skip remain separate actions. Until implemented and promoted into living API documentation, the current contract is `generate`, `skipDate`, and `unskipDate`, not `ensureRange` or override/exclusion semantics.

## Design rules for consumers

- Use the SDK facade; product websites must not call raw Edge Functions to bypass a missing facade method.
- Treat backend authorization as authoritative even if product context capability flags are used to choose which management UI to render.
- Use explicit commands for lifecycle or side-effecting actions rather than hiding them inside update calls.
- Keep templates, schedules, and generated-class provenance out of customer discovery contracts except where the backend intentionally exposes a safe field.

