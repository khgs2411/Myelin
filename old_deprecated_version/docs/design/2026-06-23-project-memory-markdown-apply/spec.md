# Project Memory Markdown Apply Design

Status: Final design. Ready for external design/spec audit before implementation planning.

## Goal

Implement the Step 3 markdown-apply slice for Project Memory: `project learn <key>` should turn validated Project Memory Curator output into durable, provenance-backed markdown under `projects/<key>/wiki/`, with narrow machine-readable state updates and inspectable run artifacts.

This design covers both state-derived `project learn` modes:

- `create`: publish the first trusted Project Memory pages and mark the project memory state as curated.
- `maintain`: apply bounded updates to trusted Project Memory pages from eligible maintenance proposal items.

The design should preserve the core Project Memory rule: markdown plus project state is curated truth; provider output, run artifacts, Session Memory, candidates, and future indexes are evidence or serving state, not canonical Project Memory.

## Current Context

`docs/ROADMAP.md` names the active Step 3 item as "Apply bounded page updates with provenance." The acceptance criteria require proposed markdown changes to be bounded to known pages or explicit new-page requests, every durable update to carry provenance or an explicit inference label, apply to consume validated curator artifacts rather than raw provider output, unsafe output to stop before canonical writes, and tests to prove accepted low-risk output updates only expected markdown/state files.

The current codebase already has the pre-write half:

- `src/project/project-memory-packet.ts` builds bounded curator input from project state, wiki summaries, pending Project Memory handoffs/candidates, selected Session Memory, and degraded markdown lookup results.
- `src/project/project-memory-curator-contracts.ts` defines `ProjectMemoryCreationDraft` and `ProjectMemoryMaintenanceProposal`.
- `src/project/project-memory-curator-validator.ts` deterministically validates curator output and classifies maintenance items as `eligible`, `rejected`, `quarantined`, or `noop`.
- `src/project/project-memory-curator-service.ts` builds the packet, invokes the mode-scoped curator, validates output, writes run artifacts, and currently always returns `stopped_before_writes: true`.
- Existing tests assert the current pre-write behavior, including that successful curator runs do not mutate wiki markdown.

The key implementation gap is that current curator output contains `content_intent`, not concrete markdown content or a structured apply payload. `content_intent` is useful for review, but it is not sufficient authority for deterministic canonical writes.

## Source Artifacts

- `docs/ROADMAP.md`
- `MYELIN.md`
- `CONTEXT.md`
- `docs/adr/0018-project-learn-can-read-live-repo.md`
- `docs/adr/0019-project-learn-auto-applies-by-default.md`
- `docs/adr/0020-gate-risky-project-learn-changes.md`
- `docs/adr/0058-use-mode-scoped-project-learn-curator-contracts.md`
- `docs/adr/0059-use-structured-project-memory-apply-payloads.md`
- `docs/adr/0060-use-apply-journal-for-project-memory-writes.md`
- `docs/design/2026-06-18-project-memory-curator/spec.md`
- `docs/design/2026-06-18-project-memory-curator/agenda.md`
- `docs/design/2026-06-18-project-memory-curator/plan.md`
- `docs/design/2026-06-23-project-memory-markdown-apply/pseudocode/`

## Documented Decisions From Prior Artifacts

- `project learn` is the authoritative Project Memory command.
- `project learn` has two state-derived authority modes: `create` and `maintain`.
- Creation and maintenance use related but separate curator output contracts.
- Curators propose structured output and never write markdown directly.
- Myelin validates curator output deterministically before any canonical markdown write.
- Routine low-risk project learning should auto-apply by default; risky output, review mode, and dry-run mode stop before canonical writes.
- Project Memory canonical truth lives in markdown plus project state, not SQLite.
- Derived Project Memory retrieval indexes are out of scope for this slice.
- `project ingest` is not restored as a separate Project Memory command.
- The apply boundary must cover both creation and maintenance; deferring one mode requires a product-safety reason, not workload avoidance.
- Curator output should include a structured Project Memory Apply Payload that deterministic code validates and renders, rather than exact markdown patches or `content_intent` as write authority.
- Project Memory apply should target all-or-nothing canonical writes through staged outputs and an apply journal that records expected writes, observed promotion, and recovery status.
- Project Memory changesets should store bounded before/after snippets for changed page sections or entry blocks, plus file hashes and provenance.
- Successful apply should write terminal Project Memory Source Consumption records for consumed candidate/handoff refs into project state and mirror them in run artifacts, while leaving candidate/handoff status mutation to a later reconciler.
- `project learn` should preflight incomplete apply journals before invoking a new curator. Recovery replays or completes the deterministic apply from durable run artifacts and the journal; it does not redo the agentic curator run.
- For apply authority, trusted curated Project Memory means `projects/<key>/state/project-memory.json` has `status: "curated"`. `bootstrap-state.json` may remain onboarding/shell compatibility state, but it is not sufficient by itself to treat Project Memory markdown as trusted for maintenance apply.

