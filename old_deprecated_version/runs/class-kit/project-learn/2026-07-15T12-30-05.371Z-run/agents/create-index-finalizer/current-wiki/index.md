# ClassKit

ClassKit is a remote-backed, Supabase-based multi-product class platform: its SDK is the browser-facing contract, its Edge Functions and database own policy and state, and its apps are local control and dogfood surfaces.

## Orientation

The supported browser path is `frontend website -> @class-kit/react -> class-kit-* Edge Functions -> class_kit schema`. Websites own presentation and must not query ClassKit tables or RPCs directly. The SDK is a facade, not an authorization boundary; the backend resolves the product, checks access and permissions, and executes transactional state changes.

The sanitized checkout record identifies `master` at `4f55d94506f181d179f705173ecd54606b44c90c` and an `origin` remote at `https://github.com/khgs2411/class-kit.git`. See [repository identity](../state/repository-identity.json). No inspected repository document asserted a conflicting no-remote status.

## Canonical subjects

- [Architecture and supported API surface](architecture-and-api-surface.md) — layer ownership, SDK namespaces, and the public contract boundary.
- [Product resolution and access](product-resolution-and-access.md) — origin resolution, authentication policy, product-access entries, and membership creation.
- [Authorization and operational capabilities](authorization-and-capabilities.md) — platform/product roles, permission levels, explicit grants, and dashboard capabilities.
- [Classes, discovery, and lifecycle](classes-discovery-and-lifecycle.md) — visibility, publication, temporal state, customer-safe response shaping, and manager operations.
- [Registrations and eligibility](registrations-and-eligibility.md) — the order of registerability, active product-user, capacity, membership, approval, stock, and cancellation gates.
- [Membership types, grants, and ledger](memberships-and-ledger.md) — membership modes, grant states, stock, validity, replacement, and the immutable event record.
- [Templates and schedules](templates-and-schedules.md) — reusable defaults, recurrence, schedule state, generation, skips, and protected generated classes.
- [Attendance](attendance.md) — participant kinds, attendance values, and class attendance transitions.
- [Product documents](product-documents.md) — versioned markdown documents, publication/archive behavior, locale fallback, and acceptance snapshots.
- [Product change requests and Trello synchronization](change-requests-and-pm-sync.md) — revision threads, attachment lifecycle, request states, and external-status mapping.

## Core behavior contracts

### Product access takes precedence over product workflows

Product context first resolves a product from the request origin (with the local SDK product-key hint only for local browser origins). Anonymous callers receive product information only. An authenticated platform admin is **not** automatically a product user. For another authenticated caller, an existing active product user is reused; otherwise `open` access creates/activates product access and assigns the entry role (or `user`), while `invite_only` activates only an attached `invited` or `active` access entry. A caller with no invite in `invite_only` receives a pending self-request rather than a product membership.

`auth_mode` supports `open` and `invite_only`; email/password and Google OAuth availability are separate boolean product settings. Product-access entries support `invited`, `pending`, `active`, `rejected`, and `inactive`, and originate as `admin_invite` or `self_request`.

### Authorization does not collapse role level into permission keys

Platform roles and product roles both have numeric levels. Product-scoped level gates accept either a qualifying product role or a qualifying platform role; platform-scoped level gates accept only a platform role. Specific permission-key gates require an explicit grant in the applicable scope and do not follow the numeric hierarchy. Product role assignment itself must be active. The built-in roles are platform `platform_admin` (level 100), product `manager` (level 75), and product `user` (level 10); custom product roles are supported.

### Registration gate order and outcomes

Registration is allowed only after all of the following succeed: the class exists in the resolved product; it is published, not cancelled/in progress/completed, not started, and not hidden; the caller is an active product user; approved registrations are below capacity; and required membership or `members_only` visibility has an active membership grant. A failure at any earlier gate prevents policy evaluation and stock consumption.

