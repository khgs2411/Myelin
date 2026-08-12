# Project Memory Shape, Creation, And Maintenance Design

Status: Final design. Ready for user review; not approved for implementation planning until user approval.

Audit note: this draft was repaired after the user correctly challenged the agenda for re-asking requirements already present in the initial prompt. The current live design branch is limited to publication quality states; already-stated requirements are recorded as decisions rather than open questions.

Grounding note: this draft was then re-audited against the live codebase so the spec distinguishes current implementation behavior from Step 4 redesign targets. Claims below should be read through that split.

## Goal

Redesign Step 4 so Project Memory becomes trustworthy living project documentation instead of mechanically valid markdown.

The design should define the first-create documentation shape, creation evidence bar, maintenance behavior, producer-to-candidate boundary, quality diagnostics, and retrieval/indexing relationship for Project Memory. It should also preserve the broader memory-layer model: Session Memory, runtime inbox items, and future Practice/Personal candidates can suggest durable-memory work, but Project Memory remains curated markdown plus project state.

## Current Context

`docs/ROADMAP.md` marks Step 4 as the active `next` item: redesign the Project Memory wiki shape and creation quality bar. The roadmap explicitly says the 2026-06-30 dogfood create run proved transport, schema, validation, and apply mechanics, but the generated pages were too shallow to trust as a durable memory layer.

The user clarified during brainstorming that the full request includes any Step 4.5 producer-routing pieces needed for this shape. The roadmap has been expanded so Step 4 owns Project Memory candidate producer routing where it affects documentation-shaped curation.

The current implementation already has the mechanical foundation:

- `ProjectMemoryCuratorService.runProjectLearn` owns `project learn` orchestration, including shell repair, schema context, source-consumption reconciliation, runtime inbox intake, packet creation, curator invocation, deterministic validation, markdown apply, and post-apply retrieval lifecycle.
- `ProjectMemoryCreationDraft` and `ProjectMemoryMaintenanceProposal` are separate mode-scoped contracts.
- `curator-output-contract.json` is written per run and passed to Codex through structured-output support.
- Creation mode currently requires `index.md` plus at least three non-index pages through `PROJECT_MEMORY_CREATION_MIN_PAGES = 4`.
- Creation prompts ask for product purpose, runtime/commands, architecture/data flow, and operations/current work, with direct repo citations.
- `projects/llm-wiki/wiki/` currently contains a shallow five-page dogfood set totaling 119 lines.
- Project Memory retrieval indexing is derived serving state over canonical markdown sections. Retrieval hints live under state, not under `wiki/`.

The existing boundary decisions still hold:

- Project Memory canonical truth is human-readable markdown plus metadata JSON.
- SQLite/vector rows for Project Memory are rebuildable pointers into markdown, not trusted memory records.
- Session Memory trusted records live in SQLite and can feed project handoffs/candidates, but raw conversation history is not canonical Project Memory.
- Runtime durable-memory inbox items and Session Memory outputs are proposal/evidence lanes. They do not write Project Memory directly.
- Maintenance mode should update existing Project Memory structure instead of accumulating shallow duplicates.

## Codebase Grounding Audit

The current code supports the Step 4 direction in some places and contradicts it in others. The design target is therefore a redesign of the quality contract, not a description of already-complete behavior.

Current behavior confirmed in code:

- `project learn` already runs the Project Memory Curator from the bootstrapped target repo cwd. Tests assert `options.cwd` is the target repo path and the prompt says the curator is running from the target repository cwd.
- Creation currently has a mechanical publication guard: `index.md` plus at least three non-index pages, direct repo citations on creation pages, and one apply payload page per page draft. This is intentional safety plumbing, not sufficient documentation quality.
- Creation prompts already require a bounded repo orientation set and mention product purpose, runtime/commands, architecture/data flow, and operations/current work. The existing contract does not yet enforce role depth, section coverage, or shallow-summary rejection.
- Maintenance currently applies `CREATE_ENTRY`, `PATCH_ENTRY`, and `ATTACH_EVIDENCE` by rendering one entry block and upserting it by `entry_id` into a target wiki page. Section-first maintenance is a Step 4 redesign target, not current apply behavior.
- Runtime inbox items for the project layer normalize into `needs_review` `project.inbox` Memory Candidates, and Session Memory ingest can write Memory Candidates plus project/practice/personal handoff instructions. `project packet` already reads pending project candidates, project handoffs, selected Session Memory, and lookup results into one curator input packet.
- The Session Memory ingest prompt already says the ingest agent runs from the target repository cwd, creates low-risk Session Memory directly, and creates Project/Practice/Personal handoff instructions as one-hop downstream inputs.
- Project Memory retrieval indexing already extracts markdown sections, stores section hashes and retrieval rows, validates semantic hints with `keywords`, `aliases`, `topics`, and `query_phrases`, and indexes section vectors as derived serving state.
- `memory query` is currently a Session Memory vector query facade. It returns Session Memory matches directly and does not yet query Project Memory retrieval rows or return markdown content/path refs from Project Memory hits.
- `completed_with_pending_index` already represents successful canonical writes with pending/degraded retrieval hint or index work. There is not yet a separate content-quality state for valid-but-shallow Project Memory output.

