# Design History and Unresolved Proposals

This page is the controlled entrypoint for ClassKit design material that is useful for context but does not automatically define the current product contract.

Use the living documentation for implementation decisions: [`docs/shared/context.md`](../target-repo/docs/shared/context.md), [`docs/api/class-api-map.md`](../target-repo/docs/api/class-api-map.md), [`docs/sdk/client-sdk.md`](../target-repo/docs/sdk/client-sdk.md), [`docs/api/backend-api.md`](../target-repo/docs/api/backend-api.md), and accepted ADRs. An archived spec, plan, agenda, or pseudocode file must be reconciled with those sources and the affected code before it is implemented.

## How to read the archive

| Archive status | Meaning | Implementation use |
| --- | --- | --- |
| Accepted / approved | A durable decision at the time it was made. | Preserve its boundary unless a newer living contract or accepted decision supersedes it. |
| Draft / working draft | A proposed direction, possibly with useful constraints. | Do not plan or implement unresolved behavior as settled. |
| Pseudocode / plan | Non-executable design or sequencing material. | Use it to find intent and affected surfaces; verify present code and documentation. |

The archive records decisions at different stages. A later release document or current API reference wins when it gives a more specific, implemented contract.

## API-pattern design: accepted foundation

[`docs/design/2026-06-22-class-kit-api-pattern/spec.md`](../target-repo/docs/design/2026-06-22-class-kit-api-pattern/spec.md) is **approved for implementation planning**; its [`agenda.md`](../target-repo/docs/design/2026-06-22-class-kit-api-pattern/agenda.md) records final review with all live questions resolved. It established the durable four-layer boundary:

- Database/RPC owns state, constraints, transactions, and RLS backstops.
- Edge Functions own product context, authorization, validation, orchestration, and safe response shaping.
- The typed SDK owns product-facing methods and response normalization, never security.
- Websites own UI and must not know backend actions, permission rules, or transport payloads.

It also settled the `management.*` operational namespace, caller-safe `classes.*`, explicit lifecycle commands, backend-enforced class field policy, and role-permission bundles rather than direct user permission copies. The hard-switch decision means ClassKit-owned apps should migrate old facade names rather than retaining compatibility wrappers. These are reflected in the current SDK and API map; use those current references for exact method names, parameters, and availability.

The implementation plans and pseudocode in the same directory are historical handoff material, not evidence that every listed method or migration remains pending. Internal Edge Function action names were deliberately left as a chunk-level cleanup decision, so SDK naming must not be inferred from raw action strings.

## Permission-bundle views: draft boundary, not a release commitment

[`docs/design/2026-06-23-product-permission-bundle-views/pseudocode/README.md`](../target-repo/docs/design/2026-06-23-product-permission-bundle-views/pseudocode/README.md) is explicitly **Draft** and says that all source-like artifacts are non-executable. Its valuable enduring boundary is:

- a manager edits product-role bundles only within product authority;
- platform admin controls cross-product/admin paths, including any protected built-in manager-bundle exception;
- the backend owns permission catalog and mutation rules; SDK facades hide Edge Function actions; and
- direct user-permission overrides remain a separate capability, not an implementation shortcut for role bundles.

The accepted authorization baseline is [`docs/adr/0001-scoped-product-permission-layer.md`](../target-repo/docs/adr/0001-scoped-product-permission-layer.md): level checks and explicit product permission-key checks intentionally have different authority rules. The current vocabulary in `docs/shared/context.md` likewise says current role permission bundles are sufficient and direct user overrides are not needed. Do not treat the draft's proposed catalog labels, UI layout, or protected-role mutation mechanism as accepted without checking the current API and schema.

## Schedule lifecycle: partially carried forward, still unresolved as a whole

