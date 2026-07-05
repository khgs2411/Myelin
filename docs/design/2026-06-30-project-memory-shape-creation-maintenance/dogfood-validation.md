# Project Memory Step 4 Dogfood Validation

Project key: `llm-wiki`
Date: 2026-06-30
Baseline shallow wiki state: recorded before reset/recreate

## Baseline Checks

- Existing wiki page count: 5 markdown files.
- Existing project-memory state: `projects/llm-wiki/state/project-memory.json` present before reset.
- Existing retrieval index status: `structural_sections_seen: 5`, `indexed: 0`, `pending_remaining: 0`, `degraded: false`.

Commands:

```bash
find projects/llm-wiki/wiki -maxdepth 2 -type f -name '*.md' | sort
```

Output:

```text
projects/llm-wiki/wiki/architecture-data-flow.md
projects/llm-wiki/wiki/index.md
projects/llm-wiki/wiki/operations-current-work.md
projects/llm-wiki/wiki/product-purpose.md
projects/llm-wiki/wiki/runtime-commands.md
```

```bash
bun src/cli.ts memory index project llm-wiki --json
```

Output summary:

```json
{
  "project_key": "llm-wiki",
  "structural_sections_seen": 5,
  "selected": 0,
  "indexed": 0,
  "failed": 0,
  "pending_remaining": 0,
  "degraded": false
}
```

## Reset And Archive

Archive directory: `projects/llm-wiki/state/dogfood-baselines/2026-06-30-step4/`

Moved:

```text
projects/llm-wiki/wiki -> projects/llm-wiki/state/dogfood-baselines/2026-06-30-step4/wiki-before-reset
projects/llm-wiki/state/project-memory.json -> projects/llm-wiki/state/dogfood-baselines/2026-06-30-step4/project-memory-before-reset.json
projects/llm-wiki/state/project-memory-retrieval -> projects/llm-wiki/state/dogfood-baselines/2026-06-30-step4/project-memory-retrieval-before-reset
```

`projects/llm-wiki/state/project-memory-source-consumptions.json` was not present during reset preflight.

Archived files:

```text
projects/llm-wiki/state/dogfood-baselines/2026-06-30-step4/project-memory-before-reset.json
projects/llm-wiki/state/dogfood-baselines/2026-06-30-step4/project-memory-retrieval-before-reset/sections.json
projects/llm-wiki/state/dogfood-baselines/2026-06-30-step4/wiki-before-reset/architecture-data-flow.md
projects/llm-wiki/state/dogfood-baselines/2026-06-30-step4/wiki-before-reset/index.md
projects/llm-wiki/state/dogfood-baselines/2026-06-30-step4/wiki-before-reset/operations-current-work.md
projects/llm-wiki/state/dogfood-baselines/2026-06-30-step4/wiki-before-reset/product-purpose.md
projects/llm-wiki/state/dogfood-baselines/2026-06-30-step4/wiki-before-reset/runtime-commands.md
```

## Reset Proof Before Provider

```bash
find projects/llm-wiki/wiki -maxdepth 2 -type f -name '*.md' | sort
```

Output: no markdown files.

```bash
sed -n '1,80p' projects/llm-wiki/state/bootstrap-state.json
```

Output summary:

```json
{
  "status": "uncurated"
}
```

```bash
test ! -f projects/llm-wiki/state/project-memory.json
```

Result: exited 0.

## Create Mode

Command:

```bash
bun src/cli.ts project learn llm-wiki --json
```

Initial local terminal result:

```json
{
  "project_key": "llm-wiki",
  "mode": "create",
  "status": "failed",
  "failure_kind": "provider_failed_before_output",
  "run_dir": "projects/llm-wiki/runs/project-learn/2026-06-30T13-54-39.318Z-run",
  "stopped_before_writes": true,
  "validation_ok": false,
  "stopped_reason": "provider invocation failed before curator output: codex exited 1; ERROR: failed to initialize in-process app-server client: Operation not permitted (os error 1)"
}
```