Design implications:

- The role-based Project Memory Documentation Contract replaces page count as the primary trust bar while preserving existing path/provenance/apply safety checks.
- Candidate and handoff producers do not need separate downstream lanes; the current normalization model is a good base. Step 4 should strengthen the candidate-to-documentation promotion rule and diagnostics.
- Section-first maintenance must either evolve the current entry-block apply mechanism or define deterministic section markers/IDs so updates stay bounded while matching documentation-shaped pages.
- Project Memory query behavior in this spec is future behavior built on the existing retrieval index, not the current `memory query` implementation.
- Publication quality states must separate content trust from retrieval readiness because the code already has retrieval-pending status but no equivalent shallow-content gate.

## User-Stated Direction

The user wants Project Memory, and eventually every durable memory layer, shaped as documentation rather than direct memory-row retrieval.

Key user-stated requirements:

- Session Memory is created from actual agent conversation hooks and is valid as Session Memory evidence because it captures what happened in a session.
- The Session Memory curator may suggest candidates for other memory layers, including Project Memory.
- Those candidates are hints for later exploration and documentation, not direct durable truth.
- In this repo, a dogfood session about Session Memory can become Project Memory because the product behavior being discussed belongs to the repo itself.
- Project Memory should help an LLM agent understand how a repo works without forcing it to recreate documentation by reading the entire codebase each time.
- Project Memory is the most important durable layer because it is closest to living repo documentation.
- Project Memory lookup should use SQLite/vector serving state to find the right markdown file or section, then return that markdown content or a path reference depending on size.
- Future answer synthesis over retrieved documentation is out of scope for now.

## Problem Statement

The current Step 3.5 implementation validates syntax and safety, not memory usefulness.

The existing creation bar can be satisfied by a small page count, broad page titles, and repo citations. That proves the curator can produce valid JSON and the applier can write markdown safely, but it does not prove the resulting wiki is deep enough for future agents to rely on.

The missing product layer is a documentation-quality contract:

- what page roles must exist;
- what counts as enough depth per page;
- what repo surfaces creation must inspect;
- how session-derived or inbox-derived candidates become explored documentation rather than copied assertions;
- how maintenance preserves and improves structure over time;
- how diagnostics distinguish valid markdown from trusted Project Memory;
- how derived retrieval points back to durable markdown instead of becoming the memory itself.

## Proposed Direction

Project Memory should be treated as a curated documentation layer with machine-checkable quality diagnostics.

Creation mode must use a role-based Project Memory Documentation Contract instead of treating generic page count as the publication bar. It should produce a role-based first Project Memory set with required coverage and citations. The initial page set may still include a small number of pages, but each page should have a durable role in helping future agents orient in the repo.

Recommended first-create roles:

- **Orientation index**: navigation, reading path, quality/status notes, and major page refs.
- **Product and memory model**: what the project does, memory-layer responsibilities, non-goals, and current scope.
- **Runtime and command workflows**: commands, environment, setup, verification, and operational gotchas.
- **Architecture and data flow**: core runtime modules, Project/Session Memory boundaries, candidate flow, apply flow, retrieval/indexing flow.
- **Current work and roadmap state**: active roadmap step, accepted constraints, recent dogfood findings, and non-blocking risks.
- **Decision and terminology map**: links to ADRs, glossary terms, and high-impact boundaries that future agents must not reopen casually.

The exact page names should remain repo-appropriate, but the contract must require role coverage rather than only `index.md` plus N pages. Page count remains a diagnostic or lower-level guard, not proof of trusted Project Memory.

Maintenance mode should be section-first and make Project Memory sharper over time:

