# Templates and schedules

Templates hold reusable class defaults, schedules turn an active template and recurrence rule into concrete classes, and concrete classes remain the records that customers register for and managers operate.

## Ownership and access

`class_kit.class_templates`, `class_kit.schedules`, and `class_kit.schedule_skips` are product-scoped. A schedule must reference a template in the same product; generated classes retain a same-product schedule/template relationship. Templates and schedules are manager-facing supporting records, not registration targets: the template API rejects registration-like actions, and the class API directs registration to concrete classes.

Template and schedule reads (`list`, `get`, and schedule `preview`) require the product level-75 gate. Template create/update/deactivate require `templates.manage`; schedule create/update/pause/archive/skip changes and explicit generation require `schedules.manage`. These checks occur after normal product resolution and user authorization in the Edge Functions (`class-kit-api/supabase/functions/class-kit-templates/index.ts`, `class-kit-api/supabase/functions/class-kit-schedules/index.ts`, and `class-kit-api/supabase/functions/class-kit-schedule-generate/index.ts`).

## Templates: reusable defaults, not live class state

A class template has a required positive `default_capacity`, required name, optional description/category/location/notes, custom-field schema and object-shaped custom defaults, and these defaults:

| Default | Supported values | Effect when generation or template-backed manual creation omits the class field |
| --- | --- | --- |
| visibility | `public`, `hidden`, `members_only` | `public` by default; copied to the concrete class. |
| registration policy | `auto_approve`, `member_auto_approve`, `approval_required` | `member_auto_approve` by default; copied to the concrete class. |
| membership requirement | `none`, `required` | `none` by default; copied to the concrete class. |
| status | `active`, `inactive` | New templates are `active`. Only active templates participate in schedule generation or may seed a template-backed manual class. |

The template’s other defaults are copied as the generated class name, description, category, capacity, location, notes, and `custom_data`. A template update changes the reusable defaults only. It does not automatically update any already-created concrete class, and template deactivation does not remove or change existing classes. This is enforced by the generation insert path in `class-kit-api/supabase/migrations/20260623080614_backfill_schedule_generation_from_start.sql` and the template API in `class-kit-api/supabase/functions/class-kit-templates/index.ts`.

## Schedule rule and recurrence contract

A schedule has a required same-product `template_id`, name, `starts_on`, local `start_time`, IANA `timezone`, and duration from 1 through 1,440 minutes. Its supported states are:

| Status | Generation outcome |
| --- | --- |
| `draft` | Can be stored and previewed; schedule create/update returns no generation. |
| `active` | Eligible for generation, provided its template is also active. Create/update invokes generation after persistence. |
| `paused` | No new generation; pausing does not alter existing generated classes. |
| `archived` | No new generation; archiving does not alter existing generated classes. |

Recurrence is one of:

| Type | Required and prohibited fields | Occurrence outcome |
| --- | --- | --- |
| `one_time` | `weekdays` must be empty and `ends_on` must be null. | One occurrence on `starts_on`. |
| `weekly` | One or more unique weekdays are required; optional `ends_on` cannot precede `starts_on`. | One occurrence for each selected weekday from `starts_on` through `ends_on`, or through the generation range for an unbounded schedule. |

Weekdays are integers `0` through `6`, where `0` is Sunday and `6` is Saturday. The API validates date format, normalizes weekday duplicates, validates IANA time zones, and serializes a local date/time to UTC for previews. Database checks duplicate the recurrence and date-range invariants (`class-kit-api/supabase/migrations/20260607143000_schedule_rule_model.sql`).

## Preview, skips, and generation

`preview` returns matching occurrences in the requested inclusive date range, with local start, UTC start/end, timezone, and `skipped` flag. It is informational: it does not create classes.

A skip is unique per `(schedule_id, skip_date)` and may carry a reason. Creating a skip is idempotent through upsert; deleting it removes the suppression record. A skip excludes that date from subsequent generation and increments `skipped_count` when it falls in the selected candidates. It does **not** delete, cancel, or otherwise change a concrete class already generated for that date. Removing a skip only permits a later generation call to create an otherwise missing occurrence.

Generation has two entry points:

