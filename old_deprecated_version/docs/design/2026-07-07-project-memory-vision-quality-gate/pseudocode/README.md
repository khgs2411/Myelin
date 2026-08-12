# Project Memory Vision-Quality Gate Pseudocode Artifacts

Status: Draft

## Draft Shape Summary

Step 6.5 adds a product-quality gate after the rendered create contract and independent usefulness critique. The gate separates "foundation-valid" output from "good enough to trust as living repo documentation" by checking representative questions from `MY_VISION.md`, citation precision, and live dogfood strength when available.

This set is intentionally narrow. It does not redesign rendering, apply, retrieval, or candidate intake. It only shapes the first-create trust gate that decides whether a foundation-valid Project Memory set should be called trustworthy or kept in a lower-trust terminal state.

## Assumptions Made

- The gate runs only for first-create Project Memory, not maintenance.
- Deterministic validation and rendered-quality checks remain separate from the vision gate.
- The gate consumes rendered markdown, evidence-map artifacts, and usefulness critique output; it does not re-run provider reasoning.
- `MY_VISION.md` is the primary source for representative questions unless later planning records a curated subset artifact.
- Live provider dogfood is a stronger signal than fixture success, but the exact promotion threshold is still a design choice.
- The gate should not be reduced to page count, section count, or another structural proxy.

## Artifact Map

| Artifact | Type | Intended Destination | Responsibility |
| --- | --- | --- | --- |
| `ProjectMemoryVisionQualityGate.ts` | File-shaped | `src/project/project-memory-vision-quality-gate.ts` or a merged helper under `src/project/` | Owns representative questions, gate result vocabulary, and the trust decision that separates foundation-valid output from product-quality trust. |
| `FirstCreateVisionQualityFlow.md` | Flow-shaped | Multiple files | Owns the first-create sequencing from deterministic validation through usefulness critique, question-based review, and terminal state selection. |
| `ProjectMemoryVisionGateBoundary.md` | Boundary-shaped | `src/project/*`, project state metadata, roadmap notes | Owns the boundary between structural validation, usefulness critique, and the final product-quality trust gate. |

## Cross-Artifact Relationships

- `ProjectMemoryVisionQualityGate.ts` should consume rendered markdown and critique output, but it should not know how those artifacts were produced.
- `FirstCreateVisionQualityFlow.md` should describe the sequencing between deterministic validation, usefulness critique, and the vision gate.
- `ProjectMemoryVisionGateBoundary.md` should make it explicit that the gate is not a renderer, parser, or retrieval index.

## Libraries And Conventions To Preserve

- Keep the current Project Memory quality contract as the structural foundation.
- Keep markdown/wiki as canonical Project Memory truth.
- Keep run artifacts as the place for detailed diagnostics and failed-run evidence.
- Keep the gate provider-aware only if the surrounding critique stack already uses a provider; otherwise keep it deterministic over artifacts.
- Preserve the existing split between content quality, retrieval readiness, and terminal state.

## Artifact Quality Checks

- Each artifact states ownership and non-ownership.
- Lifecycle-sensitive artifacts name inputs, outputs, terminal states, and failure posture.
- The gate must not collapse into a question bank with no trust decision.
- The gate must not use page count or role count as a proxy for usefulness.
- No artifact should invent implementation code or a chunk plan.

## Review Points

- Confirm whether `MY_VISION.md` should be the literal question source or whether the repo should maintain a derived question manifest.
- Confirm whether `review_only` is a terminal state for the gate or merely a pre-curated warning.
- Confirm whether the gate should require live provider dogfood to pass, or only to enter the highest trust tier.
- Confirm whether question coverage should be scored per question or aggregated by answer domain.

## Use Notes

Downstream design, planning, or implementation should preserve the gate's decision boundary unless new evidence forces an explicit divergence. If the next session decides to revise the question set, do it visibly in the artifact set rather than smuggling the change into code.

## Open Risks Or Allowed Divergence

- Allowed divergence: the question source can be `MY_VISION.md`, a curated subset file, or a generated manifest if the provenance stays explicit.
- Allowed divergence: the final status vocabulary can stay aligned with existing Project Memory trust states or introduce a narrower gate-local result that maps into those states.
- Risk: the gate becomes too soft if it only records weak sections instead of making a hard trust decision.
- Risk: the gate becomes too brittle if it overfits the current `llm-wiki` vision wording and cannot adapt to future repo-specific product questions.

## Non-Executable Rule

Every source-like file in this folder is pseudocode reference material, not implementation.

## Source Artifacts

- `docs/ROADMAP.md`
- `MY_VISION.md`
- `docs/design/2026-07-05-project-memory-rendered-create-contract/spec.md`
- `docs/design/2026-07-05-project-memory-rendered-create-contract/agenda.md`
- `docs/design/2026-07-05-project-memory-rendered-create-contract/plans/03-rendered-quality-evaluator.md`
- `docs/design/2026-07-05-project-memory-rendered-create-contract/plans/07-independent-usefulness-critique.md`
- `src/project/project-memory-quality-contract.ts`
- `src/project/project-memory-orientation-contract.ts`
- `src/project/project-memory-curator-contracts.ts`
- `src/project/project-memory-curator-service.ts`

## Code Context Inspected

- `src/project/project-memory-quality-contract.ts`
- `src/project/project-memory-orientation-contract.ts`
- `src/project/project-memory-curator-contracts.ts`
- `src/project/project-memory-curator-service.ts`
- `docs/ROADMAP.md`
- `MY_VISION.md`
- `docs/design/2026-07-05-project-memory-rendered-create-contract/spec.md`
- `docs/design/2026-07-05-project-memory-rendered-create-contract/agenda.md`
- `docs/design/2026-07-05-project-memory-rendered-create-contract/plans/03-rendered-quality-evaluator.md`
- `docs/design/2026-07-05-project-memory-rendered-create-contract/plans/07-independent-usefulness-critique.md`
