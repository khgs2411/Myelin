# Project Memory Rendered Documentation And Create Contract Design

Status: Finalized for implementation planning. The design audit passed, the roadmap was approved, and chunk plans exist under `plans/`.

## Goal

Design the Step 5 and Step 6 foundation for useful Project Memory:

- Step 5: Project Memory quality must be derived from the rendered markdown a future agent can read and query.
- Step 6: Project Memory create mode must inspect the target repo deeply enough to produce useful living documentation, not role-shaped summaries.

This design intentionally stops before Step 7 maintenance automation, Step 8 query contract hardening, Step 9 CLI dogfood, and Step 10 MCP wrapping. Those steps depend on the create-mode documentation foundation working first.

## Design Posture

The current Project Memory creation contract is not a compatibility boundary.

This project is still in development, and the 2026-06-30 dogfood proved that the current contract can report trusted content while publishing weak documentation. The implementation may replace the current creation payload, role coverage model, validator shape, prompt contract, generated schemas, state fields, and tests where that produces a stronger Project Memory product.

Preserve mechanics only when they serve the new product shape:

- target-repo curator cwd;
- run artifacts such as `input-packet.json` and `curator-output-contract.json`;
- provider structured output plus deterministic validation;
- markdown apply staging, journals, changesets, and recovery preflight;
- runtime inbox intake and source-consumption reconciliation;
- retrieval indexing that derives serving rows from canonical markdown.

Do not preserve weak abstractions just to reduce diff size. Existing generated Project Memory pages may be invalidated or regenerated when their content does not meet the new documentation contract.

## Current Context

The active roadmap says the 2026-06-30 `llm-wiki` Project Memory output is mechanically valid but product-quality failed. The failure is documented in `docs/design/2026-06-30-project-memory-shape-creation-maintenance/dogfood-validation.md`.

The user's product vision is captured in `MY_VISION.md`:

- Session Memory gives recent continuity from actual captured agent conversations.
- Session Memory may create Project Memory candidates or handoffs.
- Project Memory candidates are leads only, not durable truth.
- Project Memory is living repo documentation that saves agents from rediscovering the whole codebase.
- Project Memory query uses SQLite/vector serving state to find canonical markdown sections/pages, then returns inline markdown content or refs.

The current implementation already has useful mechanics:

- `project learn` invokes the Project Memory curator from the target repo cwd.
- `input-packet.json` and `curator-output-contract.json` are written as run artifacts.
- Curator output is schema-driven and deterministically validated.
- Markdown apply uses staged writes, apply journals, changesets, and recovery preflight.
- Runtime inbox intake and source-consumption reconciliation feed Project Memory candidates/handoffs into `project learn`.
- Project Memory retrieval indexing derives serving rows from canonical markdown sections.
- `queryProjectMemory` can resolve vector hits back to current canonical markdown sections and return inline content or refs.

The current implementation also has the key bug this design must fix:

- `ProjectMemoryPageDraft` has `body` paragraphs/bullets/warnings but no structured page sections.
- `renderPageDraft` emits one `#` heading plus body text and provenance.
- `extractProjectMemorySections` indexes markdown headings, so the current generated pages become one top-level section per page.
- `validateCreationDraft` derives role coverage from `page.required_sections.length` and apply payload body chars, not from rendered markdown sections.
- The curator can therefore declare useful sections while publishing shallow markdown.

## Product Boundary

Project Memory canonical truth remains markdown under `projects/<key>/wiki/` plus project state metadata. SQLite/vector rows remain derived serving state and must resolve back to markdown before being useful.

Session Memory is not being redesigned here. Session Memory is a producer of recent continuity and candidate leads. This design only defines how Project Memory create mode uses repo evidence and how its output becomes trusted documentation.

MCP is out of scope for this design. While Myelin dogfoods Myelin from within this repo, CLI commands and repo-local scripts are the interface. MCP later wraps stable CLI/script behavior for agents in other projects.

## Problem Statement

