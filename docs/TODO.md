# Todo

This is the current gap and roadmap list for Myelin. It should prevent circular work by separating product layers and naming what is intentionally not next.

Do not treat the dogfood Experience Log queue as something to manually finish. Every user message and assistant response adds new rows. Auto-maintenance owns that loop.

## Immediate Roadmap Hygiene

- Keep `docs/DONE.md` and `docs/TODO.md` current when implementing or finishing a slice.
- Do not create parallel roadmap files unless they have a clearly different role.
- When a design moves from draft to implementation, update this file with the next concrete gap it closes.

## Session Memory Layer

Goal: accurate, relevant project-scoped continuity from recent work.

Open gaps:

- Refresh `tests/query/fixtures/llm-wiki-session-memory-quality.json` to match current live Session Memory instead of stale pre-auto-maintenance state.
- Make reconciliation lifecycle branch-scoped. Other branch memories should remain preserved and queryable, but current-branch maintenance should not casually retract or supersede branch-specific memories from inactive work.
- Keep `next_action` memories short-lived, but retire them through evidence-backed ingest/reconciliation rather than manual queue chasing.
- Surface `needs_review` Memory Candidates in query/status contexts when active Session Memory is weak, clearly labeled as non-trusted. Do not auto-promote them merely because they are relevant.
- Add manual review/admin commands only as escape hatches after the automated lifecycle is coherent.
- Improve auto-maintenance reporting around failed ingest jobs: decide whether maintenance should complete with partial indexing or mark itself failed/degraded when ingest jobs fail.
- Fix small documentation drift in `myelin.config`: the comment says auto-maintenance is disabled by default, while this checkout enables it.

Not next:

- Do not manually drain the current `llm-wiki` Experience Log queue as a measure of progress.
- Do not lead with scoring/ranking unless stale lifecycle and scoped relevance are already under control.

## Project Memory Layer

Goal: curated, human-readable project truth in `projects/<key>/wiki/` and related state.

Open gaps:

- Build the bounded Project Memory packet and lookup slice before allowing the curator agent to write durable markdown. The packet should assemble pending project handoffs/candidates, selected Session Memory, existing project wiki/state, and deterministic Project Memory lookup results.
- Resume the paused Current Briefing design only after deciding its prerequisite. The current spec is a north-star artifact, not an approved implementation plan.
- Decide how Current Briefing relates to Session Memory, especially when Session Memory, old `wiki/sessions/*.md`, and `current-briefing.md` disagree.
- Evolve `project learn` from a Phase-0 pipeline scaffold into behavior-focused Project Memory maintenance.
- Preserve provenance for every durable Project Memory update.
- Reframe inbox/gap flow as evidence/candidate intake instead of legacy query repair only.

Relevant docs:

- `docs/design/2026-06-12-current-briefing/spec.md`
- `docs/design/2026-06-12-current-briefing/agenda.md`
- `docs/IMPLEMENTATION_ALIGNMENT.md`

## Practice Memory Layer

Goal: canonical cross-project guidance derived from repeated or explicitly selected project evidence.

Open gaps:

- Design the canonical Practice Memory storage shape.
- Define the Practice Candidate promotion path from Project/Session evidence.
- Decide how project-specific runbooks override or cite canonical practices.
- Keep automatic Practice promotion out of scope until evidence shape and manual promotion are proven.

## Personal Memory Layer

Goal: durable guidance about Liad's preferences and agent behavior expectations.

Open gaps:

- Design the canonical Personal Memory storage shape.
- Define Personal Candidate creation from repeated corrections, explicit guidance, and observed project behavior.
- Keep automatic Personal promotion out of scope until manual review boundaries are proven.
- Avoid turning one-off session instructions into durable preferences without corroboration or explicit user intent.

## Query / How / Status Facades

Goal: small semantic interfaces over the memory layers.

Open gaps:

- `query` should route across Project, Session, Practice, Personal, and state-backed sources. Current behavior is mostly Session Memory/vector retrieval plus older project-wiki query machinery.
- `how` is not implemented as a first-class facade.
- `status` should become the structured current-state facade and eventually use Current Briefing or another curated current-state artifact.
- Query responses should make retrieval quality interpretable without letting scoring become the product driver.
- Candidate surfacing should be explicit and labeled, not blended into trusted active memory.
- MCP should consume core contracts; core logic must stay out of detached MCP implementation.

## Schema Layer

Goal: rules and conventions that teach agents how to maintain Myelin.

Open gaps:

- Project-local schema.
- Schema overrides.
- Schema candidate list/apply flows.
- Global schema candidate promotion after cross-project Practice/Personal promotion exists.

These remain deferred by ADR 0049 until real divergence proves the need.

## Operational Guardrails

- Keep hooks fast and fail-open.
- Keep provider-backed work detached and bounded.
- Do not let auto-maintenance recursively capture its own provider sessions.
- Keep SQLite as serving/recall state, not curated truth.
- Keep markdown Project/Practice/Personal memory human-reviewable.
- Do not import root `src/` from detached MCP or MCP source from root core.
