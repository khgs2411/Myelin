# Testing Roadmap And Current Gaps

Myelin's verification practice combines Bun unit tests, deterministic stub fixtures, roadmap-driven dogfood evidence, and explicit product-gap tracking for Project Memory quality.

## Verification Commands And Test Layout

The root test commands are intentionally small:

- `bun test` runs the Bun test suite.
- `bun run typecheck` runs `tsc --noEmit`.
- `make test` and `make typecheck` are thin aliases for those commands.

`package.json` defines the package as a Bun/TypeScript CLI package and exposes only `typecheck` and `myelin` scripts. `bunfig.toml` sets the Bun test root to `tests`, so test discovery is centered on that directory rather than on colocated source tests.

The test tree mirrors product boundaries:

- `tests/commands/` covers CLI command surfaces such as bootstrap, capture, ingest, memory, project, schema, session, and status.
- `tests/runtime/` covers provider invocation and runtime primitives, including the JSON-only LLM client behavior.
- `tests/project/` covers Project Memory packet, curator, validation, markdown apply, draft promotion, retrieval lookup, evidence-map, rendered-quality, usefulness-critique, and newer agent-authored contract pieces.
- `tests/memory/` covers SQLite storage, Session Memory records, embeddings, query embedding cache, retrieval indexing/storage/text, candidates, handoffs, and sqlite-vec/runtime behavior.
- `tests/ingest/`, `tests/inbox/`, `tests/maintenance/`, `tests/capture/`, `tests/install/`, `tests/schema/`, `tests/session/`, and `tests/status/` cover the remaining bounded services.
- `tests/query/` contains query-service and quality-evaluation tests, including executable fixture questions.

This layout matches the repo's product boundaries: command surfaces, runtime/provider boundaries, Project Memory, Session Memory/retrieval, ingest, capture, and maintenance each have their own test areas.

## Fixture And Stub Strategy

Myelin uses deterministic fixtures where provider calls, embeddings, or dogfood memories would otherwise make tests unstable.

The JSON-only LLM path supports `LLM_STUB_RESPONSES_DIR`. `tests/runtime/llm-client.test.ts` verifies that stub mode reads canned responses, checks prompt hashes, and reports token estimates. The same test file verifies that live Codex dispatch uses `codex exec --sandbox read-only` for JSON-only stages and that structured output schemas can be passed to Codex.

Embedding tests use explicit stub behavior as well. `docs/AGENTS.md` and environment documentation name `EMBEDDING_STUB_RESPONSES_DIR` for deterministic embedding/index tests, while `tests/memory/embedding-provider.test.ts` verifies stub embedding fixture naming and checked-in embedding fixtures.

Query-quality fixtures live under `tests/query/fixtures/`:

- `class-kit-session-memory-questions.json` is a small cross-project question fixture.
- `llm-wiki-session-memory-quality.json` is a dogfood-derived Session Memory snapshot from 2026-06-17. It includes memories, candidates, cached vector matches, and expected diagnoses such as ranking, stale lifecycle, candidate promotion, and branch filtering.

The fixture strategy is deliberately not a claim of live product quality. The 2026-07-06 design requires stubbed file-authoring runs to identify themselves as `stub` or `test` so they cannot be mistaken for live Project Memory dogfood.

## Roadmap Status

`docs/ROADMAP.md` is the canonical implementation tracker. As of the current snapshot:

- Steps 0 through 2 are done: Bun/TypeScript runtime foundation, project shell/capture, Session Memory ingest, Session Memory indexing, branch-aware query, and auto-maintenance are implemented.
- Step 3 and Step 3.5 mechanics are done: Project Memory packet building, curator pre-write flow, structured output contracts, markdown apply, source-consumption reconciliation, retrieval indexing, and dogfood plumbing were built.
- Step 4 records that the 2026-06-30 `llm-wiki` Project Memory dogfood was mechanically valid but product-quality failed. The important conclusion is that successful transport, schema, apply, and retrieval plumbing did not prove useful Project Memory documentation.
- Steps 5 and 6 added rendered markdown contracts, answer-domain diagnostics, first-create orientation, usefulness critique, and clean reset support, but the later dogfood still showed that this foundation did not satisfy the product vision.
- Step 6.5 is the active `next` item: define the vision-quality first-create gate.
- Steps 7 through 11 remain open: candidate-guided maintenance, Project Memory query/CLI contract, CLI dogfood acceptance, MCP wrapper, and future Practice/Personal Memory roadmap work.

The roadmap also records always-on guardrails: hooks stay fast and fail-open, provider-backed work stays detached and bounded, SQLite is serving/recall state rather than curated truth, and markdown Project/Practice/Personal Memory stays human-reviewable.

## Active Vision-Quality Gap