Run artifacts:

```text
projects/llm-wiki/runs/project-learn/2026-06-30T13-54-39.318Z-run/input-packet.json
projects/llm-wiki/runs/project-learn/2026-06-30T13-54-39.318Z-run/curator-output-error.json
projects/llm-wiki/runs/project-learn/2026-06-30T13-54-39.318Z-run/curator-validation.json
projects/llm-wiki/runs/project-learn/2026-06-30T13-54-39.318Z-run/curator-run-result.json
projects/llm-wiki/runs/project-learn/2026-06-30T13-54-39.318Z-run/summary.md
```

`curator-validation.json` summary:

```json
{
  "ok": false,
  "mode": "create",
  "project_key": "llm-wiki",
  "global_findings": [
    {
      "severity": "blocker",
      "category": "provider",
      "code": "provider_failed_before_output",
      "message": "provider invocation failed before curator output: codex exited 1; ERROR: failed to initialize in-process app-server client: Operation not permitted (os error 1)"
    }
  ]
}
```

The sandboxed provider invocation failed before curator output. A rerun outside the sandbox was requested with the exact same command, but escalation was rejected by policy because the unsandboxed provider-backed command could export repository data to an external LLM service. Dogfood execution paused until the user ran the provider-backed command directly.

Post-failure state:

```text
projects/llm-wiki/state/project-memory.json absent
projects/llm-wiki/wiki/index.md present, containing only the project shell index generated during the failed run
```

## Continuation Attempt After Explicit Approval

The user explicitly approved rerunning the provider-backed dogfood command outside the sandbox, including the external provider path:

```bash
bun src/cli.ts project learn llm-wiki --json
```

Result: BLOCKED by execution policy before the command ran.

```text
This unsandboxed provider-backed project learn run would send repository and project-memory context from a private workspace to an external LLM provider.
Tenant policy denies private data export to an untrusted external destination.
```

No workaround or indirect execution was attempted. The dogfood validation remains blocked until the command can be run from an environment/policy configuration where provider-backed repository-context export is allowed.

The user then ran the same provider-backed command directly from their environment.

User-run result:

```json
{
  "project_key": "llm-wiki",
  "mode": "create",
  "status": "completed_with_pending_index",
  "run_dir": "projects/llm-wiki/runs/project-learn/2026-06-30T15-15-07.891Z-run",
  "content_quality_status": "trusted",
  "retrieval_readiness_status": "pending",
  "validation_ok": true,
  "stopped_before_writes": false,
  "stopped_reason": "mandatory Project Memory retrieval hint generation is pending",
  "changed_files": [
    "projects/llm-wiki/wiki/architecture-data-flow.md",
    "projects/llm-wiki/wiki/current-work-roadmap.md",
    "projects/llm-wiki/wiki/decisions-terms.md",
    "projects/llm-wiki/wiki/index.md",
    "projects/llm-wiki/wiki/product-memory-model.md",
    "projects/llm-wiki/wiki/runtime-workflows.md",
    "projects/llm-wiki/state/project-memory.json"
  ]
}
```

Post-create validation:

- `curator-validation.json`: `ok: true`.
- `projects/llm-wiki/state/project-memory.json`: `status: curated`, `content_quality.status: trusted`, `retrieval_readiness.status: pending`.
- Created six role pages: `index.md`, `product-memory-model.md`, `runtime-workflows.md`, `architecture-data-flow.md`, `current-work-roadmap.md`, and `decisions-terms.md`.
- Retrieval index artifact from the create run saw six structural sections and indexed six rows, but hint generation remained pending.

## Product-Quality Reclassification

Status as of 2026-07-05: FAILED as Project Memory, despite mechanical success.

The run result and state file reported trusted content, but that is now treated as a false positive. The output proved provider transport, schema-driven curator output, deterministic validation, markdown apply, state writes, source-consumption mechanics, and derived retrieval indexing. It did not prove that the generated wiki is useful as durable Project Memory.