## User-Facing Behavior

`myelin project learn <key>` should remain the user-facing command.

For an auto-apply eligible run:

1. The command builds the Project Memory packet.
2. The mode-scoped curator returns strict JSON.
3. Myelin validates the curator output.
4. Myelin applies validated concrete page or entry payloads to canonical Project Memory markdown/state.
5. The command reports a completed run with `stopped_before_writes: false`.
6. Run artifacts include validation and apply evidence.

For a stopped-before-writes run:

- `--dry-run` should not mutate canonical markdown/state.
- `--review` should not mutate canonical markdown/state.
- invalid, rejected, quarantined, high-risk, degraded, unsupported, or malformed apply payloads should not mutate canonical markdown/state.
- the run result should explain why it stopped and point to artifacts.

Creation mode should publish the first trusted Project Memory surface only when the creation draft has concrete publishable page content, safe wiki targets, provenance, and a valid curated-state intent.

Maintenance mode should apply only eligible proposal items with concrete payloads, safe existing target pages, legal lifecycle transitions, provenance, and low enough risk for auto-apply.

Trusted Project Memory for apply is gated by `projects/<key>/state/project-memory.json.status === "curated"`. The current packet mode helper may still read `bootstrap-state.json` for compatibility, but this slice should not let `bootstrap-state.status === "curated"` alone bypass creation publication or mark untrusted wiki markdown as maintenance-ready.

## Technical Design

### Apply Boundary

Add a deterministic Project Memory markdown applier under `src/project/`. The applier is code-owned and provider-free. It consumes:

- the same Project Memory packet used for validation;
- the curator output artifact;
- the validation result;
- a mode-aware apply selection;
- run paths for apply artifacts.

The applier does not:

- call an LLM;
- rediscover unbounded repo context;
- reinterpret `content_intent`;
- apply rejected or quarantined items;
- write derived retrieval indexes;
- mutate Practice or Personal Memory.

### Concrete Apply Payload

The curator output contract must grow from review-oriented intent to applyable content. The draft pseudocode proposes a versioned `ProjectMemoryApplyPayload` with:

- page drafts for creation publishing;
- entry drafts for maintenance updates;
- body paragraphs/bullets/warnings supplied as structured markdown content;
- evidence refs;
- repo citations;
- inference labels when direct evidence is unavailable;
- applicability metadata.

The concrete payload should be structured content rendered by code. Exact markdown bodies and patch-like changes are rejected because they weaken deterministic validation, provenance consistency, and the boundary where code owns canonical Project Memory markdown shape.

### Creation Apply

Creation apply publishes trusted Project Memory when no curated Project Memory exists.

Creation apply should require:

- packet mode `create`;
- a valid `ProjectMemoryCreationDraft`;
- concrete page draft payloads for every page selected for publication;
- a trusted `index.md` plus at least one meaningful domain page, or an explicit no-domain-pages rationale recorded in the apply artifact;
- safe `new_wiki_page` or explicitly adopted existing-page targets;
- page-level evidence refs and repo citations or explicit inference labels;
- a state intent that marks Project Memory curated only after page writes succeed;
- a changeset linking page writes, state writes, and source artifacts.

Creation apply writes only:

- selected wiki pages under `projects/<key>/wiki/`;
- `projects/<key>/state/project-memory.json`;
- page/freshness/changelog state if the implementation establishes or follows the existing project shell convention;
- run artifacts under the current project-learn run directory.

Preexisting uncurated markdown remains untrusted unless the creation draft explicitly adopts, rewrites, ignores, or quarantines it.

### Maintenance Apply

Maintenance apply updates trusted Project Memory after curated state exists.

Maintenance apply should require:

- packet mode `maintain`;
- a valid `ProjectMemoryMaintenanceProposal`;
- validation ok;
- at least one eligible item;
- no rejected or quarantined items in the auto-applied proposal;
- concrete apply payload for every eligible mutation;
- existing target pages unless this design explicitly adds a new-page maintenance operation;
- provenance or an explicit inference label rendered with each changed entry.

The initial maintenance operation set remains:

- `CREATE_ENTRY`
- `PATCH_ENTRY`
- `ATTACH_EVIDENCE`
- `MARK_STALE`
- `MARK_DISPUTED`
- `SUPERSEDE_ENTRY`
- `RETRACT_ENTRY`
- `NOOP`