The current publication gate validates mechanical safety but not documentation usefulness.

The old create-mode contract can pass when:

- each role page exists;
- each page has direct repo citations;
- each page declares `required_sections`;
- the page body has enough characters;
- `content_quality.status` computes as `trusted`;
- apply can safely write markdown and state.

That is insufficient because a future agent queries rendered markdown sections, not declared metadata. A valid Project Memory page must publish the sections it claims to cover, and those sections must carry enough grounded information to answer real repo questions.

The deeper product problem is not only missing markdown headings. It is that the old contract lets page taxonomy substitute for understanding. Project Memory needs a documentation model that starts from the questions and workflows future agents actually need, then renders canonical markdown that retrieval can point to.

## Settled Direction

### Sectioned Page Payloads

Project Memory creation should publish pages with ordered, structured sections that render as real markdown headings.

The apply payload should support:

- page title and purpose;
- ordered sections;
- each section heading;
- each section body;
- section-level evidence refs;
- section-level repo citations;
- optional section-level warnings or inference labels;
- page-level provenance only for whole-page evidence.

The renderer should render those sections as real `##` headings. The markdown section extractor should then produce the same section units that quality diagnostics and Project Memory retrieval use.

Free-form markdown heading conventions and post-render inference are rejected as the primary contract. They are weaker than a sectioned payload and would leave too much quality responsibility inside provider text.

### Role Coverage Derived From Rendered Markdown

Creation quality must be computed from rendered page content, not from curator-declared `required_sections`.

The validator or a validation helper should render each proposed creation page, extract its sections using the same section extractor used by retrieval, and compute coverage from that extracted manifest.

Coverage should include at least:

- required documentation domains exist;
- each required domain maps to one or more rendered pages/sections;
- required section headings/topics are present;
- section bodies meet a minimum useful depth;
- section-level repo-groundable claims have repo citations or explicit inference;
- page is not only bullets or generic summary prose;
- page can contribute to representative answerability questions.

Curator-reported `quality_diagnostics` can remain as a proposal/explanation artifact, but deterministic validation must own the trusted content-quality decision.

### Answer-Domain Documentation Map

Project Memory creation should replace the old six-role page taxonomy with an answer-domain documentation map.

The map is organized around domains future agents need to query and act on, not generic page roles. The initial Myelin create contract should require domains such as:

- product and memory model;
- storage and retrieval;
- command workflows;
- curation and apply lifecycle;
- evidence, provenance, and candidate boundaries;
- current work, roadmap, and decisions.

The six old roles can inform domain coverage, but they are not the primary contract. Validation should prove required answer domains are represented by rendered pages/sections and can answer the representative product questions.

### Two-Pass Evidence Workflow

Project Memory create mode should use a two-pass evidence workflow.

Pass 1 builds a deterministic evidence map for the required answer domains. The map starts from default orientation surfaces, then uses repo-local searches and bounded file reads to identify the concrete docs, code paths, commands, state files, schemas, tests, and decisions that support each domain.

Pass 2 asks the curator to write sectioned Project Memory markdown from that evidence map. Candidates and Session Memory remain leads, but the evidence map is the durable bridge from lead to repo-grounded documentation.

The evidence map should be saved as a run artifact and should make missing coverage explicit. At a high level, the artifact should include:

- required answer domains;
- representative questions per domain;
- inspected paths and source refs;
- cited docs, code paths, commands, state files, schemas, tests, and ADR/design records;
- candidate and Session Memory leads considered;
- evidence found per domain;
- missing evidence per domain;
- search terms or deterministic discovery steps used.

The writer should not be allowed to paper over missing evidence with generic prose.

### Independent Usefulness Critique

First-create Project Memory should require an independent model-backed usefulness critique after deterministic validation and before marking the project curated.

The deterministic gate owns mechanical and groundedness checks:

- sectioned payload shape;
- rendered markdown headings;
- answer-domain coverage;
- section depth;
- repo citation coverage;
- missing evidence findings;
- answerability fixture coverage;
- content/retrieval status separation.

