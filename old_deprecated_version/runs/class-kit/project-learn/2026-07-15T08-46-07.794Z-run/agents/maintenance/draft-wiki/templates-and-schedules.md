# Templates and schedules

Templates define reusable class defaults, while schedules turn an active template into dated, concrete classes. Registration, attendance, cancellation, and public visibility apply to those concrete classes rather than to a template or schedule.

## Ownership and access

All three records are product-scoped. A schedule may reference only a template in the same product, and a generated class must retain a matching `(schedule_id, template_id, product_id)` source tuple. The database restricts deletion of a template referenced by a schedule and deletion of a schedule referenced by a generated class; deleting a product cascades its templates, schedules, skips, and classes (`20260607143000_schedule_rule_model.sql` (`repo:class-kit-api/supabase/migrations/20260607143000_schedule_rule_model.sql`), `20260608030000_generated_class_source_integrity.sql` (`repo:class-kit-api/supabase/migrations/20260608030000_generated_class_source_integrity.sql`)).

The supported product-facing surface is the SDK's `management.templates` and `management.schedules` namespaces (`class-kit-client.ts` (`repo:class-kit-sdk/src/client/class-kit-client.ts`)). Reading templates, schedules, and previews requires product role level 75; creating, updating, deactivating templates and creating, updating, pausing, archiving, skipping, or generating schedules requires the corresponding `templates.manage` or `schedules.manage` permission. The built-in manager role receives both permissions (`class-kit-templates/index.ts` (`repo:class-kit-api/supabase/functions/class-kit-templates/index.ts`), `class-kit-schedules/index.ts` (`repo:class-kit-api/supabase/functions/class-kit-schedules/index.ts`), `20260622150445_class_api_pattern_foundation.sql` (`repo:class-kit-api/supabase/migrations/20260622150445_class_api_pattern_foundation.sql`)).

## Template contract

A template is `active` or `inactive`; new templates are active. It carries required `name` and positive `default_capacity`, plus optional description, category, location, notes, custom fields, and custom defaults. Its generation defaults have these supported values:

| Field | Supported values | Effect when a class is generated |
| --- | --- | --- |
| `default_visibility` | `public`, `hidden`, `members_only` | Copied to the new class's visibility. |
| `default_registration_policy` | `auto_approve`, `member_auto_approve`, `approval_required` | Copied to the new class's registration policy. |
| `default_membership_requirement` | `none`, `required` | Copied to the new class's membership requirement. |

The API defaults omitted values to `public`, `member_auto_approve`, and `none`. It validates custom fields/defaults before persistence. Template actions are list, get, create, update, and deactivate; deactivation sets status to `inactive` rather than deleting the record (`class-kit-templates/index.ts` (`repo:class-kit-api/supabase/functions/class-kit-templates/index.ts`), `20260607134535_template_class_core.sql` (`repo:class-kit-api/supabase/migrations/20260607134535_template_class_core.sql`)).

Templates are not registrable. The template function explicitly rejects registration-oriented actions, and the schema comment fixes registration to concrete `class_kit.classes` rows. A template update changes later generation input only: generation inserts copied name, description, defaults, notes, and custom defaults into a class row, so it does not retroactively rewrite previously generated classes (`class-kit-templates/index.ts` (`repo:class-kit-api/supabase/functions/class-kit-templates/index.ts`), `20260607153000_schedule_generation_engine.sql` (`repo:class-kit-api/supabase/migrations/20260607153000_schedule_generation_engine.sql`)).

## Schedule rules and lifecycle

A schedule has a name, source template, local start date/time, positive duration of 1–1,440 minutes, and a non-empty IANA timezone. The Edge Function additionally validates the timezone through `Intl.DateTimeFormat` and normalizes times to `HH:MM:SS` (`class-kit-schedules/index.ts` (`repo:class-kit-api/supabase/functions/class-kit-schedules/index.ts`)).

