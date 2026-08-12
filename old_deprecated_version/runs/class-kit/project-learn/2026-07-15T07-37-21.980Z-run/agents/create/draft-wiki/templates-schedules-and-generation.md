# Templates, Schedules, And Generated Classes

Templates and schedule rules are product-management creation tools; the concrete class is the only operational record that users discover, register for, attend, or that staff manage.

## Evidence status

This subject is documented from the supplied documentation-only checkout. It contains no `class-kit-api/`, `class-kit-sdk/`, application source, migrations, or regression tests, so the API and lifecycle statements below are **documented contracts awaiting implementation and test verification**, not verified-current runtime behavior. The checkout identity is available on `master` with an `origin` remote, while `docs/repositories/structure.md` says the parent documentation repository should be local-only with no remote; that authorship claim is **conflicting and needs review** against `repository-identity.json`.

## Creation provenance

All paths result in a concrete class:

| Creation path | Entry point | Provenance and result |
| --- | --- | --- |
| Manual one-off | `management.classes.create(input)` without `templateId` | Standalone class; no template or schedule source fields. |
| Template-backed manual | `management.classes.create({ templateId, ... })` | Template supplies omitted defaults, but the new class remains standalone and is not schedule-generated. Template changes do not rewrite it. |
| Schedule-generated | `management.schedules.create(...)` with `generationCount`, or `management.schedules.generate(...)` | Class is created from a schedule rule and carries `scheduleId`, `templateId`, `generatedForDate`, and `sourceTimezone`. |

The documented backend contract rejects caller-supplied `schedule_id`, `generated_for_date`, and `source_timezone` on ordinary class creation. A generated class must have the complete source set; a standalone class has none. A template is reusable defaults and custom-field schema, not a live source of truth or a registerable resource. A schedule rule requires a template.

## Template contract

The management surface is `management.templates.list/get/create/update/deactivate`; its Edge Function is documented as `class-kit-templates`. Every method is product-scoped and backend-authorized—being called from `management.*` is not itself authorization.

Template creation requires `defaultCapacity`, `defaultVisibility`, `defaultRegistrationPolicy`, and `defaultMembershipRequirement`. It may also supply default name/description/category/location/notes, `customFields`, and `customDefaults`. `deactivate(templateId)` is an explicit operation because it removes the template from future manual creation and schedule-rule use. The snapshot does not expose a verified template-status enum or behavior for existing active schedules that reference a newly deactivated template.

## Schedule rule recurrence and state

Schedules are manager-visible source rules under `management.schedules.*`, not recurring classes. Customers never register for a rule or template; they act on the concrete generated class.

| Contract | Supported values / required condition | Documented outcome |
| --- | --- | --- |
| `recurrenceType` | `weekly`, `one_time` | `weekly` requires at least one unique `weekdays` value; `one_time` requires `weekdays: []` and no `endsOn`. |
| `weekdays` | integers `0`–`6` (`0` Sunday, `6` Saturday) | Defines weekly generation days. |
| `startsOn`, `endsOn`, preview range, skip date | `YYYY-MM-DD` | One-time uses `startsOn` only; `endsOn` must be omitted or `null`. |
| `startTime` | `HH:MM` or `HH:MM:SS` | Interpreted in the schedule IANA timezone. |
| `timezone` | valid IANA timezone | Establishes local scheduling semantics and generated-class `sourceTimezone`. |
| `durationMinutes` | integer `1`–`1440` | Duration of generated classes. |
| `generationCount` | integer `1`–`52`, when supplied | On create/update, generation runs only if the resulting rule is `active`. |
| schedule `status` | `active`, `draft`, `paused`, `archived` | Create/update with generation on `draft`, `paused`, or `archived` returns `generation: null`; `active` may generate. `pause` explicitly changes future-generation behavior; `archive` removes the rule from normal operation. |

The documented operations are `list`, `get`, `create`, `update`, `preview`, `generate`, `pause`, `archive`, `skipDate`, and `unskipDate`. `preview` calculates occurrences without mutation; `skipDate`/`unskipDate` alter generation for one date. The SDK intentionally hides backend action names `create_skip` and `delete_skip` behind those product-facing methods. The documentation does not specify the exact status transition matrix (for example, how a paused or archived rule becomes active), nor whether explicit `generate` accepts a non-active rule.

## Generation gates and precedence

The documented gate order is incomplete, but the supplied API contract establishes these dependencies:

1. Resolve product context and authenticate/authorize the management caller in the backend.
2. Confirm the product-owned template and schedule rule; schedule-specific input is validated before persistence.
3. For create/update with `generationCount`, evaluate the resulting schedule status: only `active` triggers generation; the other named statuses return `generation: null`.
4. Materialize concrete classes with schedule provenance. Those classes—not the rule—then pass through the normal discovery, registration, membership, approval, capacity, cancellation, and attendance rules.

`management.schedules.*` is permission-guarded, but the snapshot names only “product management authority,” not the exact permission key or its precedence relative to product access/membership gates. It also does not supply implementation evidence for atomicity, idempotency, duplicate-occurrence handling, or generation response counts.

## Generated-class protection: current conflict

The current API/SDK prose says generated classes can be “refreshed or protected” by schedule automation and that backend rules decide editable schedule-controlled fields. However, the more detailed schedule-lifecycle document is explicitly a **working draft, not approved for implementation planning**, and says the then-current generation model was insert-only with no explicit override marker, safe refresh, stale cleanup, or durable deleted-occurrence exclusion.

Treat the following as a proposed lifecycle, not verified current behavior:

- Editing a schedule/template-controlled field on a generated class marks it protected/overridden.
- Future automation refreshes only non-protected, safe generated classes.
- Stale generated classes are removed only when they lack operational activity (registrations, attendance, non-neutral lifecycle state, cancellation metadata, or future operational children).
- Removing or skipping an occurrence leaves a durable exclusion so it does not reappear.

The proposed controlled-field set includes template-derived name, description, category, capacity, location, visibility, registration policy, membership requirement, notes, and custom defaults; and schedule-derived timing, date, timezone, and duration. The proposal explicitly excludes unrelated operational notes and attendance-only state unless later added. This is a useful intended boundary, but neither its exact field set nor behavior is implementation-verified in this snapshot.

## Known gaps

- No source, migrations, RPC definitions, or regression tests verify the documented template/schedule methods, authorization, validation, or state transitions.
- No verified template lifecycle enum, deactivation behavior for referenced rules, schedule status-transition matrix, or explicit-generation eligibility rule is present.
- The schedule generation contract lacks verified idempotency, duplicate handling, transaction boundaries, response counts, and interaction with registration/membership/approval gates.
- Generated-class protection, refresh, stale cleanup, and durable deletion/exclusion are internally conflicting: broad API prose describes them, while the detailed lifecycle design calls them unimplemented proposals. Implementation and regression evidence is required before treating any as current.
- Repository identity conflict: `repository-identity.json` records an `origin` remote, whereas `docs/repositories/structure.md` says the parent docs repository should have none.

## Evidence

- `docs/shared/context.md` defines the domain terms and the non-live-template/protected-generated-class boundary.
- `docs/api/class-api-map.md`, `docs/api/backend-api.md`, and `docs/sdk/client-sdk.md` describe the public management surface, provenance fields, recurrence validation, and documented generation gates.
- `docs/design/2026-06-25-schedule-lifecycle-management/spec.md` is used only to identify the proposed protection lifecycle and its explicit implementation gap; it is not evidence of current runtime behavior.
