# Project Memory Retrieval Quality Design

Status: Final design. Ready for review before implementation planning.

## Goal

Design the Step 3.5 Project Memory retrieval-quality slice so `project learn <key>` can use high-quality Project Memory lookup without making SQLite/vector rows canonical Project Memory.

This design also covers the dogfood-discovered apply-gating problem: the latest `project learn llm-wiki` run stopped because the packet was degraded even though the curator produced zero proposals. The design must decide what degradation means, what degradation blocks, and how lookup evidence should be attached to curator decisions.

## Current Context

`docs/ROADMAP.md` keeps Step 3 as completed Project Memory foundation work and moves dogfood-discovered transport, retrieval-quality, gap/stale routing, and Current Briefing follow-up into Step 3.5.

Artifact-reference prompt transport is already implemented for Codex-backed Project Memory curator runs. The latest dogfood run used `transport: artifact_reference`, reduced the curator prompt to `641` characters, kept the full packet artifact at `222792` characters, and stopped only because the packet was degraded.

Current retrieval behavior:

- `src/project/project-memory-lookup.ts` loads canonical markdown pages from `projects/<key>/wiki/**/*.md`, emits page summaries, and performs deterministic page-level term scoring.
- `lookupProjectMemory` always returns `degraded: true` because markdown text search is a bootstrap fallback, not the target derived metadata/vector index.
- `src/project/project-memory-packet.ts` calls lookup for pending Project Memory handoffs, Project Memory candidates, and selected Session Memory rows, then promotes lookup degradation into `packet.degraded`.
- `src/project/project-memory-curator-validator.ts` quarantines otherwise valid maintenance items when the packet is degraded.
- `src/project/project-memory-curator-service.ts` stops before apply whenever `packet.degraded` is true.

Relevant existing decisions:

- Curated Project Memory remains markdown plus metadata JSON; SQLite is serving state, not canonical Project Memory.
- Routine low-risk `project learn` updates should auto-apply by default.
- Risky, conflicting, broad, low-confidence, destructive, or review-requested changes must stop before canonical writes.
- Curators propose structured output; deterministic Myelin code validates and renders canonical markdown.
- Project Memory apply is journal-backed and should not normalize partial canonical writes as a steady state.
- Session Memory vector rows are trusted retrieval support for trusted SQLite Session Memory rows. Project Memory vector rows should instead be disposable pointers back to canonical markdown.

## Problem Statement

The current `degraded` flag is too coarse for Step 3.5.

It correctly prevents low-quality lookup evidence from silently authorizing canonical writes, but it also blocks a run with no eligible write proposals. That makes bootstrap lookup degradation dominate the entire Project Memory loop even when there is nothing to apply.

There are two separate retrieval moments that should not be conflated:

- Pre-write lookup: `project learn` reads existing Project Memory markdown before writing so the curator can decide whether a candidate is already covered, where an update belongs, and what existing page/section evidence is relevant.
- Post-write indexing: after canonical markdown/state writes succeed, Myelin derives a queryable retrieval index from the markdown for future lookup. This index points back to markdown; it is not canonical Project Memory.

The current fallback lookup is a pre-write lookup mechanism. It is not the post-write retrieval index that Step 3.5 designs and will build.

The retrieval design needs a sharper distinction between:

- missing or stale evidence that makes a proposed write unsafe;
- fallback lookup quality that should be visible but may not affect a no-op or review-only result;
- provider or vector-index failures that should fail closed for dependent writes;
- canonical markdown availability, which remains the source of truth even when serving indexes are missing.

## Proposed Direction

Use a derived Project Memory retrieval index as serving state over canonical markdown sections, with scoped lookup quality metadata that can be reasoned about per result and per proposal.

The markdown scanner should survive as a deterministic fallback and bootstrap corpus reader, but not as the primary quality signal once indexing exists.

Creation mode and maintenance mode should use the same typed lookup-quality model, but their expectations differ:

- Creation mode may rely on fallback markdown lookup because the first trusted Project Memory surface and its derived index often do not exist yet.
- Maintenance mode should normally use indexed section retrieval and should treat missing, stale, or unavailable index state as lower-quality evidence that must be surfaced in the run result.
- Maintenance fallback to markdown remains useful because markdown is canonical, but fallback evidence should not silently authorize writes that require fresh indexed retrieval.

Target retrieval shape:

- Canonical source: `projects/<key>/wiki/**/*.md`.
- Index unit: page sections, not whole pages only. A section is a heading-bounded slice with path, heading anchor or section id, body hash, and provenance-adjacent snippet.
- Storage: root SQLite metadata/vector rows keyed by project, markdown path, section id, content hash, embedding contract, and freshness status.
- Query: embed the question, retrieve candidate sections, read the referenced markdown slices back from disk, and return snippets plus canonical refs to the packet.
- Freshness: markdown wins. Missing, stale, or incompatible index rows degrade retrieval and can trigger rebuild/backfill, but they do not replace markdown as trusted memory.
- Fallback: if vector retrieval is unavailable, deterministic markdown lookup may return results with lower quality metadata.

The base retrieval index should be deterministic, not agent-authored. The Project Memory curator proposes durable memory content and state intent; deterministic Myelin apply code writes canonical markdown and project state after validation. After canonical writes, deterministic harness code derives structural retrieval metadata from markdown paths, category folders, page titles, headings, sections, and content hashes. A separate hint-generation model may then enrich retrieval metadata with keywords, aliases, topics, and likely query phrases, but the core index pointers must remain mechanically derived from canonical markdown paths, sections, and content hashes.

Retrieval hints should be authored with category context, but stored outside `wiki/` so wiki remains the human-readable canonical memory surface. A useful shape is a mirrored state-side hierarchy, for example:

```text
projects/<key>/wiki/
  architecture/
    ranking-and-proposal-generation.md
    validate-reconcile-and-pending-approvals.md

projects/<key>/state/project-memory-retrieval/hints/
  architecture.json
```

After markdown writes, deterministic code derives section records from markdown and writes structural retrieval metadata. A separate hint-generation flow may read the resulting markdown and structural metadata to create or refresh category-scoped hint files. Hint generation should be mandatory for new memory entries and newly created pages before they are considered fully indexed, and optional for existing memory entries/pages when current hints still validate against page/section hashes and remain useful. Operators or future automation may still run hint generation for existing memory layers when better semantic recall is needed. Deterministic code validates hints against actual wiki files/sections, discards or flags stale hint entries, and builds SQLite retrieval rows from the combined deterministic section text plus accepted hint metadata.

Hint freshness has three layers:

- Structural freshness is deterministic. If a hint entry points to a missing wiki path, missing section id, or changed section hash, that hint is stale or orphaned and must not be used for embeddings until refreshed.
- Embedding freshness is deterministic. If the hint and section still match but the embedding contract changes, the row needs re-embedding rather than semantic hint regeneration.
- Semantic usefulness is usage-driven. If an MCP/CLI query user or agent receives weak, wrong, or missing retrieval results while the underlying markdown is still correct, that feedback should create a hint-refresh signal or candidate. This is similar to the old gap-reporting pattern, but it targets retrieval hints rather than canonical memory content.

Usage-driven semantic usefulness feedback should create work in a dedicated retrieval-maintenance queue, not as a Project Memory candidate. Retrieval hint refresh is serving-state maintenance over canonical markdown; it should not be confused with a request to rewrite Project Memory content. The queue should preserve query context, selected hits, expected/missing memory refs when known, and feedback from the user or agent that flagged poor retrieval.

Creation runs may report `completed_with_pending_index` when canonical markdown/state writes succeeded but mandatory hint generation, embedding, or index refresh did not finish. That status is not a failure of canonical Project Memory, but it means the new pages or entries are not fully indexed yet and the pending index work must be visible as retrieval-maintenance work. A run reports `completed` only when required retrieval indexing for the changed canonical memory has finished.

Hint-generation job state should be represented in both places that serve different purposes: run artifacts preserve provider prompts, raw output, and validation diagnostics for auditability, while SQLite job/status rows track retryable serving-state work, embedding/index status, and queue processing.

## Lookup Quality And Apply Gating

The design should replace a single packet-wide degraded boolean as the only apply gate with separate lookup quality, freshness, and apply-severity fields.

The dogfood failure showed that the current code conflates "lookup used fallback bootstrap search" with "the packet is unsafe to apply from." Those are different states. A fallback lookup may be low precision, but it is not automatically evidence of bad Project Memory content or unsafe canonical state.

Initial model for discussion:

- `lookup_quality`: records how retrieval was produced, such as `indexed_section_retrieval`, `fallback_markdown_search`, or `unavailable`.
- `lookup_freshness`: records whether retrieved index rows agree with current canonical markdown, such as `fresh`, `stale`, or `unknown`.
- `apply_severity`: records what the retrieval state should block.
- `blocking`: canonical writes must not happen because required evidence or state is unavailable, stale, malformed, or unsafe.
- `proposal_scoped`: only proposals depending on the affected lookup result should be quarantined or rejected.
- `advisory`: the run should report reduced quality, but a no-op result or unrelated safe proposal may complete.