[`docs/design/2026-06-25-schedule-lifecycle-management/spec.md`](../target-repo/docs/design/2026-06-25-schedule-lifecycle-management/spec.md) is a **working draft, not approved for implementation planning**. It proposes stronger lifecycle semantics: schedule rules materialize concrete classes; template/rule-controlled edits protect a generated class; automation may refresh only safe classes; and generation should report effects rather than silently changing records.

Two design results have been incorporated into the living domain language in [`docs/shared/context.md`](../target-repo/docs/shared/context.md): a **Schedule** is the manager-visible set/calendar, a **Schedule Rule** is the managed source entity, and a **Protected Generated Class** is skipped by later controlled-field refresh and stale cleanup. The current supported SDK contract remains `management.schedules.create`, `update`, `preview`, `generate`, `pause`, `archive`, `skipDate`, and `unskipDate` in [`docs/sdk/client-sdk.md`](../target-repo/docs/sdk/client-sdk.md); `ensureRange` and `extendRange` are proposals, not documented current APIs.

Before scheduling further lifecycle work, resolve the still-open questions in [`agenda.md`](../target-repo/docs/design/2026-06-25-schedule-lifecycle-management/agenda.md):

- whether a materialized generated occurrence is skipped, removed, or cancelled, including the audit-safe behavior for operational classes;
- the exact safe refresh/stale-cleanup rule when registrations, attendance, lifecycle state, or overrides exist;
- the first Demo2 proof scope; and
- whether generation needs a narrower permission than `schedules.manage`.

The initial controlled-field list is also intentionally deferred to implementation planning. Do not scatter it through a website UI or assume a generated class can safely be deleted merely because it is future-dated.

## PM software integration: proposal largely superseded by the released Trello contract

[`docs/design/2026-07-08-pm-software-integration/pseudocode/README.md`](../target-repo/docs/design/2026-07-08-pm-software-integration/pseudocode/README.md) and its source-like files are **Draft / non-executable**. They proposed a strong boundary that remains useful: managers create internal `management.changeRequests.*`; only platform admins promote those threads to external PM software; credentials and provider calls remain server-side; provider-specific details sit behind a provider-neutral boundary.

The first Trello slice is now released as v0.1.18 in [`docs/changelog.md`](../target-repo/docs/changelog.md) and defined authoritatively by the current [`docs/api/backend-api.md`](../target-repo/docs/api/backend-api.md) and [`docs/sdk/client-sdk.md`](../target-repo/docs/sdk/client-sdk.md). It uses the `admin.pmIntegrations.*` namespace, one global board/list route configuration, server-side `TRELLO_API_KEY` and `TRELLO_TOKEN`, admin-created cards, attachment mirroring, explicit link detach/replacement, and admin-triggered status sync. Product websites and manager dashboards continue to use only ClassKit change-request state.

Important reconciliation: the draft and [`AgreedImplementationShape.md`](../target-repo/docs/design/2026-07-08-pm-software-integration/pseudocode/AgreedImplementationShape.md) named Trello labels as a non-goal, but the released contract supports configured global label mappings and selected labels when creating a card. The current backend/SDK documents therefore override the archived no-label direction. Remaining intentional non-goals include product-specific board overrides, webhooks, OAuth/per-admin Trello auth, and automatic manager-created external cards.

## Open-work checklist

When a request points to an archived artifact, first classify it:

1. Match it to a current SDK/API/ADR contract or a released changelog entry.
2. If it is not current, identify whether it is an accepted decision awaiting implementation or an unresolved draft question.
3. For schedule lifecycle work, settle the removal/skip/cancel and safe-cleanup contracts before producing an implementation plan.
4. For permission or PM work, keep manager/product, platform-admin, SDK, and provider boundaries intact; do not expose backend or provider details to product websites.

Known archive gaps: no single status ledger marks every historical plan as completed, superseded, or abandoned; the schedule lifecycle draft has no final approval; and the PM pseudocode does not reflect the final label-mapping addition. Treat these gaps as prompts to verify, not as permission to infer behavior.
