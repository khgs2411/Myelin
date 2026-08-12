# Project Memory Markdown Apply Pseudocode Artifacts

Status: Draft

## Source Artifacts

- `docs/ROADMAP.md`
- `MYELIN.md`
- `CONTEXT.md`
- `docs/design/2026-06-18-project-memory-curator/spec.md`
- `docs/design/2026-06-18-project-memory-curator/agenda.md`
- `docs/design/2026-06-18-project-memory-curator/plan.md`
- `docs/design/2026-06-18-project-memory-curator/pseudocode/README.md`
- `docs/adr/0018-project-learn-can-read-live-repo.md`
- `docs/adr/0019-project-learn-auto-applies-by-default.md`
- `docs/adr/0020-gate-risky-project-learn-changes.md`
- `docs/adr/0058-use-mode-scoped-project-learn-curator-contracts.md`

External audit note: older context sometimes refers to renamed/stale ADR paths such as
`0018-claim-centric-project-memory`, `0019-project-memory-source-registry`,
`0020-project-memory-maintenance-artifacts`, and `0058-add-project-memory-curator-for-create-mode`.
Use the current ADR filenames listed above for this design.

Code context inspected:

- `src/commands/project.ts`
- `src/project/project-service.ts`
- `src/project/project-memory-packet.ts`
- `src/project/project-memory-lookup.ts`
- `src/project/project-memory-curator-contracts.ts`
- `src/project/project-memory-curator-validator.ts`
- `src/project/project-memory-curator-service.ts`
- `src/runtime/project-run-infrastructure.ts`
- `tests/project/project-memory-curator-service.test.ts`
- `tests/project/project-memory-curator-validator.test.ts`
- `tests/commands/project.test.ts`

## Draft Shape Summary

The next Step 3 slice turns `project learn` from a validated pre-write proposal flow into a bounded Project Memory markdown apply flow for both Project Memory creation mode and maintenance mode.

The important shape change is that the current `content_intent`-only curator item is not enough for deterministic apply. Apply should consume validated curator artifacts, but the artifact must include concrete structured page or entry content before any canonical markdown mutation is possible. The applier should render structured curator content into a stable markdown block format, not ask another model to interpret intent during apply.

The apply layer should:

- run only after curator output validates;
- skip mutation for `--dry-run`, `--review`, invalid, rejected, quarantined, or review-required runs;
- publish validated creation drafts as initial wiki pages and curated Project Memory state;
- apply validated maintenance proposals to targeted wiki pages and narrow state/provenance metadata;
- write an apply journal before canonical promotion and recover incomplete promotion before new curator work;
- write apply artifacts with before/after hashes, bounded before/after snippets, and page/item-level outcomes;
- write project-level Project Memory Source Consumption state and mirror consumed refs in run artifacts;
- render provenance and inference labels into durable markdown near each meaningful claim;
- keep markdown canonical and treat SQLite/vector indexes as future derived serving state.

## Assumptions Made

- The apply implementation should require stronger curator output than the current contract provides.
- Maintenance mode remains constrained to existing wiki pages unless the contract and validator add an explicit narrow new-page operation.
- Creation mode page publication is part of this apply boundary: a valid creation draft needs concrete page content, provenance, and state updates owned by code.
- Trusted Project Memory for apply means `projects/<key>/state/project-memory.json.status === "curated"`; `bootstrap-state.status === "curated"` alone is not enough to treat wiki markdown as maintenance-ready.
- The applier should be deterministic TypeScript code under `src/project/`, with only mechanical artifact helpers under `src/runtime/`.
- `project learn` auto-applies routine low-risk output by default, while `--dry-run`, `--review`, validation failure, degraded packet context, high risk, or quarantine stop before canonical writes.

## Non-Executable Rule

Every source-like file in this folder is pseudocode reference material, not implementation.

## Artifact Map