For an eligible caller, `auto_approve` produces `approved`; `member_auto_approve` produces `approved` only with an active grant and otherwise `pending`; `approval_required` produces `pending`. Approved registrations consume one unit only for active `stock` or `limited_stock` grants. Registration status values are `pending`, `approved`, `rejected`, and `cancelled`; only one pending/approved registration can exist for a class and user.

Self-cancellation applies to pending or approved registrations. Pending cancellation is permitted after the cancellation cutoff; approved cancellation restores consumed stock only when the class has not started (or an authorized flow forces restoration). Manager actions also control approval/rejection/recovery and class cancellation has its own restoration behavior.

### State values are product behavior

Class publication is `draft` or `published`; class lifecycle is `created`, `cancelled`, `in_progress`, or `completed`; customer-facing temporal state is `upcoming`, `started`, `ended`, or `cancelled`. Visibility is `public`, `hidden`, or `members_only`; membership requirement is `none` or `required`; registration policy is `auto_approve`, `member_auto_approve`, or `approval_required`.

Schedules are `draft`, `active`, `paused`, or `archived`, and recur as `one_time` or `weekly` (weekly weekday values are `0` Sunday through `6` Saturday). Membership types and their grants have independently documented modes and state. Attendance supports `present` and `absent`; participants are `registered`, `walk_in`, or `trial`. Documents are `draft`, `published`, or `archived`. Change requests are `open`, `in_progress`, `done`, or `closed`; their external Trello work item can be `todo`, `in_progress`, `blocked`, `done`, or `unknown`, where `todo -> open`, `in_progress -> in_progress`, `blocked -> in_progress`, `done -> done`, and `unknown` leaves the request unchanged.

### Membership and schedule mode outcomes

Membership-type status is `active` or `inactive`; only an active type can grant membership. Grant status is `active`, `inactive`, `revoked`, `replaced`, or `expired`; registration sees only an active, not-expired grant. The supported modes are:

| Mode | Validity outcome | Stock outcome |
| --- | --- | --- |
| `stock` | No validity end is required. | A positive total/default stock is required and registrations consume it. |
| `limited_stock` | A validity end is required, supplied directly or by the type default duration. | A positive total/default stock is required and registrations consume it. |
| `limited` | A validity end is required, supplied directly or by the type default duration. | No stock is held or consumed. |
| `infinite` | No validity end is required. | No stock is held or consumed. |

An active grant is unique per product user. Granting requires an active product user and active membership type; changing to a different active type replaces the prior active grant, while revocation and stock adjustment append ledger events. A schedule must reference a template. `one_time` requires no weekdays and no end date; `weekly` requires one or more weekdays in the Sunday-through-Saturday range. Only an `active` schedule generates classes; `draft`, `paused`, and `archived` schedules do not generate new occurrences. A skip suppresses the matching schedule date until it is removed.

### Auth redirects, documents, attendance, and feedback

Auth redirect records distinguish `google` and `apple` providers and `development` and `production` environments, carry an origin or null origin, and designate at most the configured default redirect. Published product-document list and get operations are anonymous-safe for the resolved product; `get` prefers the requested locale and otherwise uses the supplied fallback locale. Only an active product user can accept the published version, and each acceptance snapshots the document type, locale, version, title, markdown content, and context. Managers with `product_documents.manage` create a new version or archive a version; publishing a version archives any previously published version with the same product, type, and locale.

Attendance listing needs the level-75 product gate; every attendance mutation needs `attendance.manage`. Starting attendance accepts default `present` or `absent` (default `absent`); participant updates accept `present` or `absent` (default `absent`); a walk-in defaults to `present`; trial participants are identified by a required name. The backend rejects unsupported lifecycle transitions, including starting a non-published/non-startable class and completing an ineligible class.

## Evidence and confidence

Current implementation is concentrated in `class-kit-api/supabase/functions/` and migrations, with the browser contract in `class-kit-sdk/src/`. SQL regressions cover member auto-approval, pending registration cancellation, schedule-generation backfill, and admin truncation. The remaining subject pages are canonical destinations for deeper curation; their source paths and verification gaps are recorded in the planner report.
