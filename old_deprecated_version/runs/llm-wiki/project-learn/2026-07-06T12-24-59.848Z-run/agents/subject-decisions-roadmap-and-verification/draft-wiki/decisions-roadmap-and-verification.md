# Decisions Roadmap And Verification

Myelin's decision and verification record is split between small canonical docs, append-only ADRs, active design plans, and Bun-based test/typecheck commands.

## Canonical Documentation Authority

Start with `docs/README.md`. It names the current reading path and explains which long-lived document owns each kind of truth:

- `README.md` is the operator quick start, command vocabulary, repository layout, runtime notes, verification commands, and MCP/query boundary.
- `MYELIN.md` is the canonical product design and north star.
- `CONTEXT.md` is the product-language glossary and resolved ambiguity log.
- `docs/IMPLEMENTATION_ALIGNMENT.md` maps the current implementation to the V2 product shape.
- `docs/ROADMAP.md` is the canonical implementation checklist, known gap list, and next-step tracker.
- `docs/adr/` is append-only decision history; ADRs are canonical decisions but not the first document to read for product understanding.

`docs/README.md` also defines where new documentation should go. Product design belongs in `MYELIN.md`; terminology belongs in `CONTEXT.md`; implementation alignment belongs in `docs/IMPLEMENTATION_ALIGNMENT.md`; implementation status and next steps belong in `docs/ROADMAP.md`; historical material belongs under `docs/archive/`.

## Active Product And Implementation Baseline

`README.md` describes Myelin as a local-first project memory system for software repositories, implemented as a Bun/TypeScript-first CLI named `myelin`. The root `Makefile` is a thin convenience layer over `bun src/cli.ts`.

`docs/IMPLEMENTATION_ALIGNMENT.md` is the best snapshot of what exists versus the intended product shape. It says the stable foundation is the Bun/TypeScript runtime, provider abstraction, CLI registry, project discovery/state helpers, schema check/build, detached MCP boundary, tests, and typecheck discipline. It also separates "keep but reframe" surfaces from "do not extend blindly" surfaces:

- Keep but reframe: project-wiki query, inbox/gap flow, status command, project wiki metadata, and retained non-Project-Memory stage/reference assets.
- Do not extend blindly: SQLite session logic, future markdown apply beyond the current Project Memory direction, old MCP brain/wiki vocabulary, and advanced schema candidates before real examples exist.

The product implication in `docs/IMPLEMENTATION_ALIGNMENT.md` is important: Myelin is moving from `project files -> wiki pages -> metadata -> query_wiki/update` toward `real project work -> evidence -> curated project memory -> session/current-state continuity -> practice/personal candidates -> semantic query/how/status`.

## ADR Authority And Supersession

The ADR set is append-only, but not every older ADR remains fully active. The highest-priority current decision for Project Memory creation is `docs/adr/0067-use-agent-authored-project-memory-documentation.md`.

ADR 0067 says Project Memory create mode should be agent-authored markdown documentation, not structured JSON page curation. The first create run uses a planner/index agent to inspect the repo and choose documentation subjects, then bounded parallel subject writer agents write markdown files. Myelin owns orchestration, write boundaries, artifacts, state, candidate lifecycle, promotion, and derived retrieval state.

ADR 0067 explicitly supersedes the create/apply/validation portions of:

- `docs/adr/0059-use-structured-project-memory-apply-payloads.md`
- `docs/adr/0063-use-answer-domain-project-memory-documentation-map.md`
- `docs/adr/0064-use-two-pass-project-memory-evidence-workflow.md`
- `docs/adr/0065-require-independent-first-create-usefulness-critique.md`

ADR 0067 partially supersedes `docs/adr/0058-use-mode-scoped-project-learn-curator-contracts.md`: `project learn` remains mode-scoped, but create and maintenance outputs are no longer structured curator drafts/proposals.

The preserved decisions are still authoritative where ADR 0067 says they survive:

- `docs/adr/0021-keep-curated-project-memory-in-markdown.md`: curated Project Memory remains markdown plus metadata JSON.
- `docs/adr/0060-use-apply-journal-for-project-memory-writes.md`: canonical writes use journal-backed staged promotion and recovery.
- `docs/adr/0062-derive-project-memory-retrieval-from-markdown.md`: Project Memory retrieval is derived serving state over canonical markdown and may remain pending after promotion.
- `docs/adr/0066-allow-clean-project-shell-rebootstrap-reset.md`: explicit clean rebootstrap/reset remains available for untrusted or recreated Project Memory.

