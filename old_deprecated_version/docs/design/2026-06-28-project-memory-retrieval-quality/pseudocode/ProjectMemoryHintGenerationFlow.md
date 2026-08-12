# ProjectMemoryHintGenerationFlow

Pseudocode artifact. Non-executable reference shape for planning.

## Draft Shape

Hint generation is a separate model-backed flow after canonical markdown exists and structural metadata is derived.

## Inputs

- project key
- category or list of categories
- current `sections.json`
- existing `hints/<category>.json`, when present
- changed/new section refs from apply result or structural refresh
- run context for provider/model/profile

## Outputs

- refreshed `state/project-memory-retrieval/hints/<category>.json`
- hint-generation run artifact with provider prompt/reference, raw result, and validation diagnostics
- SQLite job/status updates after deterministic validation
- retrieval-maintenance queue updates for failures or skipped optional refresh

## Lifecycle

1. Select categories needing hints.
2. Build bounded prompt from structural metadata and canonical markdown snippets.
3. Invoke hint-generation model.
4. Require JSON on stdout or artifact output.
5. Validate that every hint entry points to an actual wiki path, section id, and current section hash.
6. Write accepted hint file to state.
7. Mark invalid/stale/orphaned entries as diagnostics, not canonical memory failures.
8. Trigger or mark pending embedding/index refresh.

## Mandatory Versus Optional Refresh

Mandatory:

- newly created page
- newly created memory entry/section
- structurally changed section whose old hint hash no longer matches

Optional:

- existing updated page where section hashes did not change
- existing hints are valid and no poor-retrieval feedback exists
- operator asks to save cost

Usage-driven:

- retrieval maintenance queue item says semantic usefulness is poor
- user/agent expected a memory hit but retrieval missed it
- query returned misleading high-score hits

## Idempotency

Running hint generation twice for unchanged markdown may rewrite run artifacts, but should not change accepted hint entries unless the refresh was explicitly requested or the existing hint entry is structurally stale. The first implementation should prefer the conservative policy: keep old valid hints, replace structurally stale hints, and preserve alternative model output as diagnostics unless a refresh job explicitly requested replacement.

Job state lives in both surfaces:

- run artifacts preserve provider prompts, raw output, validation diagnostics, and rejected entries;
- SQLite job/status rows track retryable serving-state work, embedding/index status, and queue processing.

## Failure Posture

- Mandatory hint generation failure means the page is not fully indexed.
- Optional hint generation failure records degraded retrieval maintenance but does not invalidate existing valid hints.
- Provider/network failure does not mutate canonical markdown.
- Invalid hint output is preserved as a run artifact and excluded from embeddings.

## Non-Ownership

Hint generation does not:

- decide whether Project Memory content is true;
- choose canonical wiki page structure;
- apply markdown changes;
- create Project Memory candidates.