The product model being validated is:

- Session Memory is recent continuity produced from real captured agent conversations.
- Session Memory may create Project Memory candidates or handoffs for higher-layer curation.
- Project Memory candidates are leads only. They prioritize and target investigation, but they are not durable truth.
- Project Memory is repo-grounded living documentation. The Project Memory curator must inspect bounded target-repo evidence, cite durable sources, and write canonical markdown only when the result helps a future agent understand the repo without rediscovering everything.
- Project Memory query should use SQLite/vector serving state to find canonical markdown sections or pages, then return inline markdown content or canonical refs. SQLite/vector rows are pointers, not Project Memory truth.

Preserved implementation pieces:

- The curator runs from the target repository cwd.
- `project learn` writes inspectable `input-packet.json` and `curator-output-contract.json` artifacts.
- Structured provider output and deterministic validation are the correct write boundary.
- Markdown apply, apply journals, changesets, runtime inbox intake, source-consumption reconciliation, and post-apply retrieval lifecycle remain useful mechanics.
- Project Memory retrieval should stay derived from canonical markdown sections.

Rejected acceptance conclusion:

- The generated six-page wiki must not be treated as trusted Project Memory.
- `content_quality_status: trusted` from this run is a product-quality bug in the gate, not evidence of useful memory.
- `completed_with_pending_index` is only appropriate for trusted content with pending retrieval work. It is not appropriate for shallow content.

## Usefulness Review

Create-mode output is not useful enough to mark Project Memory curated for this dogfood slice.

- role coverage: FAIL - all six role pages exist, but the rendered markdown has only one top-level section per page. The curator declared `required_sections`, but those sections were not published as actual markdown headings and therefore are not real retrievable documentation sections.
- citation quality: INSUFFICIENT - pages include repo citations, but citation presence did not force enough operational detail, source comparison, or answerable documentation.
- candidate handling: PARTIAL - candidates are represented as leads and provenance, not direct truth; maintenance validation below found and fixed terminal no-op lifecycle gaps. This is preserved but not sufficient for Project Memory quality.
- query behavior: MECHANICALLY FIXED ONLY - query can return current Project Memory sections instead of stale archived vector rows, but the current sections are too shallow to answer realistic product questions well.
- future-agent utility: FAIL - the wiki does not contain enough detail to answer questions such as where SQLite state is stored, how Session Memory records differ from Project Memory retrieval rows, how `project learn` decides writes, or how Project Memory query resolves index hits back to markdown.
- content-quality gate: FAIL - validation counted declared role/section intent rather than the rendered markdown a future agent can read and query.

Implementation implication: Step 4 must replace the current quality gate with one based on rendered markdown, real sections, depth, citations, and answerability. The current shallow wiki should be preserved only as failed dogfood evidence until a redesigned create run replaces it.

## Project Memory Index

Command:

```bash
bun src/cli.ts memory index project llm-wiki --json
```

Result after create:

```json
{
  "project_key": "llm-wiki",
  "structural_sections_seen": 6,
  "selected": 0,
  "indexed": 0,
  "pending_remaining": 0,
  "degraded": false
}
```

The create run had already indexed the six structural sections. A follow-up indexing command was therefore a no-op.

## Project-Layer Query

Test prompts:

```text
how does session memory feed project memory?
how does project learn decide whether to write Project Memory?
what commands should an agent use to validate Project Memory?
```

Initial query attempts surfaced stale archived vector rows such as old `wiki/runtime-commands.md` and `wiki/project-memory-workflow.md`, producing degraded `missing_markdown` results.

Fix applied:

- `searchProjectMemoryRetrievalVectors` now restricts vector results to matching `project_memory_retrieval_embeddings` rows with `status = 'indexed'`.
- Regression coverage seeds current indexed, stale, and unrelated vector rows and asserts only the current indexed row is returned.

