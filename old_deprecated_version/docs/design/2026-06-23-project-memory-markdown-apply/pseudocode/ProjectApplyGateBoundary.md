# ProjectApplyGateBoundary

Pseudocode artifact. Non-executable reference shape for planning.

## Boundary Summary

Project Memory markdown mutation is a deterministic code-owned boundary for both first-brain creation and routine maintenance. Provider output may propose content, but only validated curator artifacts plus concrete apply payloads may reach the applier.

Trusted Project Memory for apply means `projects/<key>/state/project-memory.json.status === "curated"`. `bootstrap-state.status === "curated"` can remain shell/onboarding compatibility context, but it is not sufficient by itself to treat wiki markdown as trusted maintenance state.

## Owns

`ProjectMemoryCuratorService` owns:

- project-learn orchestration;
- incomplete apply-journal preflight before new curator invocation;
- packet creation;
- provider invocation;
- validation invocation;
- apply decision;
- deterministic recovery dispatch when an incomplete journal can be replayed or completed;
- terminal run result and summary.

`ProjectMemoryMarkdownApplier` owns:

- safe wiki path resolution;
- reading targeted markdown;
- rendering structured content into canonical markdown;
- rendering all target outputs into a staged location before canonical promotion;
- creating and updating `project-memory-apply-journal.json`;
- completing or repairing interrupted canonical promotion from saved run artifacts and journal state;
- publishing creation page drafts;
- applying maintenance entry/page operations;
- writing changed markdown/state files;
- recording changesets, bounded before/after snippets, and before/after hashes;
- writing project-level Project Memory Source Consumption records and mirroring consumed refs in run artifacts.

`project-memory-curator-validator.ts` owns:

- curator output schema checks;
- packet ref resolution;
- path safety classification;
- operation/lifecycle legality;
- provenance floor;
- repo citation expectations;
- risk quarantine decisions.

`src/runtime/project-run-infrastructure.ts` owns only mechanical helpers:

- run directory creation;
- JSON artifact writing;
- markdown run artifact writing;
- provider invocation wrapper;
- schema context freshness helper.

## Must Not Own

The provider/curator must not:

- write files directly;
- emit arbitrary patch hunks for apply to trust;
- self-assign protected state;
- bypass validation by labeling unsupported claims as inference.

The applier must not:

- call an LLM;
- rediscover unbounded repo context;
- decide whether unsupported claims are true;
- apply rejected or quarantined items;
- update derived retrieval indexes in this slice.

Runtime helpers must not:

- know Project Memory modes;
- know eligible/rejected/quarantined semantics;
- decide apply safety;
- own canonical wiki markdown conventions.

CLI parsing must not:

- inspect curator items;
- decide item-level safety;
- directly mutate wiki markdown.

## Apply Gate Grammar

```text
canApply(run):
  require dryRun == false
  require review == false
  require validation.ok == true
  require rejected_item_ids empty
  require quarantined_item_ids empty
  require mode is create or maintain
  if mode == create:
    require project-memory.json is missing or not curated
    require validated creation draft
    require concrete page drafts
    require trusted index page draft plus at least one meaningful domain page or explicit no-domain-pages rationale
    require safe new/adopted wiki page targets
    require curated project-memory state intent
  if mode == maintain:
    require project-memory.json status is curated
    require eligible_item_ids not empty
    require eligible maintenance item payloads
    require concrete apply payload present for each eligible mutation
    require target pages exist unless explicit new-page operation is supported
  require target paths already validated and rechecked under wiki root
```

```text
preflightRecoveryBeforeCurator(project):
  find incomplete project-memory-apply-journal.json artifacts
  if none:
    continue to packet build and new curator invocation
  if journal has saved input-packet, curator output, validation, staged outputs or renderable apply payloads:
    replay or complete deterministic apply promotion
    update journal terminal status
    write recovered run result/summary
    return before invoking a new curator
  else:
    fail closed with exact recovery guidance
    do not invoke a new curator over partially applied canonical memory
```

## Canonical Write Set

Allowed in this slice:

- `projects/<key>/wiki/**/*.md` targeted by validated creation page drafts or eligible maintenance items;
- `projects/<key>/state/project-memory.json` for curated/apply status, including creation publication;
- `projects/<key>/state/pages.json` if page manifest/hash updates already fit current state conventions;
- `projects/<key>/state/project-memory-source-consumptions.json` or equivalent project-level source-consumption state;
- `projects/<key>/log/changelog.md` or log files if existing shell conventions expect terminal run notes;
- run artifacts under the current `projects/<key>/runs/project-learn/<run-id>/`.

Required run artifacts for applied runs:

- `project-memory-apply-journal.json`;
- `project-memory-apply-result.json`;
- `project-memory-changeset.json`, including bounded before/after snippets for changed blocks or page sections;
- source-consumption refs mirrored from project-level state.

Disallowed in this slice:

- root source code mutation by `project learn`;
- raw/source preservation rewrites;
- SQLite Project Memory truth rows;
- derived vector/retrieval indexes;
- Practice or Personal Memory markdown;
- MCP implementation changes.

## Must Preserve

- Markdown and staged state outputs are rendered first; `project-memory.json` is promoted last after all page writes succeed.
- Changeset artifacts include bounded before/after snippets plus hashes, file paths, ids, and provenance; full-page duplication is not the default.
- Apply is all-or-nothing for the target write set with journal-backed recovery, not best-effort per item.
- Creation mode requires a trusted index plus at least one meaningful domain page or explicit no-domain-pages rationale before marking `project-memory.json` curated.
- Successful apply writes Project Memory Source Consumption records to project state and mirrors them in run artifacts.
