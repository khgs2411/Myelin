# Class, template, and schedule lifecycle

Concrete classes are the user-facing and operational unit in ClassKit; templates and schedules are management-only sources for creating future concrete classes. This page describes the current database and Edge Function contract in `class-kit-api`.

## Model and provenance

`class_kit.classes` represents a bookable event. Registration, cancellation, attendance, publication, visibility, capacity, and lifecycle status attach to this row, not to its optional template or schedule. The core schema is defined in `class-kit-api/supabase/migrations/20260607134535_template_class_core.sql`.

There are three supported origins:

| Origin | Source fields | Creation behavior |
| --- | --- | --- |
| Standalone manual class | `template_id`, `schedule_id`, `generated_for_date`, and `source_timezone` are null | `class-kit-classes` `create` requires class details and creates a draft unless `status` is supplied. |
| Template-backed manual class | `template_id` is set; schedule source fields are null | An active template supplies omitted fields and custom-data defaults. The resulting class remains independent of the template. |
| Schedule-generated class | `template_id`, `schedule_id`, `generated_for_date`, and `source_timezone` are all set | The schedule generator snapshots the active template’s defaults into a published, `created` class. |

The generated-source integrity migration (`20260608030000_generated_class_source_integrity.sql`) makes the last two schedule provenance cases mutually exclusive: all three schedule fields must be null for a non-generated class, or all must be present. A generated class must reference a schedule and template in the same product, and its template must match the schedule’s template. The unique key `(product_id, schedule_id, generated_for_date, starts_at)` makes generator retries idempotent for a resolved occurrence.

The class Edge Function rejects caller-controlled `schedule_id`, `generated_for_date`, and `source_timezone` on both create and update. It also rejects changing `template_id` on an already generated class (`class-kit-api/supabase/functions/class-kit-classes/index.ts`). Other ordinary class fields are updateable through the management API; changing a template or schedule later does not back-propagate to classes already generated.

Templates are reusable default sets, not discoverable or registerable entities. They have `active` and `inactive` states. Their defaults include capacity, location, visibility, registration policy, membership requirement, notes, custom fields, and custom defaults. Templates can be created, updated, and deactivated only by callers with `templates.manage`; list/get requires product permission level 75 (`class-kit-api/supabase/functions/class-kit-templates/index.ts`). An inactive template cannot seed a manual class and is excluded from generation.

## Class publication, visibility, and lifecycle

Two independent class state fields matter:

| Contract | Values and effect |
| --- | --- |
| Publication `status` | `draft` is not customer-discoverable or registerable. `published` is a prerequisite for discovery, registration, and attendance start. Management can explicitly `publish` or return a class to `draft`. |
| Operational `lifecycle_status` | `created` is the normal pre-attendance state. `in_progress` is entered by starting attendance. `completed` is entered only by completing attendance. `cancelled` is entered by the cancel-class transaction. |

The permitted lifecycle writers define the effective transitions: `created -> in_progress -> completed` comes from the attendance RPCs; `created` or `in_progress` can be cancelled through the class cancellation command. Starting is idempotent while already `in_progress`, but rejects `cancelled` or `completed`; completing requires `in_progress` (`20260607170000_attendance_engine.sql`). The database enum also allows the values, but direct state mutation is not a supported product API.

Cancellation is not a publication change. `classes:cancel` calls `cancel_class_with_registration_restoration`, which locks the class, restores consumed membership stock for approved live registrations, changes pending and approved registrations to `cancelled`, then sets `lifecycle_status = 'cancelled'` (`20260607160000_registration_engine.sql`). The Edge Function may then store a cancellation reason and whether it is user-visible. `publish` and `draft` only change publication status; neither reverses cancellation.

Visibility is separate from both state fields:

| Visibility | Anonymous visitor | Authenticated active product user | Authenticated user with active membership |
| --- | --- | --- | --- |
| `public` | May discover if published and not cancelled | May discover if published and not cancelled | May discover if published and not cancelled |
| `members_only` | Not discoverable | Not discoverable without an active membership | May discover if published and not cancelled |
| `hidden` | Not discoverable | Not discoverable through customer discovery | Not discoverable through customer discovery |

