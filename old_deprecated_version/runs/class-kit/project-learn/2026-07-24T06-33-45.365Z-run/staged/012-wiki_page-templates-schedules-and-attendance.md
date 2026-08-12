# Templates, schedules, and attendance

Templates provide product-scoped defaults; schedules turn an active template into dated, concrete classes; attendance records what happened for the participants of those classes. These are manager-domain operations exposed through the `class-kit-templates`, `class-kit-schedules`, `class-kit-schedule-generate`, and `class-kit-attendance` Edge Functions, rather than direct client table or RPC access.

## Authority and product boundary

Every operation resolves a product context before reading or changing data and scopes queries by its `product_id`. A template used by a schedule must belong to that same product; the database also enforces the `(template_id, product_id)` and `(schedule_id, product_id)` relationships. This prevents a manager in one product from using another product's source configuration or attendance data.

Manager read operations (`list`, `get`, and schedule `preview`; attendance `list_class`) require product permission level 75. Mutations require the product-scoped `templates.manage`, `schedules.manage`, or `attendance.manage` permission respectively. The SDK's manager API is the browser-facing typed facade for these manager operations; the service role performs the underlying restricted database calls. Users cannot register for a template: `class-kit-templates` rejects registration-named actions because registration is always against a concrete class.

## Templates are source defaults, not classes

`class-kit-templates` lets an authorized manager list, get, create, update, and deactivate templates. Creation requires a name and positive `default_capacity`; description, category, location, notes, custom fields, and custom defaults may be supplied. The service normalizes custom fields/defaults before persistence. A new template is active unless later deactivated.

The supported template default values are:

| Contract | Values and user-visible effect |
| --- | --- |
| `default_visibility` | `public` makes a generated published class publicly discoverable; `hidden` makes it non-registerable; `members_only` requires an active membership for discovery and registration. Default: `public`. |
| `default_registration_policy` | `auto_approve` approves a permitted registration; `member_auto_approve` approves an active member and otherwise leaves a permitted registrant pending; `approval_required` leaves it pending. Default: `member_auto_approve`. |
| `default_membership_requirement` | `none` does not itself require membership; `required` rejects a registrant without an active membership. Default: `none`. |
| template `status` | `active` may feed generation; `inactive` cannot feed generation. `deactivate` sets this value to `inactive`; it does not delete the template. |

Generation copies the template's name, descriptive fields, capacity, complete location text/snapshot pair, visibility, registration policy, membership requirement, notes, and custom defaults into each generated class. It does not make future template edits retroactively rewrite existing classes; a generation conflict likewise does not refresh its stored location pair. See [Structured lesson locations and autocomplete](classes-and-registrations.md#structured-lesson-locations-and-autocomplete) for snapshot, free-text fallback, and autocomplete behavior.

### Custom-field validation is not discovery policy

Each template can define `custom_fields` and object-valued `custom_defaults`. Field keys must be unique identifier-like names; supported types are `text`, `long text`, `number`, `boolean`, `select`, `multi-select`, `date`, and `URL`. Select types require configured options, defaults may name only defined fields and must match their declared types, and class data must satisfy every required field after defaults are merged. Thus template-backed class creation/update rejects undefined keys, type-invalid values, and missing required values.

