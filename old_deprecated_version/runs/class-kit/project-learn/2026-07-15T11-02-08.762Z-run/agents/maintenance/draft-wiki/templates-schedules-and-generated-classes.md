# Templates, schedules, and generated classes

Templates supply reusable class defaults, schedules turn one template into dated occurrences, and generation materializes those occurrences as the concrete classes that users can discover and register for. Templates and schedules are management records, never registerable classes.

## Scope and authority

All records are product-scoped. A schedule's `(template_id, product_id)` foreign key requires its template to belong to the same product; generated-class integrity also requires its schedule, template, and product to agree. The management Edge Functions resolve product context before every operation:

- Template and schedule `list`, `get`, and schedule `preview` require product permission level 75.
- Template mutations require `templates.manage`; schedule mutations and the separate generate endpoint require `schedules.manage`.
- The database's direct authenticated read policies are manager-or-platform-admin policies, while Edge Functions use a service client after their own permission checks.

## Templates: reusable defaults, not class instances

`class_kit.class_templates` owns a name, optional description/category/location/notes, positive `default_capacity`, default visibility, registration policy, membership requirement, custom-field schema/defaults, and an `active` or `inactive` status. Creating a template applies these defaults when omitted:

| Default | Supported values / behavior |
| --- | --- |
| `default_visibility` | `public` (default), `hidden`, or `members_only` |
| `default_registration_policy` | `auto_approve`, `member_auto_approve` (default), or `approval_required` |
| `default_membership_requirement` | `none` (default) or `required` |
| `default_capacity` | Required positive integer |

`class-kit-templates` supports `list`, `get`, `create`, `update`, and `deactivate`; deactivation sets `status` to `inactive` rather than deleting the row. Listing does not filter out inactive templates. A template must be active for template-backed manual class creation, and schedule generation includes only active templates. Schedule creation/update merely confirms same-product existence, so an inactive template can still be selected for a schedule but will not generate classes.

For a manual class created with an active `template_id`, omitted ordinary values are copied from the template at create time; provided values override them. The resulting class remains standalone: it has no schedule source fields. Later template edits do not rewrite existing classes.

## Custom fields and custom data

Templates declare `custom_fields` and `custom_defaults`, both JSON-backed values. The application validates the richer contract before storing them:

- Each field has a unique key matching `^[A-Za-z][A-Za-z0-9_]*$`, a non-empty label, and one type: `text`, `long text`, `number`, `boolean`, `select`, `multi-select`, `date`, or `URL`.
- `required` is true only when supplied as boolean `true`; `visible` and `searchable` are optional boolean flags.
- `select` and `multi-select` require at least one non-empty string option (duplicates are removed). `select` values must be an option; `multi-select` values must be arrays whose entries are options.
- Text, number, boolean, URL, and date values are type-checked; URLs must parse successfully and dates must be parseable strings. Field-level defaults and `custom_defaults` must match their declared field type, and `custom_defaults` cannot name an undefined field.

When a concrete class has a template, its `custom_data` is `{...custom_defaults, ...requestData}`. Unknown request keys and invalid types are rejected; every required field must be present after that merge and must not be `undefined`, `null`, or `""`. A manual class without a template accepts an object as custom data without this field-schema validation. On class update, supplied custom data merges with existing custom data and is revalidated against the class's resulting active template.

## Schedule rule contract

`class_kit.schedules` references exactly one same-product template and has status, recurrence, dates, local time, duration, and an IANA timezone. Its supported states are `draft` (default), `active`, `paused`, and `archived`. The API has explicit `pause` and `archive` actions, and its general `update` action can set any supported status; there is no schedule-delete action in the current Edge Function.

| Recurrence type | Required form |
| --- | --- |
| `one_time` | `starts_on` only; `weekdays` must be empty and `ends_on` must be null |
| `weekly` | At least one unique weekday, numbered `0` (Sunday) through `6` (Saturday); optional `ends_on` cannot precede `starts_on` |