Other durable boundary ADRs matter when changing implementation:

- `docs/adr/0047-quarantine-v1-and-rewrite-core-clean.md` records the break from the V1 Python/Bash implementation into a clean Bun/TypeScript core.
- `docs/adr/0048-core-owns-query-mcp-consumes-via-contract.md` keeps query logic in root `src/query/` and makes detached MCP consume CLI/JSON output.
- `docs/adr/0050-adopt-myelin-product-name.md` establishes Myelin as the product/CLI/config name while preserving `LLM_WIKI_*` and `mcp__llm-wiki__*` as compatibility contracts.
- `docs/adr/0056-use-detached-target-repo-agents-for-experience-log-ingest.md` makes `myelin ingest <key>` a detached target-repo agent job with tombstone-backed leases.
- `docs/adr/0057-vendor-sqlite-runtime-for-vector-extensions.md` makes vendored SQLite the preferred vector-extension runtime on macOS before host fallbacks.

## Roadmap State

`docs/ROADMAP.md` is the canonical progress tracker. It says to read steps top to bottom and treat the first unchecked `next` item as the active implementation task.

Completed roadmap areas include:

- Step 0 Runtime Foundation: Bun/TypeScript CLI, runtime helpers, provider abstraction, config precedence, and SQLite runtime selection.
- Step 1 Project Shell And Capture: project bootstrap/list/discovery and provider-neutral Experience Log capture.
- Step 2 Session Memory Layer: detached ingest, tombstone-backed leases, Session Memories, candidates, handoffs, embeddings, branch-aware query, degraded query states, and auto-maintenance.
- Step 3 Project Memory Layer: packet construction, mode-scoped curator foundation, structured proposal validation, markdown apply, source-consumption reconciliation, runtime inbox intake, and early Project Memory candidate intake.
- Step 3.5 Project Memory Transport And Retrieval Quality: artifact-reference transport, lookup-quality classification, derived Project Memory retrieval indexing, dogfood retrieval runs, and schema-driven curator output.
- Step 4 Project Memory Product Reality Reset: the 2026-06-30 dogfood output was reclassified as mechanically valid but product-quality failed.
- Step 5 and Step 6: rendered documentation/create-mode foundations, answer-domain diagnostics, quality checks, evidence maps, usefulness critique, and clean reset support.

The current active roadmap item is Step 6.5, `next`: "Define the vision-quality first-create gate." The roadmap states that current `llm-wiki` output is structured and queryable but still too coarse and acceptance-test-shaped to satisfy the intended Project Memory product. The open Step 6.5 and Step 9 work requires live dogfood and representative product questions before Project Memory can be trusted as living repo documentation.

Later open steps keep maintenance, Project Memory query, CLI dogfood acceptance, MCP wrapping, Practice Memory, and Personal Memory behind that first-create quality gate.

## Design History

Use `docs/design/` for current implementation plans and historical design context. The most current design set is `docs/design/2026-07-06-project-memory-agent-authored-documentation/`.

That design replaces schema-shaped create mode with a multi-agent documentation flow:

- A planner/index agent inspects the target repo, writes `draft-wiki/index.md`, and creates one placeholder markdown file per subject.
- Subject writer agents each inspect the repo for their assigned subject and replace their placeholder with detailed markdown.
- Agents write only to run-local output roots; Myelin promotes accepted output atomically.
- Create mode ignores memory candidates while documenting the whole repo.
- Immediately after create mode, maintenance mode processes existing candidates against the newly created documentation.
- Later `project learn` runs are maintenance-only.
- Reports and manifests are orchestration metadata, not a documentation-shape schema.

The associated `plan.md` says the design is ready for development and lists the implementation chunks: shared contracts/state/CLI surface, file-authoring runner, draft-wiki promotion, agent-authored create mode, maintenance mode, project-learn composition/recreate, retrieval and legacy-curator cleanup, and live dogfood acceptance.

The immediately prior design, `docs/design/2026-07-05-project-memory-rendered-create-contract/`, is now useful context rather than the final direction. It tried to improve structured create mode through rendered sections, answer-domain coverage, two-pass evidence maps, independent usefulness critique, all-or-nothing promotion, and clean reset. ADR 0067 supersedes its structured create/apply/validation parts, but its dogfood failure analysis still explains why generic structured output was not enough.