- Creating or updating an `active` schedule runs generation and returns `generation`; other resulting schedule states return `generation: null`.
- `management.schedules.generate` calls `class-kit-schedule-generate`; a specified schedule must exist in the product and be `active`, while no schedule id generates all eligible active schedules.

`generation_count`, when supplied, is an integer from 1 through 52. When absent, the product’s `generation_horizon_weeks` value is used, falling back to 8. The current implementation starts candidate enumeration at each schedule’s `starts_on`, supports backfilling historical occurrences, limits each schedule to the first selected number of occurrences, and caps an unbounded schedule at one year from `starts_on`. The backfill regression verifies generated Monday occurrences for June 2026 and verifies that an explicit historical manager range can see them (`class-kit-api/supabase/tests/schedule_generation_backfill.sql`).

Generation admits only an active product, active schedule, and active template. It reports `created_count`, `existing_count`, and `skipped_count`. Uniqueness on `(product_id, schedule_id, generated_for_date, starts_at)` makes repeated generation idempotent: an existing matching class is counted and retained rather than duplicated.

## Generated-class boundary and update effects

Each generated class is a normal concrete `class_kit.classes` row, published with lifecycle `created`, and carries all of `schedule_id`, `template_id`, `generated_for_date`, and `source_timezone`. A standalone class has no `schedule_id`, `generated_for_date`, or `source_timezone`; it may still reference a template. Database constraints require this all-or-none schedule provenance, enforce that the schedule and template belong to the same product and match each other, and prevent deletion of a referenced schedule or template (`class-kit-api/supabase/migrations/20260608030000_generated_class_source_integrity.sql`).

Schedule generation owns provenance. The normal class create/update API rejects caller-supplied `schedule_id`, `generated_for_date`, and `source_timezone`; it also rejects changing `template_id` on a generated class. Managers can still update other concrete-class fields through the normal class permissions, including schedule-derived presentation and time fields. Those edits are retained because current generation uses conflict-do-nothing insertion: it neither refreshes existing generated classes nor records an override marker.

Accordingly, these current effects are deliberate boundaries of the implementation:

| Change | Effect on existing generated classes | Effect on later missing occurrences |
| --- | --- | --- |
| Update template defaults | No propagation. | Later generated classes use the new defaults. |
| Update an active schedule | Existing classes are retained unchanged. | The immediate generation call can create newly eligible, non-skipped occurrences using the updated rule/defaults. A changed local start time has a different uniqueness key, so it can create a second class for the same schedule date rather than replace the original. |
| Pause or archive a schedule | Existing classes are retained unchanged. | No new occurrences are generated. |
| Deactivate a template | Existing classes are retained unchanged. | No new occurrences are generated from schedules using it. |
| Add a skip | Existing classes are retained unchanged. | The skipped date is suppressed. |

The historical working draft `docs/design/2026-06-25-schedule-lifecycle-management/spec.md` proposes richer refresh, override, stale-cleanup, and deletion-exclusion behavior. It is not current implementation evidence: the repository has no override marker, generated-class refresh, stale cleanup, or automatic exclusion created by deleting a generated class.

## Known gaps

- The focused SQL regression covers backfill existence and visibility, but not skip effects, inactive/paused/archived generation suppression, permission failures, idempotence counts, or the update-effect matrix above.
- There is no current regression proving time-zone/DST conversion parity between Edge Function preview and SQL generation.
- The historical lifecycle design remains a working draft; its proposed override and safe-refresh semantics need implementation and behavior tests before they can be documented as supported.

## Repository evidence

The checkout identity is recorded in [repository identity](../state/repository-identity.json). Current schema and generation behavior are grounded primarily in `class-kit-api/supabase/migrations/20260607134535_template_class_core.sql`, `class-kit-api/supabase/migrations/20260607143000_schedule_rule_model.sql`, `class-kit-api/supabase/migrations/20260607153000_schedule_generation_engine.sql`, `class-kit-api/supabase/migrations/20260609120000_schedule_generation_count.sql`, `class-kit-api/supabase/migrations/20260623080614_backfill_schedule_generation_from_start.sql`, and the cited Edge Functions and regression SQL.