The current class-list contract consumes both flags as template-governed discovery policy. A customer `fields: ["customData"]` request exposes only visible, type-valid stored values; a filter may name only fields that are both visible and searchable. Malformed or stale policies fail closed, and filtering never itself adds the customer projection. The current SDK source types and maps these options on class list/get calls, while leaving policy validation and matching to the backend. See [Classes and registrations](classes-and-registrations.md#custom-data-query-and-response-boundary) for the verified list and response boundary.

For a generated class, the gates are ordered materially as follows: the class must first be published, not cancelled, and not started/ended to be registerable; `hidden` blocks registration; membership is then required if either `membership_requirement` is `required` or visibility is `members_only`; only after those gates does the registration policy choose approved (`auto_approve`, or `member_auto_approve` with an active membership) versus pending. Thus policy never bypasses visibility, lifecycle, or membership gates. The concrete registration engine is in `class-kit-api/supabase/migrations/20260701084833_fix_member_auto_approve_registration.sql`.

## Schedule rules, previews, and generation

A schedule has a same-product template, name, status, recurrence, dates, local start time, duration, and IANA timezone. Creation defaults to `draft`; it may be created or updated as `draft`, `active`, `paused`, or `archived`. `pause` and `archive` explicitly set the latter two statuses. Only `active` schedules are eligible for generation, and they also require an active template. A direct generation request naming a non-active schedule is rejected with a conflict.

Recurrence is deliberately limited:

| Recurrence | Required shape | Outcome |
| --- | --- | --- |
| `one_time` | `starts_on`; no weekdays and no `ends_on` | One eligible occurrence on `starts_on`. |
| `weekly` | At least one unique weekday `0`–`6`; optional `ends_on` no earlier than `starts_on` | Eligible occurrences on those weekdays from the start date through the earlier of the requested preview range or schedule end. |

Times are validated as local `HH:MM[:SS]`, duration is 1–1,440 minutes, and the timezone must be a valid IANA zone. Preview returns each occurrence's local time, resolved UTC start/end, timezone, and whether that date is skipped; it is a read-only planning view.

Managers can create an idempotent skip for a schedule/date (with an optional reason) and delete that skip. A skip suppresses generation for that date and is counted in the generation result. Removing it only removes the skip rule; it does not itself generate a class. Both actions are reversible operational controls, unlike a product truncation.

`class-kit-schedule-generate` can generate for one schedule or all eligible schedules in the product. The optional `generation_count` must be an integer from 1 through 52; absent a request value, the product's configured horizon is used, falling back to 8. Candidate occurrences start at the later of `starts_on` and today and are limited per schedule by that count. The generator returns `created_count`, `existing_count`, and `skipped_count`, and is idempotent under the unique generated-class identity `(product_id, schedule_id, generated_for_date, starts_at)`. Generated classes are published with lifecycle `created` and retain their source schedule/date/timezone. The SQL regression in `class-kit-api/supabase/tests/schedule_generation_backfill.sql` verifies seeded historical weekly dates and their visibility to an explicit manager range.

## Attendance lifecycle and participant outcomes

Attendance applies only to a concrete class. A manager can list participants, start attendance, update an existing participant, add a walk-in, add a trial participant, and complete attendance. Supported attendance statuses are `present` and `absent`.

Starting attendance requires a published class whose lifecycle is `created` or already `in_progress`; it changes `created` to `in_progress` and imports every approved registration as a `registered` participant. The default imported status is `absent` unless the manager provides `present`. Re-starting while in progress upserts those registered participants and resets them to that selected default. A cancelled or completed class cannot start attendance.

Once attendance has started, participant outcomes are:

| Participant kind | Admission rule | Initial status |
| --- | --- | --- |
| `registered` | Imported only from an approved registration when attendance starts. A registration identity can appear once. | Start's default: `absent` unless supplied as `present`. |
| `walk_in` | Requires an active product user, an in-progress class, no live (`pending` or `approved`) registration for that user/class, and no existing registered/walk-in participant for that user/class. | `present` unless the manager supplies `absent`. |
| `trial` | Requires an in-progress class and a nonblank name; it has no product user or registration. | Always `present`. |

`update_attendance` can set either status only while the class is `in_progress` or `completed`; it cannot be used before attendance starts. `complete` is allowed only from `in_progress` and permanently changes the class lifecycle to `completed` for normal manager operations. Completion does not delete participant evidence, and the API intentionally continues to allow status corrections on completed attendance; it cannot be reopened through the documented attendance actions.

## Destructive and irreversible boundary

Template deactivation, schedule pause/archive, skip deletion, and attendance completion change availability or workflow state but do not delete their underlying rows through these manager APIs. There is no template or schedule hard-delete action here.

The related irreversible operation is intentionally outside this manager boundary: `class-kit-admin-products` exposes `truncate_product` only to platform permission level 100. Its `class_kit_private.truncate_product` implementation permanently deletes product-scoped participants, registrations, skips, classes, schedules, template rows, memberships, access entries, and non-admin product users/roles, while preserving/re-establishing the acting platform administrator as an active product manager. The regression at `class-kit-api/supabase/tests/truncate_product_admin_action.sql` verifies both deletion of the target product's operational rows and isolation of another product. Treat this as a reset, not as a manager scheduling control.

## Evidence and known gaps

Current implementation evidence: `class-kit-api/supabase/functions/class-kit-templates/index.ts`, `class-kit-api/supabase/functions/class-kit-schedules/index.ts`, `class-kit-api/supabase/functions/class-kit-schedule-generate/index.ts`, `class-kit-api/supabase/functions/class-kit-attendance/index.ts`, `class-kit-api/supabase/migrations/20260607134535_template_class_core.sql`, `class-kit-api/supabase/migrations/20260607143000_schedule_rule_model.sql`, `class-kit-api/supabase/migrations/20260609120000_schedule_generation_count.sql`, and `class-kit-api/supabase/migrations/20260607170000_attendance_engine.sql`.

The checked snapshot has focused SQL regression coverage for schedule-generation backfill and product-truncate isolation, but no focused regression test was found for template custom-field/default validation, schedule status/skip API behavior, or the attendance lifecycle and participant conflict cases. Those contracts are implementation-grounded but should gain focused regression coverage.