Earlier design folders document the path that led here: Project Memory curator, markdown apply, source-consumption reconciliation, candidate intake, retrieval quality, and shape/maintenance reset. Treat them as design history unless the current roadmap, ADR 0067, or current plan explicitly preserves a boundary.

## Archive Status

`docs/archive/README.md` says archive material is historical unless a canonical doc explicitly cites it. The archive contains V1 Python/Bash implementation docs, superseded specs, old phase plans, and migration records. V1 code was quarantined and deleted during the Phase-0 clean TypeScript rewrite, so archive designs do not describe current code.

The archive is still useful for recovering intent, especially around brain metadata, query planner ideas, route-repair feedback, self-correction, validation warnings, Obsidian projection, and richer MCP metadata. It is not current product truth. When archive and active docs conflict, prefer `docs/README.md`, `MYELIN.md`, `CONTEXT.md`, `docs/IMPLEMENTATION_ALIGNMENT.md`, `docs/ROADMAP.md`, and active ADRs.

## Verification Commands

The current runtime is Bun/TypeScript. Use these checks for normal development:

```bash
bun test
bun run typecheck
make test
make typecheck
```

For Project Memory dogfood and query verification, the active docs and design plan use:

```bash
make learn PROJECT=<key> ARGS="--json"
make query PROJECT=<key> QUESTION="..." ARGS="--json"
```

The CLI equivalents are:

```bash
bun src/cli.ts project learn <project-key> --dry-run
bun src/cli.ts memory query <project-key> "What should I know?"
bun src/cli.ts memory index session <project-key>
bun src/cli.ts ingest <project-key>
bun src/cli.ts ingest status <ingest-job-id>
```

`package.json` defines `bun run typecheck` and `bun src/cli.ts` through the `myelin` script. `README.md` is the current source for Bun-based verification. `CONTRIBUTING.md` still lists `.venv/bin/pytest tests/ -q`; that appears stale relative to the Bun/TypeScript runtime and archived V1 pytest plans.

## Test Coverage Map

The test tree is broad and Bun-oriented. Current test directories cover:

- `tests/project/`: Project Memory packets, curator contracts, validation, markdown rendering/apply, source consumption, rendered quality, draft promotion, lookup, hints, and project reset/service behavior.
- `tests/memory/`: SQLite memory DB, Session Memory storage/text/indexing/query, embeddings, candidates, handoffs, Project Memory retrieval storage/indexing/text, retrieval maintenance queue, and SQLite runtime/vector loading.
- `tests/ingest/`: ingest runtime, worker behavior, jobs, reconciliation context, service, and status.
- `tests/commands/`: CLI command behavior for project, memory, ingest, schema, session, capture, status, bootstrap, and install.
- `tests/runtime/`: runtime helpers, layout, bootstrap, project-run infrastructure, file-authoring agent behavior, provider/client behavior, and IDs.
- `tests/query/`: Session Memory and Project Memory query services, fixtures, and quality evaluation fixtures.
- `tests/capture/`, `tests/inbox/`, `tests/install/`, `tests/maintenance/`, `tests/schema/`, `tests/session/`, and `tests/status/`: focused coverage for those subsystems.

Roadmap entries record prior full-suite verification milestones, including full `bun test`, `bun run typecheck`, and `git diff --check` for markdown-apply and runtime-inbox/intake work. Those are historical reported results, not proof that the current working tree passes today.

## Known Gaps

- The current active gap is Step 6.5: define and implement a vision-quality first-create gate, then prove it with live dogfood rather than deterministic fixture success.
- The current `llm-wiki` Project Memory output is described by the roadmap as structured/queryable but too coarse to trust as the intended product baseline.
- Candidate-driven maintenance remains open until first-create output is useful enough to maintain.
- Project Memory query still needs a stable CLI/product contract for returning markdown content or canonical refs with explicit size and degraded-state behavior.
- MCP wrapping is intentionally later; core CLI behavior must stabilize first.
- `CONTRIBUTING.md` appears stale because it references pytest while `README.md`, `package.json`, and the current test tree use Bun.
- Older structured create-mode tests and quality-contract code may still exist in the tree while ADR 0067 moves the product toward agent-authored markdown; implementation work must deliberately replace or isolate that vocabulary rather than preserving it by accident.