Product managers can read all product classes, including drafts and hidden/cancelled rows, through management endpoints after level-75 authorization. The current RLS policies and customer endpoints use `status = 'published'` plus `lifecycle_status <> 'cancelled'`; this is intentionally broader than the original `created`-only policy and means started/completed classes can remain readable. Customer-oriented `list_public` and `list_user` additionally return only future `starts_at` values. The generic `list`/`get` API accepts a date range and can return non-cancelled past classes when requested.

Registration has stricter precedence than visibility: it requires a published, non-cancelled, not-in-progress/not-completed class whose start time is still in the future. Hidden classes are never registerable. Membership and registration policy gates then apply in the registration RPC; this page does not redefine their approval/stock behavior.

## Schedule rules and generation

Schedules always belong to one product and require an in-product template (`20260607143000_schedule_rule_model.sql`). Their state is one of:

| Schedule status | Generation outcome |
| --- | --- |
| `draft` | Stored and previewable; does not generate classes. |
| `active` | Eligible for generation while its template is active; create/update triggers generation immediately. |
| `paused` | Stops future generation; existing generated classes remain unchanged. |
| `archived` | Stops future generation; existing generated classes remain unchanged. |

Two recurrence modes are supported:

| `recurrence_type` | Required shape |
| --- | --- |
| `one_time` | Uses `starts_on` only; `weekdays` must be empty and `ends_on` null. |
| `weekly` | Requires one or more unique weekday integers, with `0` Sunday through `6` Saturday; it may have an inclusive `ends_on` no earlier than `starts_on`. |

Every schedule also has a local `start_time`, duration of 1–1,440 minutes, and a valid IANA timezone. Preview calculates local occurrences and their UTC start/end timestamps without mutation, including a `skipped` flag. A skip is unique per `(schedule_id, skip_date)` and can be created, overwritten with a reason, or deleted; it prevents that candidate occurrence from being generated.

Create, update, pause, archive, skip, and unskip require `schedules.manage`; list, get, and preview require level 75. Creating or updating an active schedule automatically invokes generation, optionally with `generation_count` 1–52. The explicit schedule-generation endpoint has the same permission and refuses an explicitly selected non-active schedule.

Generation reads only active schedules paired with active templates. It enumerates a schedule from its `starts_on` (including historical dates) up to its `ends_on` or one year after start, limits each schedule to the earliest requested number of occurrences (default: the product’s `generation_horizon_weeks`, then 8), removes skipped dates, resolves local date/time using the schedule timezone, and inserts a snapshot of template defaults. Inserted classes are always `published` and `created`. Results report `created_count`, `existing_count`, and `skipped_count`; conflict handling prevents duplicate provenance rows. The backfill behavior is covered by `class-kit-api/supabase/tests/schedule_generation_backfill.sql`.

## Management implications

- Deactivate a template to prevent it from being used for future manual template-backed creation or generation; it does not mutate existing classes or schedules.
- Pause or archive a schedule to stop later generation. Neither command deletes, hides, cancels, or otherwise revises classes it generated previously.
- Add a skip before generation to suppress a specific date. Adding a skip after a class already exists does not delete or cancel that class; the generator is insert-only.
- Use class `cancel`, not `draft`, when registrations and membership-stock restoration must be handled transactionally.
- Use attendance start/complete for operational lifecycle progression; elapsed time affects customer-facing temporal labels and registration openness but does not itself write `lifecycle_status`.

## Known gaps

- The snapshot contains a focused SQL regression test for historical schedule backfill, but no dedicated automated tests were found for schedule state transitions, skip-after-generation behavior, template deactivation effects, visibility/membership combinations, or direct class lifecycle transition rejection.
- Generated rows are deliberately snapshots, but the current function permits ordinary field updates on those rows. There is no source-level evidence here of a product policy for reconciling an already generated class after a schedule rule is edited.