`starts_on`, `ends_on`, skip dates, and preview bounds use `YYYY-MM-DD`. `start_time` accepts `HH:MM` or `HH:MM:SS`, normalizes to seconds, and `duration_minutes` is an integer from 1 through 1440. Timezones are verified through `Intl.DateTimeFormat`; previews calculate UTC start/end timestamps from the local date, time, and timezone. Preview returns candidate occurrences, including `skipped: true` entries, for the requested range; it does not require the schedule to be active and does not create classes.

## Skips and materialization

A `schedule_skips` row is unique for `(schedule_id, skip_date)`, with an optional reason. `create_skip` is an upsert, so repeating it replaces the stored reason; `delete_skip` removes that date's skip. A skip suppresses generation but remains visible as a skipped preview occurrence. Adding a skip does not cancel an already-generated class, and removing one does not itself generate a class.

Generation can run through `class-kit-schedule-generate`, or as part of schedule create/update when the resulting status is `active`. A draft, paused, or archived schedule returns `generation: null` from create/update; the dedicated endpoint instead rejects a named non-active schedule with `409 conflict`. Generation ignores inactive templates even if their schedule is active.

The optional `generation_count` must be an integer 1–52. If omitted, the database uses the product's `generation_horizon_weeks`, defaulting to 8. Current SQL enumerates occurrences from `starts_on` through `ends_on` (or one year after `starts_on`), ranks them from the beginning, and limits to the first count before filtering skips or checking existing classes. Thus the count bounds candidate occurrence positions, not newly created future classes; repeated calls can report existing/skipped rows without advancing past that initial occurrence range.

For each remaining candidate the generator converts local schedule time to UTC, copies the template's ordinary defaults and `custom_defaults`, and inserts a concrete class as `published` with lifecycle `created`. The result returns `created_count`, `existing_count`, and `skipped_count`. Idempotency is enforced by unique `(product_id, schedule_id, generated_for_date, starts_at)`; it does not refresh an already-generated class when the template or schedule changes.

## Generated-class provenance and edit boundary

Every generated class stores all of:

- `schedule_id`
- `template_id`
- `generated_for_date`
- `source_timezone`

The database requires these fields as a complete set: standalone classes have all three schedule source fields null, while generated classes have non-null provenance and a template that matches the source schedule in the same product. Schedule and template references are `on delete restrict` for generated provenance, preserving the source chain; template deletion otherwise sets a standalone class's `template_id` to null.

`class-kit-classes` rejects caller-provided `schedule_id`, `generated_for_date`, and `source_timezone` on both create and update. It also prevents changing `template_id` on a generated class. Other class updates are not categorically blocked by this endpoint, so generation should be understood as insert-only provenance creation, not a synchronization or immutable-instance system.

## Known gaps

- The snapshot has no focused schedule/template regression tests to confirm database execution, daylight-saving edge cases, state transitions, or count behavior against a migrated Supabase instance.
- Existing operational documentation describes generated classes as candidates for later refresh/protection, but the current generator only inserts on conflict and does not reconcile schedule/template edits, skips added after creation, or paused/archived schedules with classes already created.
- Generation's count window starts at `starts_on`, including past and already-existing occurrences. This is current source behavior, but whether it is the intended long-running scheduler policy needs product review.

## Evidence

- `class-kit-api/supabase/functions/_shared/class_schema.ts`
- `class-kit-api/supabase/functions/class-kit-templates/index.ts`
- `class-kit-api/supabase/functions/class-kit-schedules/index.ts`
- `class-kit-api/supabase/functions/class-kit-schedule-generate/index.ts`
- `class-kit-api/supabase/functions/class-kit-classes/index.ts`
- `class-kit-api/supabase/migrations/20260607134535_template_class_core.sql`
- `class-kit-api/supabase/migrations/20260607143000_schedule_rule_model.sql`
- `class-kit-api/supabase/migrations/20260607153000_schedule_generation_engine.sql`
- `class-kit-api/supabase/migrations/20260608030000_generated_class_source_integrity.sql`
- `class-kit-api/supabase/migrations/20260609120000_schedule_generation_count.sql`
- `class-kit-api/supabase/migrations/20260623080614_backfill_schedule_generation_from_start.sql`