Post-fix query result summary:

```json
{
  "memory_scope": "project_memory",
  "degraded": false,
  "degraded_reason": null,
  "matches": [],
  "project_memory_matches": "current wiki paths and inline section content"
}
```

## Maintenance

First maintenance pass after create:

```bash
bun src/cli.ts project learn llm-wiki --json
```

Result: `needs_review`, `content_quality_status: shallow`, `stopped_before_writes: true`.

The first meaningful maintenance proposal correctly returned no markdown writes and explicit no-op decisions, but deterministic validation treated the no-op-only maintenance pass as shallow and blocked all source-consumption writes. Dogfood exposed that valid terminal no-op decisions had no way to retire consumed Project Memory candidates/handoffs.

Fix applied:

- Maintain-mode explicit no-op decisions can be valid even when fallback lookup makes markdown writes non-auto-applyable.
- Only terminal explicit no-ops with `project_candidate` or `project_handoff` refs enter the source-consumption apply path.
- The markdown applier writes `projects/<key>/state/project-memory-source-consumptions.json` for those explicit no-op decisions.
- `noop_inputs` remain documented review context and do not get retired by this path.
- Session Memory-only explicit no-ops complete without writes instead of returning `needs_review`.

Live maintenance result after fix:

```json
{
  "project_key": "llm-wiki",
  "mode": "maintain",
  "status": "completed",
  "run_dir": "projects/llm-wiki/runs/project-learn/2026-06-30T15-34-05.952Z-run",
  "changed_files": [
    "projects/llm-wiki/state/project-memory-source-consumptions.json"
  ],
  "source_consumptions": [
    "project_candidate:project_inbox:llm-wiki:2026-06-28T10-11-25.076Z_4a7d5d",
    "project_candidate:cand_llmwiki_project_memory_source_consumption_evidence",
    "project_candidate:cand_llmwiki_roadmap_item_descriptions",
    "project_candidate:cand_llmwiki_stop_hook_semantics",
    "project_candidate:cand_llmwiki_query_authority_router",
    "project_candidate:cand_llmwiki_ingest_status_retry_label",
    "project_candidate:cand_llmwiki_query_architecture_review"
  ],
  "stopped_before_writes": false,
  "validation_ok": true
}
```

The source-consumption record also included already-trusted project handoffs. A follow-up `project learn` reconciled those source-consumption records into queue state; all seven project candidates became `processed` with `processed_at: 2026-06-30T15:37:13.186Z`.

Final no-write maintenance pass after the Session Memory-only no-op guard:

```json
{
  "project_key": "llm-wiki",
  "mode": "maintain",
  "status": "completed",
  "run_dir": "projects/llm-wiki/runs/project-learn/2026-06-30T15-43-06.373Z-run",
  "content_quality_status": "shallow",
  "retrieval_readiness_status": "pending",
  "stopped_before_writes": true,
  "stopped_reason": "explicit no-op decision produced no source-consumption writes",
  "validation_ok": true
}
```

## Final Verification

Focused no-op/source-consumption regression suite:

```bash
bun test tests/project/project-memory-curator-validator.test.ts tests/project/project-memory-curator-service.test.ts tests/project/project-memory-markdown-applier.test.ts tests/project/project-memory-source-consumption-reconciler.test.ts
```

Result: PASS - 68 pass, 0 fail.

Earlier focused query/index regression suite:

```bash
bun test tests/memory/sqlite-vec.test.ts tests/query/project-memory-query-service.test.ts tests/query/memory-query-service.test.ts tests/commands/memory.test.ts
```

Result: PASS - 25 pass, 0 fail.

Full verification after final source-consumption contract fix:

```bash
bun test
```

Result: PASS - 425 pass, 0 fail.

```bash
bun run typecheck
```

Result: PASS - `tsc --noEmit`.

```bash
git diff --check
```

Result: PASS - no whitespace errors.