The independent critique owns a different question: whether the rendered documentation is practically useful to a future agent trying to work in the repo. It should review the rendered markdown and evidence map, not the curator's hidden reasoning, and return a structured verdict of `pass`, `review_only`, or `fail` with concise reasons and cited weak sections.

`blocked` is reserved for deterministic validation or infrastructure conditions where Myelin cannot safely evaluate or publish. The usefulness critique should not produce `blocked`; it should fail or mark review-only when the content is insufficient.

First-create can mark Project Memory `curated` only when deterministic validation passes and the independent critique passes. This reviewer is a quality gate for first-create Project Memory, not a replacement for deterministic validation and not an answer synthesis feature.

### All-Or-Nothing First Create

First-create Project Memory should be all-or-nothing for canonical wiki and curated state promotion.

If any required answer domain, deterministic quality check, evidence coverage requirement, answerability fixture, or independent usefulness critique fails, the run must not promote partial documentation into canonical `projects/<key>/wiki/` as trusted Project Memory and must not mark `projects/<key>/state/project-memory.json` as curated.

Useful partial output should remain inspectable in run artifacts. A later run can reuse or learn from those artifacts, but future agents should not be able to confuse partial first-create output with trusted canonical Project Memory.

### Clean Rebootstrap Reset

For untrusted dogfood/create reset, Myelin may delete and recreate the project shell instead of trying to archive-and-adopt old wiki files.

This reset may remove `projects/<key>/` material such as wiki pages, project state, project-local sources, project-local runs, retrieval state, and generated project-shell files, then run bootstrap again for the same repo path. The reset must not wipe the repo-root memory database at `state/memory.db` unless the operator explicitly asks for a memory wipe.

The preserved root SQLite database contains Session Memory, Memory Candidates, handoffs, Experience Log rows, embeddings, and other memory-layer state keyed by `project_key`. Those records can still seed the new first-create run through the evidence workflow. Project shell files are replaceable; root memory rows are the preserved continuity layer.

This reset should be explicit operator work, not an implicit side effect of ordinary `project learn`. A clean create command or dogfood reset step can perform it after preflight confirms the target project key, repo path, and reset scope.

### Failed-Run Resume State

Failed, shallow, blocked, or review-only first-create runs should write compact project state that points to detailed run artifacts.

`projects/<key>/state/project-memory.json` should preserve enough status to orient a future agent without duplicating diagnostics:

- trust status such as uncurated, shallow, blocked, review-only, or curated;
- quality contract version;
- latest create run ref;
- evidence map artifact ref;
- validation diagnostics artifact ref;
- independent usefulness critique artifact ref when present;
- short terminal reason.

Detailed section findings, missing topics, citation issues, and critique notes remain in run artifacts. Project state is the durable resume pointer, not the full diagnostic store.

## Open Design Areas

The live agenda is answered. Pressure testing found and resolved one second-layer question: how first-create handles preexisting untrusted project shell files from failed or shallow prior runs.

## Create-Mode Coverage Requirements

For `llm-wiki`, create mode must document Myelin's core Project Memory questions:

- where runtime and SQLite state live;
- which SQLite tables represent Session Memory, candidates/handoffs, and Project Memory retrieval rows;
- why Session Memory rows are trusted memory records while Project Memory retrieval rows are derived pointers;
- how Project Memory markdown is created, validated, applied, and indexed;
- how Session Memory candidates/handoffs feed Project Memory as leads;
- how query resolves Project Memory index hits back to markdown;
- which commands operators use for create, query, indexing, inbox, ingest, and status-like inspection;
- how degraded or shallow content must be reported.

The create-mode prompt should keep candidates and Session Memory as leads, but first-create documentation should be grounded primarily in repo docs/code.

## Quality Diagnostics

Project Memory quality diagnostics should report deterministic findings, not only curator claims.

Expected diagnostic areas:

- rendered page count;
- rendered section count per documentation domain;
- required topic coverage;
- per-section body depth;
- per-section citation coverage;
- independent usefulness critique verdict;
- shallow-summary findings;
- missing coverage findings;
- candidate disposition summary;
- answerability coverage;
- content-quality status;
- retrieval-readiness status.

Content quality remains separate from retrieval readiness:

- `trusted`: rendered markdown satisfies the documentation contract.
- `shallow`: rendered markdown is safe but too thin, missing sections/topics, or fails answerability checks.
- `review_only`: potentially useful material that needs human review before canonical trust.
- `blocked`: deterministic validation cannot safely evaluate or publish.

`completed_with_pending_index` must only apply when content quality is trusted and retrieval work is pending/degraded. It must never launder shallow content into curated Project Memory.

## State And Apply Behavior

Creation apply must only promote canonical wiki writes and write `projects/<key>/state/project-memory.json` with `status: curated` when deterministic content quality is trusted and the independent usefulness critique passes.

Failed, shallow, blocked, or review-only first-create output should remain in run artifacts, while compact project state records the terminal status and artifact refs needed for resume.

If preexisting project shell material exists while Project Memory state is uncurated, shallow, blocked, review-only, or otherwise untrusted, the implementation must follow the clean rebootstrap reset policy before running trusted first-create promotion when the operator has selected a clean create/reset path.

The existing apply journal and changeset boundaries should remain intact unless the resolved design requires replacing their shape.

## Out Of Scope

- Step 7 auto-maintenance and section-first maintenance behavior beyond avoiding contradictions with the create contract.
- Step 8 full query/CLI contract implementation beyond ensuring the docs become section-queryable.
- Step 9 dogfood execution.
- Step 10 MCP wrapper.
- Practice Memory and Personal Memory roadmap expansion.
- Answer synthesis over Project Memory.
- Making SQLite/vector rows canonical Project Memory.

## Testing Strategy

Implementation should add or update tests that prove:

- page rendering outputs real `##` sections from structured section payloads;
- section extraction sees the same sections rendered by create mode;
- a creation draft with declared sections but only one rendered section is rejected as shallow;
- coverage is computed from rendered markdown sections, not curator metadata;
- a thin six-page role-shaped output like the failed dogfood cannot mark content trusted;
- trusted content with pending retrieval can complete as pending-index, while shallow content cannot;
- section-level citations are required for repo-groundable sections;
- answerability coverage fails when SQLite/session/project retrieval topics are absent;
- existing query hydration still returns markdown content/refs from canonical sections.

## Planning Boundary Guidance

Future planning should split this design into small chunks:

- Sectioned page payload and renderer: replace the weak page-body model with sectioned rendered markdown.
- Answer-domain documentation map: replace the old role taxonomy with the resolved domain/page/section contract.
- Two-pass evidence workflow: build a deterministic answer-domain evidence map before curator writing.
- Rendered-section quality evaluator: derive coverage from rendered markdown.
- Creation validator/schema/prompt update: make create mode require the new contract and deterministic quality gate.
- Create-mode evidence artifact contract: persist and validate the evidence map that feeds documentation writing.
- Answerability and usefulness critique gate: add deterministic answerability checks and independent first-create critique.
- All-or-nothing first-create promotion: prevent partial canonical wiki/state promotion and preserve partial output in run artifacts.
- Clean rebootstrap reset: explicitly delete/recreate the project shell while preserving root SQLite memory state.
- Failed-run resume state: write compact trust status and artifact refs without duplicating diagnostics into project state.
- Targeted regression tests: prove the failed June 30 shape cannot pass.

## Assumptions

- The current broad Step 4 reset remains valid and this design specializes Steps 5 and 6.
- Existing apply safety, artifact, and recovery mechanics should be preserved only if they fit the new contract.
- CLI/script interfaces are the dogfood interface for this repo; MCP is later.
- Backward compatibility with the current create-mode page contract is not required.

## Open Questions

The initial agenda questions and pressure-test question are answered. No open design questions remain before external design audit.