- update specific existing sections when a candidate maps to known structure;
- create a new page only when no existing page owns the concept;
- attach evidence and uncertainty to the smallest relevant section;
- mark stale or disputed entries instead of flattening contradictory facts;
- leave explicit no-op decisions when the candidate is already trusted, not durable, belongs to another layer, or lacks evidence;
- produce missing-coverage diagnostics when a candidate reveals that the current docs are too thin.

Candidates are leads only. A project candidate can say "this may belong in Project Memory," but the curator must decide whether it is durable, repo-scoped, supported by evidence, and best represented as a documentation update. Candidate text is not allowed to become Project Memory by copying it into markdown without supporting exploration.

Maintenance mode should weigh Memory Candidates more heavily than creation mode because they are generated after Project Memory exists and can be produced against existing memory by Session Memory logic. That higher weight means a candidate is a strong prioritization and targeting signal for maintenance, not direct write authority.

The Project Memory Curator must run inside the target project cwd from bootstrap, not inside Myelin's own cwd by default. That cwd gives the invoked agent the full target codebase as context for bounded exploration and repo citations, while Myelin still receives only structured curator output and deterministically validates it before writes. For example, when creating Project Memory for `class-kit`, the curator should be invoked in the bootstrapped `class-kit` repo path.

Producer routing belongs in Step 4 where it affects this boundary. Session Memory handoffs, project gaps, stale findings, runtime inbox items, and future producer outputs should all normalize into the same Project Memory candidate/handoff intake boundary. Producers may use the two existing normalized shapes, `Memory Candidate` and `Layer Handoff Instruction`, but producer-specific lanes should not survive past normalization into `project learn`. Producers may explain why something appears durable, but they should not choose final page placement, mark Project Memory curated, or bypass the Project Memory Curator's repo-grounded documentation check.

## Creation Quality Bar

Creation mode should require a bounded hybrid repo orientation pass. Myelin should provide deterministic default files/surfaces, and the curator may add extra files when justified by the project shape or candidate evidence. The current prompt already names likely defaults (`AGENTS.md`, `README.md`, `package.json`, `Makefile`, `docs/CLI.md`, `docs/ROADMAP.md`, `src/cli.ts`). Step 4 should make the default orientation set, curator-added surfaces, and inspected-surface diagnostics part of the contract.

Creation should inspect enough surfaces to document:

- product purpose and non-goals;
- public CLI vocabulary and workflows;
- data layout and state ownership;
- Project Memory creation/maintenance/apply lifecycle;
- Session Memory ingest/index/query lifecycle where it affects Project Memory;
- runtime inbox/candidate boundaries;
- retrieval/indexing boundaries;
- verification commands and known operational constraints;
- active roadmap state and dogfood findings.

For this repo, `MYELIN.md`, `CONTEXT.md`, `docs/ROADMAP.md`, relevant ADRs, existing design docs, and the core `src/project`, `src/memory`, `src/ingest`, `src/commands`, and `src/runtime` surfaces are stronger evidence than raw conversation summaries. Session Memory or runtime inbox evidence can highlight what to inspect, but repo docs/code should ground durable claims when they exist.

Minimum quality diagnostics should include:

- inspected default orientation surfaces and any curator-added surfaces;
- required page-role coverage;
- minimum section coverage per required role;
- citation density per page and per repo-groundable section;
- stale or untrusted existing markdown handling;
- candidate-to-documentation traceability;
- missing coverage warnings;
- shallow-summary detection;
- retrieval readiness: section extraction, mandatory hint generation, embedding/index status.

## Publication Quality States

Project Memory run outcomes should use two separate axes:

- **Content quality** decides whether the markdown is trusted Project Memory. A run can mark Project Memory curated only when the output satisfies the Project Memory Documentation Contract: required roles, section depth, citation coverage, candidate disposition, and shallow-summary checks. Valid JSON, safe paths, and successful markdown rendering are not enough.
- **Retrieval readiness** decides whether derived serving state is ready. Section extraction, semantic hints, embeddings, and SQLite/vector rows may be ready, pending, or degraded without changing whether the underlying markdown is trusted.

This means `completed_with_pending_index` remains valid only for trusted content whose derived retrieval state is pending or degraded. It must not be used for shallow or role-incomplete content. A run that produces mechanically valid but shallow markdown should stop as review-only or quality-failed material and should not mark `project-memory.json` as curated.

For creation mode, the content-quality gate is the publication gate. For maintenance mode, it is the preservation gate: a maintenance run may update trusted Project Memory only when the proposed section/page changes preserve or improve the documentation contract. If a candidate reveals missing coverage but the curator cannot produce a grounded update, the correct output is an explicit no-op or missing-coverage diagnostic, not a trusted shallow write.