For the latest dogfood run, the intended classification is `lookup_quality: fallback_markdown_search` and `apply_severity: advisory` or `proposal_scoped`, not packet-wide blocking.

No-op handling uses an explicit policy. A no-op curator draft may mean "there is nothing to write" or "the curator could not safely decide because retrieval was weak," so no-op completion must prove that a zero-proposal result is a deliberate decision rather than hidden retrieval uncertainty.

When fallback markdown lookup is used, a zero-proposal curator result may complete only if the curator emits an explicit no-op decision with cited candidate/source refs and canonical markdown refs it checked. A bare empty proposal list is inconclusive under fallback lookup and should remain reviewable. This keeps fallback lookup usable without allowing weak retrieval to masquerade as "nothing to do."

That no-op policy applies to any non-empty `project learn` packet that uses fallback lookup, in both creation and maintenance modes. Empty-input runs do not need an explicit no-op decision because there is no candidate/source claim to adjudicate.

## Packet And Evidence Contract

Future packet lookup results should carry enough evidence for the validator and apply gate to make scoped decisions:

- query source kind and source id;
- retrieval method, such as vector index, markdown fallback, or unavailable;
- quality status and degradation severity;
- matched canonical refs: path, section id or heading, content hash, and snippet;
- freshness status comparing index hashes to current markdown;
- whether the curator cited or depended on the result in a proposal.

Curator proposals should continue to cite canonical wiki refs and source refs. Retrieval hits are evidence pointers, not write authority.

Each write proposal should explicitly declare the lookup result ids or canonical section refs it depended on. Validation should not infer this dependency only from text citations when apply-gating depends on evidence quality. Direct candidate/source evidence can still support a proposal, but if the proposal relies on existing Project Memory lookup to avoid duplication, supersede prior memory, or choose a target page/section, that dependency must be explicit.

Scoped apply gating then follows the declared dependency graph:

- proposals depending on fresh indexed evidence may proceed if all other validation rules pass;
- creation-mode proposals may use fallback lookup as bootstrap context when direct candidate/source evidence supports the write;
- maintenance-mode proposals depending on fallback lookup must stop for review rather than auto-apply;
- proposals depending on stale/orphaned evidence are quarantined or rejected;
- unrelated proposals are not blocked merely because another lookup result in the packet was lower quality.

## Out Of Scope

- Moving canonical Project Memory out of markdown.
- Replacing the Project Memory curator or apply payload contract.
- Exposing Project Memory retrieval through MCP or the future general `memory query` facade.
- Reopening Step 3 foundation work.
- Current Briefing integration.

## Testing Strategy

Future implementation plans should prove:

- markdown fallback still returns deterministic lookup results and marks the correct quality state;
- missing/stale vector index rows do not become trusted Project Memory;
- indexed section retrieval returns canonical markdown refs and snippets;
- packet degradation distinguishes blocking, proposal-scoped, and advisory states;
- no-op curator output under advisory degradation can complete only under the approved no-op policy;
- proposed writes that depend on blocking or stale lookup evidence stop before canonical markdown/state writes;
- dogfood `project learn llm-wiki --json` no longer stops solely because markdown fallback exists when the approved gating policy says the outcome is safe.

## Planning Boundary Guidance

Likely future plan chunks:

- Retrieval semantics and contracts: define typed degradation, lookup result shape, and apply-gating rules.
- Markdown section extraction: split canonical wiki pages into stable section records and hashes.
- Derived index storage: add SQLite metadata/vector storage for Project Memory section pointers.
- Indexer/query flow: build/rebuild Project Memory retrieval rows and query canonical markdown-backed sections.
- Retrieval hint generation: run a separate hint-generation model over markdown-derived structural metadata to create category-scoped keywords/aliases/query phrases, mandatory for new memory entries/pages and optional for existing updates when current hints remain valid.
- Retrieval maintenance queue: store usage-driven hint-refresh/index-maintenance signals separately from canonical Project Memory candidates.
- Packet and validator integration: attach scoped lookup evidence and enforce the approved gating policy.
- Dogfood verification: rerun the latest `llm-wiki` candidate and inspect whether stop/apply/review behavior matches the design.

## Assumptions

- Codex remains the active provider path for Project Memory curator runs in this slice.
- Existing Session Memory embedding infrastructure can be reused for provider/config/runtime patterns, but not for Project Memory canonical semantics.
- The derived Project Memory retrieval index can be rebuilt from markdown and should never be the only place a durable Project Memory claim exists.
- The current page-level markdown scanner is still useful as fallback and testable bootstrap behavior.

## Open Questions

No live design questions remain. Decision history and the pressure-test result are tracked in `agenda.md`.
