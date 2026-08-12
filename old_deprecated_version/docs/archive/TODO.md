# Todo — Designed, Not Yet Built

What Myelin is missing. This is the gap between the design in `MYELIN.md` and what `DONE.md` records as built. Each entry cites the governing design section (`MYELIN.md §N`) and ADRs so the intent is traceable.

Reflects the codebase at commit `fa278a0`. Ordering within a topic is rough priority, not a contract.

---

## Session Memory & Recall

- **Recall wired into `status`** — SQLite session recall works via `session recent/show`, but `status` still reads `wiki/sessions/*.md` mtime, not the SQLite sessions. A new session is not auto-bootstrapped from durable memory. (`MYELIN §11`; ADR 0002) — `evidence: src/commands/status.ts:118 reads wiki/sessions/`
- **Session Curator** — auto-summarize a session at stop / periodically into "what did we work on last session?". (`MYELIN §9.3`)
- **Session → markdown promotion** — promote durable session rows into curated `wiki/sessions/*.md`. (`MYELIN §4`; ADR 0021)

## Capture (Experience Log + Hooks)

- **Event Collector + hook capture** — always-on, deterministic event ingestion into SQLite; never reasons. (`MYELIN §9.3`; ADR 0003)
- **`off | queue | auto` trigger model** — per-source modes; auto marks records eligible for *bounded* background processing, never launches unbounded workers. (`MYELIN §9.2`; ADR 0004)
- **Memory-slice data contract** — event types (`session.note`, `session.stop`, `memory.candidate`, `answer.correction`) and candidate lifecycle `pending → processed → needs-review`. (`MYELIN §9.4`)

## Retrieval

- **Vector recall** — `sqlite-vec` + embeddings; Indexer agent (chunk → hash → skip-unchanged → embed → write) with quota tolerance via pending chunks. (`MYELIN §11`, `§9.3`)

## Promotion

- **Practice Memory** — promote canonical cross-project "how we do X" from repeated project evidence. (`MYELIN §4`, `§9.3`; ADR 0005)
- **Personal Memory** — promote durable working-preference guidance from repeated corrections/observed behavior. (`MYELIN §4`, `§9.3`)

## Schema (Advanced)

- **Project-local schema + overrides** — per-project conventions that specialize/weaken global rules with a reason. (`MYELIN §6`; ADR 0049 defers)
- **Schema candidates + lifecycle + CLI** — `pending/applied/rejected/superseded/failed`; `schema candidates`/`apply`/`--global`. (`MYELIN §6`; ADRs 0032, 0040–0046)

## Pipeline (Advanced)

- **Deferred stages** — `acceptance`, `reconcile`, `self-correct`, `measure`. Validate failure currently surfaces and stops; no auto-reconcile. (`MYELIN §8`; ADR 0053)
- **Changeset record / audit** — every auto-applied `learn` run writes a reproducible record (run id, schema-context hash, before/after file hashes, source evidence, risk, validation results). (`MYELIN §8`)

## MCP Interface

- **Semantic facades `query` / `how` / `status`** — reshape the current named tools into three facades over the detached server; the `how` facade prefers Practice/Personal guidance + runbooks. (`MYELIN §10`; ADR 0005)

## Providers

- **Gemini provider** — third backend behind the provider seam; most likely first as an *embedding* provider for vector recall. (`MYELIN §7`, `§11`; ADR 0051)

## Commands

- **`project onboard`** — currently a registered stub ("not implemented in this slice"). (`evidence: src/commands/project.ts`)