| Artifact | Type | Intended Destination | Responsibility |
| --- | --- | --- | --- |
| `src/project/project-memory-apply-contracts.ts` | File-shaped | `src/project/project-memory-apply-contracts.ts` or merged into existing curator contracts | Defines concrete apply payloads, apply summaries, and changeset artifact shapes. |
| `src/project/project-memory-markdown-applier.ts` | File-shaped | `src/project/project-memory-markdown-applier.ts` | Owns deterministic staged rendering, journal-backed canonical promotion, source-consumption state writes, and markdown mutation from validated curator artifacts. |
| `src/project/project-memory-curator-service.ts` | File-shaped | Existing `src/project/project-memory-curator-service.ts` | Shows how `runProjectLearn` should preflight incomplete apply journals, call validation, gate apply, write artifacts, and report final status. |
| `ProjectMemoryEntryBlockFormat.md` | Boundary-shaped | Wiki markdown convention plus validator/applier behavior | Defines the durable markdown block shape for entry ids, lifecycle, provenance, and inference labels. |
| `ProjectLearnMarkdownApplyFlow.md` | Flow-shaped | Multiple files | Captures sequencing from recovery preflight through packet, curator, validation, journaled apply, artifacts, source-consumption records, and failure states. |
| `ProjectApplyGateBoundary.md` | Boundary-shaped | `src/project/*`, `src/runtime/*`, CLI result surface | Defines who may mutate canonical Project Memory, which states must stop before writes, and which canonical/run artifact writes are allowed. |

## Cross-Artifact Relationships

- `project-memory-apply-contracts.ts` gives the curator and applier a concrete content payload vocabulary.
- `project-memory-markdown-applier.ts` consumes the input packet, curator output, validation result, run paths, apply journal, and staged outputs; it never calls providers.
- `project-memory-curator-service.ts` remains the orchestration owner for `project learn`, including recovering incomplete apply journals before a new curator run and deciding whether apply is allowed for this run.
- `ProjectMemoryEntryBlockFormat.md` is the markdown convention the applier renders and the validator can reason about.
- `ProjectLearnMarkdownApplyFlow.md` describes the end-to-end lifecycle and where artifacts are written.
- `ProjectApplyGateBoundary.md` prevents provider output, rejected items, quarantine, dry-run, or review mode from mutating canonical markdown.

## Libraries And Conventions To Preserve

- Preserve Bun/TypeScript runtime patterns already used in `src/project/`.
- Use existing path helpers such as `projectPath` and `resolveInside` for wiki paths.
- Use existing stable JSON and run artifact helpers from `src/runtime/json.ts` and `src/runtime/project-run-infrastructure.ts`.
- Keep provider invocation in `src/runtime/llm-client.ts`; apply is deterministic and provider-free.
- Keep markdown Project Memory canonical; future vector/index state must derive from markdown.
- Keep root core detached from MCP implementation.

## Must Preserve

- Concrete content is represented as structured page/entry payloads rendered by deterministic code, not exact markdown patches or `content_intent` write authority.
- Creation drafts publish page bodies and maintenance proposals append/update stable entry blocks through deterministic rendering.
- `project learn` auto-applies only when validation passes, risk gates pass, and neither `--dry-run` nor `--review` is set.
- Apply is all-or-nothing for the target write set using staged outputs, an apply journal, and recovery preflight before any new curator work.
- Changesets include bounded before/after snippets for changed blocks or page sections, plus hashes and provenance.
- Successful apply writes Project Memory Source Consumption records to project state and mirrors them in run artifacts.
- Creation publication requires a trusted `index.md` plus at least one meaningful domain page or an explicit no-domain-pages rationale before marking `project-memory.json` curated.
- Candidate/handoff status mutation is left to a later reconciler; this slice writes source-consumption evidence only.
- The proposed block markers and provenance rendering remain planning guidance unless implementation records an evidence-backed divergence.

## Planning Handoff

`$pmp-writing-plans` should preserve these pseudocode-defined files, flows, boundaries, method grammar, and ownership unless it records an evidence-backed divergence in `plan.md`.

Any implementation plan should explicitly handle the existing test drift where current tests assert `stopped_before_writes: true` for all successful curator runs.

## Open Risks Or Allowed Divergence

- Existing curator contracts use `content_intent`, which is useful for review but weak for deterministic apply. Implementation may replace it, supplement it, or introduce a versioned apply payload, but should not let code apply free-form intent text as canonical memory.
- The durable wiki block syntax may need to evolve after seeing real pages. Small marker/name changes are allowed if the same ownership and provenance properties hold.
- Implementation planning may sequence creation and maintenance internals for verification safety, but the product boundary remains one apply slice that covers both modes. Deferring a mode requires a product-safety reason, not workload avoidance.
- Candidate/handoff lifecycle updates after successful apply are out of scope for this slice; apply writes Project Memory Source Consumption evidence for a later reconciler.
- Derived Project Memory retrieval indexing is explicitly out of scope for this slice.