| Contract | Supported values and required conditions |
| --- | --- |
| Schedule status | `draft`, `active`, `paused`, `archived`; create defaults to `draft`. Only `active` schedules can generate classes. |
| Recurrence | `one_time`: no weekdays and no `ends_on`; it produces only `starts_on`. `weekly`: one or more unique weekday integers `0`–`6`, with optional `ends_on` no earlier than `starts_on`. |
| Skip | One optional skip per `(schedule, date)`, with an optional reason. A skip suppresses generation for that occurrence and is marked `skipped: true` in a preview. |
| Lifecycle controls | `pause` sets `paused`; `archive` sets `archived`; `create_skip` upserts a dated skip; `delete_skip` removes it. The general `update` action also accepts any supported status, so the implementation does not enforce a one-way state machine. |

Creating or updating an active schedule immediately invokes generation; draft, paused, and archived schedules return no automatic generation result. The separate `management.schedules.generate` entrypoint rejects an explicitly named schedule unless it is active. Pausing or archiving stops future generation; neither endpoint changes already generated class rows (`class-kit-schedules/index.ts` (`repo:class-kit-api/supabase/functions/class-kit-schedules/index.ts`), `class-kit-schedule-generate/index.ts` (`repo:class-kit-api/supabase/functions/class-kit-schedule-generate/index.ts`)).

## Generation and provenance

Generation is a service-role database function. It first requires an active product, verifies the optional schedule belongs to that product, then selects only schedules whose status is `active` and whose template status is `active`. Thus schedule activation alone is insufficient when its source template is inactive. A configured `generation_count`, or the product's `generation_horizon_weeks` when omitted, must be an integer from 1 through 52; the product default is 8 (`20260607112136_product_role_foundation.sql` (`repo:class-kit-api/supabase/migrations/20260607112136_product_role_foundation.sql`), `20260623080614_backfill_schedule_generation_from_start.sql` (`repo:class-kit-api/supabase/migrations/20260623080614_backfill_schedule_generation_from_start.sql`)).

For each schedule, the current implementation considers occurrences from `starts_on` (including historical dates) through `ends_on`, or up to one year after `starts_on` when unbounded; it retains only the first requested number of occurrences, then excludes skips. It resolves the local date and `start_time` through the schedule timezone and writes `starts_at`, `ends_at`, `generated_for_date`, and `source_timezone`. A generated class is initially `published` and lifecycle status `created`, with all class defaults copied from the source template.

The unique key `(product_id, schedule_id, generated_for_date, starts_at)` makes repeated generation idempotent: already present occurrences contribute to `existing_count`, newly inserted rows to `created_count`, and skipped candidates to `skipped_count`. Source-consistency constraints require either no schedule provenance for a manually created class, or all of `schedule_id`, `template_id`, `generated_for_date`, and `source_timezone` for a generated class (`20260623080614_backfill_schedule_generation_from_start.sql` (`repo:class-kit-api/supabase/migrations/20260623080614_backfill_schedule_generation_from_start.sql`), `20260608030000_generated_class_source_integrity.sql` (`repo:class-kit-api/supabase/migrations/20260608030000_generated_class_source_integrity.sql`)).

Preview is intentionally separate from generation: it calculates all matching occurrences in the caller's requested inclusive range, applies the schedule bounds and skips, and returns resolved UTC start/end times without creating rows. The SQL regression verifies historical backfill for the seeded Demo2 Monday schedule and confirms an explicitly requested historic manager range can see the generated June 15 class (`schedule_generation_backfill.sql` (`repo:class-kit-api/supabase/tests/schedule_generation_backfill.sql`)).

## Known gaps

- The snapshot has one backfill regression, but no dedicated automated coverage for schedule status transitions, inactive-template blocking, skip/unskip regeneration, invalid recurrence/timezone input, generation-count bounds, or idempotency counts.
- Schedule edits can regenerate rows for the same `generated_for_date` with a changed `starts_at`; the unique key prevents exact duplicates but does not demonstrate a reconciliation policy for superseded generated classes. No current test establishes the intended outcome.
- This page documents schedule and template policy only. The copied class visibility, membership, registration, and lifecycle values are enforced later by the class and registration flows; see [Class discovery, registration, and lifecycle](class-discovery-registration-and-lifecycle.md) and [Memberships and stock](memberships-and-stock.md).
