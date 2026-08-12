# Roadmap, Decisions, And Documentation Sources

Myelin's documentation authority is split between canonical product docs, the live roadmap, append-only ADRs, and historical archives.

## Canonical Reading Path

`docs/README.md` is the documentation map and says returning maintainers should read these in order:

1. `README.md` for operator quick start, commands, runtime, and repo layout.
2. `docs/CLI.md` for the exhaustive command reference.
3. `MYELIN.md` for canonical product design and north star.
4. `CONTEXT.md` for product vocabulary and resolved naming or shape ambiguities.
5. `docs/IMPLEMENTATION_ALIGNMENT.md` for how the current code maps to the V2 product shape.
6. `docs/ROADMAP.md` for implementation status, known gaps, and the next step.

`MYELIN.md` is the highest-level product design source. It explicitly says it wins over other docs when product design conflicts, except for `docs/adr/*` decision records, which it summarizes but does not override. `CONTEXT.md` is the glossary for terms such as Project Memory, Session Memory, Experience Log, Memory Candidate, Project Memory Creation Mode, Project Memory Retrieval Index, and the Myelin product name. `docs/IMPLEMENTATION_ALIGNMENT.md` is a snapshot for comparing the current implementation with the intended project-rooted memory model; it marks which layers are worth keeping, which are thin seeds, and which legacy-shaped surfaces should be reframed.

For new durable documentation, `docs/README.md` gives the ownership rule: update `MYELIN.md` for canonical design, `CONTEXT.md` for terminology or resolved ambiguity, `docs/IMPLEMENTATION_ALIGNMENT.md` for implementation alignment, `docs/ROADMAP.md` for progress and planned work, and `docs/archive/` for historical source material. Maintainers should avoid adding parallel design docs that compete with `MYELIN.md`.

## Roadmap Authority

`docs/ROADMAP.md` is the canonical progress tracker. It answers "what are we doing next?" regardless of the last conversation, while `MYELIN.md` remains the product design. The roadmap's operating convention is top-to-bottom execution: the first unchecked `next` item is the active implementation task, `open` items are known future work, `done` items are built and verified, and `retired` items are removed from active direction.

The roadmap also defines maintenance rules for itself:

- Mark completed work only when code, docs, and verification land.
- When a `next` item completes, mark it `done` and promote the next smallest item to `next`.
- Add new work when a real gap appears, but do not create a second TODO, DONE, task-list, or roadmap file.
- Keep roadmap items scoped to product behavior rather than one session's conversation.
- Do not treat the dogfood Experience Log queue as something to manually finish, because every user and assistant message adds rows and auto-maintenance owns that loop.

As of the snapshot, Steps 0 through 6 are marked complete or retired across runtime foundation, project shell and capture, Session Memory, Project Memory foundation, retrieval-quality hardening, product reality reset, published documentation contract, and create mode. Step 6.5 is active: the `next` item is to define a vision-quality first-create gate so foundation-valid Project Memory cannot be treated as vision-satisfactory documentation. Later open work covers Project Memory maintenance and candidate promotion, Project Memory query and CLI contracts, a CLI dogfood acceptance loop, MCP wrappers for other projects, and future Practice/Personal Memory roadmap extension.

## ADR Authority

`docs/adr/` contains append-only decision records named `000N-<slug>.md`. `MYELIN.md` includes a thematic decision index, but the ADR files remain the decision authority. Superseded ADRs are preserved instead of rewritten; for example, ADR 0008 and ADR 0010 are explicitly superseded by later Bun/TypeScript and detached-MCP decisions.

Important ADR themes for maintainers include:

- Curated Project Memory remains markdown plus metadata JSON, while SQLite is serving, recall, session, event, queue, and vector state: `docs/adr/0021-keep-curated-project-memory-in-markdown.md`.
- Project Memory learning may inspect the live repo directly, but durable writes still need traceable evidence or explicit inference labels: `docs/adr/0018-project-learn-can-read-live-repo.md`.
- Routine `project learn` updates auto-apply by default, while risky changes are gated: `docs/adr/0019-project-learn-auto-applies-by-default.md` and `docs/adr/0020-gate-risky-project-learn-changes.md`.
- Project Memory retrieval is derived from canonical markdown and separate hint/index maintenance, not a second source of truth: `docs/adr/0062-derive-project-memory-retrieval-from-markdown.md`.
- First-create Project Memory quality moved through answer-domain maps, evidence-first creation, and independent critique in ADRs 0063, 0064, and 0065.
- The current create-mode direction is agent-authored Project Memory documentation, not structured JSON page curation: `docs/adr/0067-use-agent-authored-project-memory-documentation.md`. ADR 0067 partially supersedes ADR 0058 and supersedes ADRs 0059, 0063, 0064, and 0065 where they required structured page payloads, answer-domain maps, deterministic evidence-map-first creation, or independent first-create critique as documentation-shape gates. It preserves the markdown truth boundary, journal-backed promotion, derived retrieval state, and clean reset decisions.

When ADRs and narrative docs appear to disagree, prefer the most specific current ADR for the decision it covers, then update the narrative doc if it is stale. Do not silently blend an old ADR pattern with a newer one.

## Archive Boundary

`docs/archive/` is historical source material, not current product truth. `docs/README.md` says archive files are useful for recovering intent only when a canonical doc explicitly cites them as historical source material. `docs/archive/README.md` reinforces that archived V1 Python/Bash docs, early V2 plans, and superseded specs no longer describe the live code, because the V1 codebase was quarantined and deleted during the clean TypeScript rewrite.

The archive preserves why the product is shaped as it is, including older V1 update-loop designs, route-repair ideas, brain metadata/relationship designs, Obsidian projection ideas, and richer MCP metadata plans. Those intents may carry forward, but their implementation details are not current authority.

There is one stale-reference risk in the archive docs: `docs/archive/README.md` lists `docs/DONE.md` and `docs/TODO.md` as current built/planned inventory, but this snapshot's live documentation map and roadmap say `docs/ROADMAP.md` is the canonical implementation checklist and warn against creating a second TODO, DONE, task-list, or roadmap file. Future maintainers should treat the archive statement as historical drift unless live docs reintroduce those files.

## Maintenance Conventions

Use the docs according to their role:

- For product direction, update `MYELIN.md`, and preserve conflicts with ADRs instead of rewriting decisions casually.
- For vocabulary, update `CONTEXT.md`; it records preferred terms and terms to avoid.
- For implementation status or next work, update `docs/ROADMAP.md`; do not create competing progress files.
- For current code/design alignment, update `docs/IMPLEMENTATION_ALIGNMENT.md`.
- For durable decisions, add a new ADR under `docs/adr/`; do not edit old decisions into a new meaning.
- For superseded plans or raw brainstorming, use `docs/archive/`.

Project Memory maintainers should cite concrete repo paths when turning these docs into wiki knowledge. The important source paths for this subject are `docs/README.md`, `MYELIN.md`, `CONTEXT.md`, `docs/IMPLEMENTATION_ALIGNMENT.md`, `docs/ROADMAP.md`, `docs/adr/`, and `docs/archive/README.md`.
