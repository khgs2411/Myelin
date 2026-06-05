# Archive

Superseded documentation, kept for history. Nothing here is canonical or current.

Everything in this folder describes the **V1 Python/Bash implementation** (the `agents/`, `scripts/*.sh`, `make update` pipeline, the Python FastMCP server) or an early V2 plan that was replaced by a better successor. The V1 codebase was quarantined and deleted during the Phase-0 clean TypeScript rewrite (ADR 0047, card C12), so these designs no longer describe any code that exists.

They are retained because they record *why* the product is shaped the way it is, and because several describe future capabilities (brain metadata/relationships, query planner, route-repair feedback loop, self-correction, validation-warning emission, Obsidian projection, richer MCP metadata) whose **intent** carries forward into the V2 vision even though their V1 implementation does not.

## Where current truth lives

- **Vision (canonical):** `docs/superpowers/specs/2026-06-01-v2-project-rooted-agent-memory-design.md` and `V2_SPEC.md` (raw source).
- **Glossary:** `CONTEXT.md`.
- **Decisions:** `docs/adr/` (append-only).
- **Phase-0 execution record:** `docs/superpowers/plans/2026-06-02-v2-phase-0-clean-typescript-core.md`.
- **Latest slice (SQLite session memory):** the two `docs/superpowers/{specs,plans}/2026-06-04-sqlite-memory-foundation-*` files.

## What was archived (2026-06-05) and why

### Root V1 docs
- `V1_SPEC.md` — the V1 filesystem/execution contract for the Python/Bash `compile` pipeline.
- `SYSTEM_DESIGN.md` — the V1 product thesis and `make update` stage model.

### V1 plans (`superpowers/plans/`)
- `2026-04-17-bootstrap-ingest-redesign.md`, `2026-04-18-phase-1-real-llm-dry-run.md`, `2026-04-18-plan-a-foundation.md`, `2026-04-18-plan-b-propose-apply.md`, `2026-04-19-plan-c-validate-reconcile-measurement.md` — the V1 bootstrap/update pipeline build-out (Bash + Python heredocs + pytest).
- `2026-04-20-phase-2d-flag-stale-answer.md`, `2026-04-21-update-self-correction.md`, `2026-04-21-validate-warning-inbox-emission.md` — V1 update-loop feature plans.
- `2026-04-29-brain-metadata-relationship-foundation.md`, `2026-04-30-route-repair-feedback-loop.md` — V1 brain-metadata/route-quality plans.
- `2026-06-01-v2-project-rooted-agent-memory-foundation.md` — the first V2 core-migration plan; **self-superseded** by `2026-06-02-v2-phase-0-clean-typescript-core.md` (its successor's header says "Supersedes … (kept as history)").

### V1 specs (`superpowers/specs/`)
- `2026-04-17-bootstrap-ingest-redesign-design.md`, `2026-04-18-unified-update-pipeline-design.md` — V1 ingest/update pipeline designs.
- `2026-04-21-mcp-discovery-resources-design.md`, `2026-04-21-update-convergence-review-checkpoint-design.md`, `2026-04-21-update-self-correction-design.md`, `2026-04-21-validate-warning-inbox-emission-design.md` — V1 MCP/update-loop designs.
- `2026-04-29-brain-metadata-and-relationship-index-design.md`, `2026-04-29-brain-navigation-architecture-design.md`, `2026-04-29-mcp-metadata-surface-design.md`, `2026-04-29-obsidian-compatibility-layer-design.md`, `2026-04-29-query-planner-design.md`, `2026-04-30-route-repair-feedback-loop-design.md` — the V1 "brain navigation" stack designs.