### Markdown Shape

The working draft uses stable markdown entry blocks for machine-addressable maintenance entries while keeping the page human-readable:

```md
<!-- myelin-entry id="setup.cli.project-learn" lifecycle="active" -->
### Project Learn CLI

`project learn <key>` maintains curated Project Memory from a bounded packet.

Provenance:

- Evidence: project_candidate:cand_123
- Repo: src/commands/project.ts:74-121

<!-- /myelin-entry -->
```

The comment markers provide deterministic replacement targets. Visible provenance preserves human reviewability. Lifecycle operations update the marker and append compact lifecycle evidence rather than silently deleting or rewriting history.

Page drafts in creation mode may render complete pages with entry blocks inside them.

### Apply Artifacts

Runs should continue to write:

- `input-packet.json`
- `curator-creation-draft.json` or `curator-maintenance-proposal.json`
- `curator-validation.json`
- `curator-run-result.json`
- `summary.md`

When apply runs, add:

- `project-memory-apply-journal.json`
- `project-memory-apply-result.json`
- `project-memory-changeset.json`

The changeset should include run id, packet ref, curator output ref, validation ref, applied timestamp, changed file paths, before/after hashes, page/item ids, bounded before/after snippets for changed page sections or entry blocks, evidence refs, repo citations, inference labels, and risk. It should not duplicate full before/after page content by default.

Apply should also write terminal Project Memory Source Consumption records for candidate and handoff refs used by applied payloads. These records borrow the tombstone lifecycle shape from Session Memory ingest: they preserve source refs, terminal decisions, and output refs. They should not be called tombstones in this layer, because Experience Log tombstones have raw-row archive and lease semantics that do not apply to structured Project Memory candidate/handoff inputs.

## Data / State

Canonical writes allowed in this slice:

- `projects/<key>/wiki/**/*.md` targeted by validated creation page drafts or eligible maintenance items.
- `projects/<key>/state/project-memory.json` for curated/apply state, including creation publication.
- `projects/<key>/state/pages.json` if page manifest/hash updates are implemented or already fit current conventions.
- `projects/<key>/state/project-memory-source-consumptions.json` or equivalent project-level state for consumed candidate/handoff refs and output refs.
- `projects/<key>/log/changelog.md` or log files if the existing shell convention expects terminal run notes.
- run artifacts under `projects/<key>/runs/project-learn/<run-id>/`.

Canonical writes disallowed in this slice:

- root source code mutation by `project learn`;
- preserved raw/source rewrites;
- SQLite Project Memory truth rows;
- derived Project Memory retrieval/vector indexes;
- Practice or Personal Memory markdown;
- MCP implementation changes.

## Error Handling

The flow fails closed.

Stop before writes when:

- `--dry-run` is set;
- `--review` is set;
- provider invocation fails;
- curator output is not valid JSON;
- validation has global blockers;
- validation rejects or quarantines output;
- creation mode has no publishable page drafts;
- maintenance mode has no eligible items;
- concrete apply payload is missing or malformed;
- target paths fail wiki-root safety checks;
- operation support is absent in this slice.

Apply should use an all-or-nothing target with journal-backed recovery:

1. Compute the full expected canonical write set.
2. Write an apply journal/progress artifact before canonical promotion.
3. Render and validate staged outputs first.
4. Promote staged files to canonical paths only after the complete write set is ready.
5. Update `project-memory.json` and other state last.
6. Record observed promotions, final status, and before/after hashes in the journal and changeset.

If interruption or failure occurs mid-promotion, the next `project learn` run or a deterministic recovery helper should use the journal to detect and complete or repair the intended write set. Partial canonical writes are treated as exceptional and recoverable, not as an acceptable normal terminal state.

Recovery should replay the deterministic apply phase from durable run state: `input-packet.json`, curator output, validation result, staged outputs or renderable apply payloads, and the apply journal. It should not rerun the curator as a recovery mechanism because a new provider invocation can produce a different intended write set over a partially changed wiki. `project learn` should preflight incomplete apply journals before starting new curator work and either complete recovery or fail closed with exact recovery guidance.

## Testing Strategy

Focused tests should cover:

- creation mode publishes expected wiki pages and project-memory state from a valid creation draft;
- maintenance mode updates only targeted existing wiki pages from eligible low-risk items;
- dry-run and review never mutate wiki/state files;
- validation failures, rejected items, quarantined items, degraded packet quarantine, unsupported operations, and missing concrete payloads never mutate canonical files;
- apply journals, apply results, changesets, and source-consumption records are written when apply runs;
- before/after hashes match changed files;
- bounded before/after snippets are recorded for changed blocks or page sections;
- interrupted apply journals are preflighted before new curator work and are recovered through deterministic apply replay rather than a new provider invocation;
- source-consumption records are written to project state and mirrored in the run changeset without mutating candidate/handoff status;
- path traversal and non-wiki targets fail before writes;
- existing pre-write tests are updated so `stopped_before_writes: true` remains expected only for stopped runs.

Repo-level verification should include:

```bash
bun test
bun run typecheck
git diff --check
```

Focused verification should include project curator validator, curator service, command, and new applier tests under `tests/project/` and `tests/commands/`.

## Planning Boundary Guidance

Future implementation planning should split this design into smaller chunks. A likely chunk map:

1. Apply payload contract and validation extension.
   - Depends on current curator contracts.
   - Enables deterministic apply.
   - Verifies malformed concrete payloads fail before writes.

2. Markdown block renderer/parser and path-safe file mutation helpers.
   - Depends on chosen markdown block format.
   - Enables maintenance operations.
   - Verifies id-based upsert/lifecycle behavior and path safety.

3. Apply journal, staging, and recovery preflight.
   - Depends on apply payload selection and write-set calculation.
   - Enables all-or-nothing target writes and interrupted-run recovery.
   - Verifies staged output promotion, state-last updates, incomplete journal detection, and deterministic apply replay before new curator work.

4. Creation apply.
   - Depends on concrete page payload and renderer.
   - Enables first trusted Project Memory publication.
   - Verifies initial pages and `project-memory.json` state are written together.

5. Maintenance apply.
   - Depends on entry block mutation helpers and validation extension.
   - Enables eligible proposal items to update existing pages.
   - Verifies accepted low-risk items update only expected files.

6. Source-consumption records.
   - Depends on apply result and changeset shape.
   - Enables later candidate/handoff lifecycle reconciliation without rescanning all runs.
   - Verifies project-level source-consumption state and run changeset mirrors are written without mutating candidate/handoff status.

7. Project learn service integration and run result/artifacts.
   - Depends on apply result shape and applier.
   - Enables command-level behavior.
   - Verifies stopped-before-writes versus applied terminal states.

8. Documentation, roadmap, and test drift cleanup.
   - Depends on implementation behavior.
   - Aligns CLI docs, roadmap, and tests with the new apply semantics.

Creation and maintenance may be sequenced internally for verification safety, but the approved product boundary should cover both modes.

Before `$pmp-writing-plans` is used, the finalized design must go through an external design/spec audit by a separate sub-agent using the `plan-auditor` skill. That audit should treat `Ready for Development` as ready to proceed to `$pmp-writing-plans`. Critical issues must be incorporated into the design artifacts, and re-audit must continue until the audit returns `Ready for Development` or the user explicitly accepts remaining non-blocking risks.

## Acceptance Criteria

- Valid creation drafts can publish bounded Project Memory wiki pages and curated project-memory state with provenance.
- Valid low-risk maintenance proposals can update targeted Project Memory wiki pages with provenance.
- Apply consumes validated curator artifacts plus concrete apply payloads, not raw provider output or free-form intent.
- Rejected, quarantined, invalid, review-required, dry-run, and unsupported outputs cannot mutate canonical Project Memory.
- Every durable page/entry write renders provenance or an explicit inference label.
- Apply artifacts include an apply journal, result, and changeset with enough evidence to inspect changed files, changed page/item ids, bounded before/after snippets, hashes, and source provenance.
- Interrupted apply journals are recovered by deterministic apply replay before any new curator invocation.
- Project Memory Source Consumption records are written to project state and mirrored in run artifacts without directly mutating candidate/handoff statuses.
- Tests prove canonical writes are limited to expected wiki/state/run files.

## Assumptions

- The existing `ProjectMemoryPacket` remains the authoritative curator input.
- The existing mode distinction (`create` and `maintain`) remains correct.
- The current `content_intent` fields will either be supplemented or replaced by concrete apply payload fields.
- The existing validator will grow stricter for creation publication and maintenance apply payloads.
- Derived retrieval indexing remains a later Step 3 item.
- Candidate/handoff status mutation remains outside this slice, but Project Memory Source Consumption records are in scope so a later reconciler can update lifecycle without guessing or rescanning all historical run artifacts.

## Agenda Status

All material agenda questions are resolved in `agenda.md`. The design must still pass the external `plan-auditor` design/spec audit before `$pmp-writing-plans`.