The current gap is not a missing test command or a missing structured validator. It is the product gap between "foundation-valid documentation" and "Project Memory a future agent can trust as living repo documentation."

`docs/ROADMAP.md` Step 6.5 says the active task is to define a vision-quality first-create gate. That gate should be driven by representative questions from `MY_VISION.md`, citation precision for repo-groundable claims, real provider dogfood rather than deterministic fixture success, and explicit failure wording when docs are only foundation-valid.

The 2026-07-06 design changes the solution direction. `docs/adr/0065-require-independent-first-create-usefulness-critique.md` previously required deterministic validation plus an independent usefulness critique before curated state. `docs/adr/0067-use-agent-authored-project-memory-documentation.md` supersedes that create/apply/validation approach. The current direction is agent-authored markdown: a planner/index agent chooses the documentation subjects, subject writer agents write the markdown files, Myelin enforces write boundaries and promotion safety, and retrieval indexing derives from promoted markdown.

So future agents should not extend the old section-count, answer-domain, citation-count, or quality-score gates as the primary product answer. Those tests remain evidence of the previous boundary and regression coverage during migration, but ADR 0067 says documentation shape should be owned by the planner agent and judged through live usefulness/dogfood, not schema-shaped page payloads.

## Deferred Work

The main deferred work is explicit in the roadmap:

- Candidate-guided Project Memory maintenance is open. Candidates and handoffs are leads; maintenance must verify them against repo evidence before updating canonical markdown.
- Project Memory query is open. The intended query path should search derived SQLite/vector serving state, then resolve hits back to canonical markdown sections or page refs.
- Product-query fixture questions are open. The roadmap calls out questions about SQLite storage, Session-to-Project candidate flow, `project learn` write decisions, runtime inbox intake, source consumption, and retrieval/indexing.
- CLI dogfood acceptance is open. The shallow `llm-wiki` wiki needs reset or quarantine, recreate through the redesigned flow, representative query checks, and manual usefulness review.
- MCP tooling is deferred until CLI/script behavior is stable. MCP should wrap working Myelin behavior rather than invent Project Memory semantics.
- Practice Memory and Personal Memory are intentionally later. They should reuse proven Project Memory mechanics after Session Memory plus Project Memory prove the core loop.

The 2026-07-06 implementation plan decomposes the current redesign into contracts/state/CLI surface, file-authoring runner, draft-wiki promotion, agent-authored create mode, agent-authored maintenance mode, `project learn` composition and recreate, retrieval/legacy-curator cleanup, and live dogfood acceptance.

## Current Docs Versus Archive

The current reading path is `docs/README.md`, `README.md`, `docs/CLI.md`, `MYELIN.md`, `CONTEXT.md`, `docs/IMPLEMENTATION_ALIGNMENT.md`, and `docs/ROADMAP.md`.

`docs/archive/README.md` is explicit that archived docs are not canonical current truth. The archive describes the V1 Python/Bash implementation, early V2 plans, and historical design material. Those artifacts are useful for understanding why the product evolved, but they do not describe the active Bun/TypeScript implementation.

Current docs differ from archived designs in several important ways:

- V1 `make update`, Python FastMCP, `agents/`, and Bash/Python heredoc pipelines were quarantined and deleted during the clean TypeScript rewrite.
- Current command vocabulary uses Myelin V2 concepts such as `project learn`, top-level `ingest`, `memory query`, `schema check`, and `schema build`.
- Current implementation alignment treats runtime/provider primitives, project-rooted layout, schema check/build, and detached MCP boundary as foundation, while warning not to blindly extend old wiki/compiler/session assumptions.
- ADR 0067 makes the latest Project Memory direction agent-authored markdown, not archived schema-shaped wiki generation or old V1 update-loop designs.

When an archived design conflicts with current roadmap, ADR, or implementation alignment docs, treat the archived design as historical source material only.

## Practical Orientation For Future Work

For implementation work, start with the active roadmap item, then inspect the matching design/ADR and tests. For the current Project Memory quality work, the important files are:

- `docs/ROADMAP.md`
- `docs/IMPLEMENTATION_ALIGNMENT.md`
- `docs/design/2026-07-06-project-memory-agent-authored-documentation/spec.md`
- `docs/design/2026-07-06-project-memory-agent-authored-documentation/plan.md`
- `docs/adr/0067-use-agent-authored-project-memory-documentation.md`
- `tests/project/`
- `tests/runtime/llm-client.test.ts`
- `tests/query/fixtures/`
- `tests/memory/fixtures/`

Verification should report the exact checks run. For mechanical changes, use targeted `bun test <test-file>` first where practical, then broaden to `bun test` and `bun run typecheck` before dogfood. For live Project Memory acceptance, deterministic tests are not enough: the roadmap and 2026-07-06 design require a real provider dogfood run and representative query/usefulness review.
