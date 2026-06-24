# ProjectLearnMarkdownApplyFlow

Pseudocode artifact. Non-executable reference shape for planning.

## Draft Flow

`project learn <key>` remains the authoritative Project Memory command. The markdown apply slice extends the current curator flow after validation and must cover both state-derived modes: first-brain creation and routine maintenance.

Trusted Project Memory for apply means `projects/<key>/state/project-memory.json.status === "curated"`. `bootstrap-state.status === "curated"` alone should not make untrusted wiki markdown eligible for maintenance apply.

```text
project learn
  -> resolve project
  -> preflight incomplete project-memory-apply-journal.json artifacts
      -> if recoverable: replay/complete deterministic apply and return recovered result
      -> if unrecoverable: fail closed with recovery guidance before curator invocation
  -> repair or verify project shell
  -> ensure schema context
  -> build Project Memory packet
  -> write input-packet.json
  -> invoke mode-scoped curator
  -> write curator output artifact
  -> validate curator output
  -> write curator-validation.json
  -> decide apply
      -> skip before writes
      -> deterministic creation publish or maintenance apply using staged outputs and journal
  -> write apply journal/result/changeset/source-consumption artifacts when apply ran
  -> write curator-run-result.json
  -> write summary.md
```

## Apply Decision

Skip before writes when:

- `--dry-run` is set;
- `--review` is set;
- provider invocation failed;
- curator output was not JSON;
- validation has global blockers;
- validation rejected or quarantined items;
- creation mode has no publishable page drafts, or maintenance mode has no eligible items;
- packet degradation produced quarantine;
- concrete apply payload is missing or malformed;
- `bootstrap-state.status` is curated but `project-memory.json.status` is not curated and the run is attempting maintenance apply;
- target operation is unsupported by this slice.

Proceed to apply when:

- validation is ok;
- all mutation items selected for apply are eligible;
- concrete apply payload exists and validates;
- risk is low enough for auto-apply;
- target paths resolve under `projects/<key>/wiki/`;
- trusted-state predicate matches the selected mode;
- creation mode has concrete page drafts and valid curated-state intent, or maintenance mode has concrete eligible item payloads.

## Apply Execution

The applier:

1. Reloads or receives the same packet used for validation.
2. Resolves all page targets under `projects/<key>/wiki/`.
3. Branches by packet mode without changing ownership:
   - creation mode renders concrete page drafts into the initial trusted wiki page set and initializes curated Project Memory state;
   - maintenance mode maps eligible item ids to concrete entry/evidence/lifecycle payloads and updates existing target pages.
4. Renders page and entry blocks deterministically.
5. Computes before hashes and bounded before snippets for targeted blocks or page sections.
6. Writes staged markdown/state outputs and validates the full staged set.
7. Writes `project-memory-apply-journal.json` with expected writes, staged output refs, before hashes, and recovery status.
8. Promotes canonical wiki files.
9. Promotes `project-memory.json`, `pages.json` if used, and source-consumption state last.
10. Computes after hashes and bounded after snippets.
11. Writes `project-memory-apply-result.json`.
12. Writes `project-memory-changeset.json`.
13. Mirrors consumed source refs from project-level state in run artifacts.
14. Marks the apply journal terminal.
15. Returns item ids, page ids, source-consumption refs, and changed file paths to the service.

## Creation Apply

Creation mode is not a maintenance shortcut. It publishes the first trusted Project Memory surface when no curated Project Memory exists.

Creation apply requires:

- a valid `ProjectMemoryCreationDraft`;
- `projects/<key>/state/project-memory.json` missing or not curated;
- concrete page draft bodies for every page to publish;
- a trusted `index.md` plus at least one meaningful domain page, or an explicit no-domain-pages rationale;
- safe `new_wiki_page` or adopted existing-page targets under the project wiki root;
- page-level evidence refs and repo citations or explicit inference labels;
- `state_intent.mark_project_memory_curated` when publication succeeds;
- a changeset linking page writes, state writes, and curator artifacts.

Creation apply writes:

- initial or adopted wiki pages;
- `projects/<key>/state/project-memory.json` as curated state;
- page manifest/freshness state if that convention is present or introduced by the implementation;
- run apply artifacts.

Creation apply must not treat preexisting uncurated markdown as trusted without the draft explicitly adopting, rewriting, ignoring, or quarantining it.

## Maintenance Apply

Maintenance mode updates trusted Project Memory after curated state exists.

Maintenance apply requires:

- a valid `ProjectMemoryMaintenanceProposal`;
- `projects/<key>/state/project-memory.json.status` is `curated`;
- validation with eligible item ids and no rejected or quarantined item ids;
- concrete apply payload for every eligible mutation;
- existing target pages unless an explicit new-page maintenance operation is added to the contract;
- provenance or inference labels rendered with each changed entry.

## Failure Posture

Provider and validation failures already stop before writes.

Apply failures should fail closed:

- no partial unsupported page mutation should be treated as success;
- if one file write fails, the run result should be `failed` or `needs_review` with exact changed file evidence;
- recovery behavior relies on staged outputs, renderable apply payloads, validation artifacts, and `project-memory-apply-journal.json`; a normal rerun should not invoke a new curator over incomplete promotion;
- summary must distinguish "validated but skipped" from "applied".

## Run Artifacts

Always:

- `input-packet.json`
- `curator-creation-draft.json` or `curator-maintenance-proposal.json`
- `curator-validation.json`
- `curator-run-result.json`
- `summary.md`

Only when apply runs:

- `project-memory-apply-journal.json`
- `project-memory-apply-result.json`
- `project-memory-changeset.json`
- project-level source-consumption state plus mirrored source-consumption refs in run artifacts

Optional if useful:

- `project-memory-apply-preview.md` for dry-run/review output, but preview must not be treated as canonical Project Memory.

## Status Semantics

`completed` should mean the run reached its allowed terminal state:

- `completed` with `stopped_before_writes: true` can be valid for dry-run or review.
- `completed` with `stopped_before_writes: false` means canonical markdown/state writes occurred and changeset artifacts exist.

`needs_review` should mean the run intentionally stopped because output was not safe to auto-apply:

- validation rejected/quarantined item;
- risk gate;
- missing concrete apply payload;
- unsupported operation;
- explicit `--review`.

`failed` should mean infrastructure or apply failure:

- provider command failed;
- non-JSON output;
- file write failure;
- schema context failure.

## Recovery Semantics

`project learn` preflights incomplete apply journals before building a new packet or invoking a new curator. If it finds a recoverable journal, it replays or completes deterministic apply from saved run artifacts, staged outputs or renderable apply payloads, validation, and journal state. If recovery is not safe, it fails closed with exact guidance and does not redo the agentic curator run.

## Must Preserve

- Dry-run and review stop before canonical writes. A preview artifact may be planned, but it must not become canonical Project Memory.
- Mixed eligible/rejected maintenance proposals stay blocked in this slice; `ok` requires no rejected or quarantined maintenance items.
- Successful apply writes Project Memory Source Consumption records into project state and mirrors them in run artifacts.
- Successful apply does not directly mutate candidate/handoff lifecycle status; a later reconciler consumes source-consumption records.
- Journal/recovery, source-consumption records, and bounded snippets are required apply responsibilities, not optional follow-up work.