## Retrieval And Query Shape

Project Memory query should remain markdown-backed.

This is not the current `memory query` behavior. Today `memory query` queries indexed Session Memory vectors and returns trusted SQLite Session Memory rows. Step 4 should define the Project Memory path on top of the existing Project Memory retrieval index without making SQLite/vector rows canonical memory.

For the current product slice, a future tool or CLI path should:

1. embed the user's question;
2. search derived Project Memory retrieval rows in SQLite;
3. rank matching markdown sections using structural metadata plus retrieval hints;
4. read the canonical markdown section or page from disk;
5. return either the relevant markdown content when below a configured size threshold, or a canonical file/section reference when too large.

This differs from Session Memory query. Session Memory can return trusted SQLite memory records directly. Project Memory retrieval rows must resolve back to markdown because markdown is the durable truth.

Answer synthesis over retrieved Project Memory can come later. Step 4 should only require that lookup reliably points agents at the right durable documentation and reports degraded states honestly.

## Contract And Boundary Changes To Design Later

This brainstorming pass should not write implementation plans, but likely implementation work will touch:

- creation output contract: replace `PROJECT_MEMORY_CREATION_MIN_PAGES` as the primary publication bar with the Project Memory Documentation Contract's required page roles and coverage diagnostics;
- creation prompt: make the bounded orientation set and documentation roles explicit;
- validator: enforce role coverage, citation coverage, shallow-summary blockers, and candidate traceability;
- applier/state: record content quality separately from retrieval readiness without letting the curator self-assign protected state;
- maintenance contract: require section-level target ownership, missing-coverage reporting, and candidate disposition;
- producer routing: route session-derived candidates, gaps, stale findings, and runtime inbox items into the same documentation-shaped Project Memory curation path;
- packet: expose enough current wiki structure and retrieval metadata for maintenance to update the right section;
- run artifacts: add quality diagnostics that explain whether the output is trusted, review-only, shallow, or pending indexing.

## Out Of Scope

- Implementing the redesign.
- Planning implementation chunks.
- Implementing Practice or Personal Memory consumers beyond keeping their future target shape compatible with the shared candidate model.
- Reopening the detached MCP boundary.
- Answer synthesis over retrieved Project Memory.
- Making SQLite/vector rows canonical Project Memory.
- Treating raw conversation history as durable Project Memory.

## Testing Strategy

Later implementation should prove:

- a creation draft with valid schema but missing required page roles is rejected or held for review;
- a creation draft with thin generic pages is rejected even if it satisfies minimum page count;
- trusted content with pending retrieval/index work can finish as pending-index, while shallow content cannot mark Project Memory curated;
- required repo-groundable claims need repo citations or explicit inference handling;
- candidate text cannot be copied directly into Project Memory without target-repo exploration and supporting evidence;
- maintain mode targets existing sections before creating pages and treats Memory Candidates as strong prioritization signals, not direct write text;
- missing coverage is reported as diagnostics instead of silently producing shallow docs;
- successful creation records whether Project Memory is trusted, trusted-with-pending-index, or review-only;
- Project Memory retrieval returns canonical markdown content or refs, not standalone SQLite memory claims.

## Planning Boundary Guidance

Future planning should split this feature into smaller chunks:

- Documentation shape and page-role contract: decide the required Project Memory page roles and diagnostics.
- Creation orientation packet: define bounded repo surfaces and how creation cites them.
- Creation validator and output schema: enforce required roles, section depth, citations, and shallow-summary blockers.
- Maintenance section targeting: preserve and update existing Project Memory structure.
- Producer-to-candidate routing: make Session Memory handoffs, gaps, stale findings, and runtime inbox items feed the same documentation-shaped curation boundary.
- Quality diagnostics artifacts: report trusted/review-only/shallow/pending-index states.
- Retrieval/query return shape: return markdown content or refs from derived Project Memory hits.
- Dogfood reset and review: rebuild `llm-wiki` Project Memory and manually inspect usefulness.

## Assumptions

- The active Step 4 target is Project Memory, including producer routing where it affects how Project Memory candidates become documentation.
- The Step 3.5 retrieval-index boundary remains accepted: markdown is canonical, SQLite/vector rows are derived serving state.
- Session Memory remains a valid evidence/candidate producer, not direct Project Memory.
- The current shallow dogfood wiki should be treated as evidence for the product gap, not as a design pattern to preserve.

## Open Questions

No live design questions remain. The decision trail and pressure-test result are recorded in `agenda.md`.
