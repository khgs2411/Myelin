# Project Memory Agent-Authored Documentation Design

Status: Ready for development after full plan-set audit.

## Goal

Replace schema-shaped Project Memory create mode with a multi-agent documentation authoring flow.

Project Memory create mode should behave like asking a capable Codex team to document a repository: one planner agent inspects the repo, identifies the documentation subjects the project needs, writes the navigable index and placeholder files, then one writer agent per subject creates detailed markdown documentation for that subject. Myelin should orchestrate the run, preserve artifacts, promote the draft atomically, process candidate lifecycle, and rebuild retrieval indexes. It should not force documentation through a narrow JSON page schema or try to prove quality through section counts, body length, role coverage, or citation-count proxies.

## Current Context

The 2026-07-05 `llm-wiki` dogfood produced structured but weak Project Memory. The run artifacts showed the system accepted stubbed, generic documentation because it satisfied the current contract:

- `curator-creation-draft.json` contained sectioned page payload JSON, not a natural documentation tree.
- `curator-validation.json` marked the output trusted because required answer domains, rendered sections, character counts, and citations were present.
- `project-memory-usefulness-critique.json` passed with the shallow reason that the rendered markdown covered answer domains with repo citations.
- `project-memory.json` recorded `status: curated` and `content_quality.status: trusted`.

The failure was not missing mechanics. The failure was the product boundary: create mode is currently curation-schema generation, not documentation authoring.

Relevant current implementation:

- `src/project/project-memory-curator-service.ts` owns `project learn`, packet building, provider invocation, validation, apply, post-apply retrieval indexing, runtime inbox intake, and source-consumption reconciliation.
- `src/project/project-memory-prompt-budget.ts` builds the create/maintain prompt and tells the provider to emit schema-compliant curator output.
- `src/project/project-memory-curator-output-schema.ts` defines the structured output contract passed to Codex.
- `src/project/project-memory-curator-validator.ts` validates curator JSON before writes.
- `src/project/project-memory-markdown-applier.ts` renders structured page payloads to canonical wiki markdown and promotes staged writes.
- `src/project/project-memory-candidate-intake-service.ts` already converts runtime inbox items into project memory candidates.
- Derived retrieval indexing already treats canonical markdown as the Project Memory source of truth.

## Durable Decision Reconciliation

This design is formalized by ADR 0067, `Use agent-authored Project Memory documentation`.

ADR 0067 supersedes the create/apply/validation portions of:

- ADR 0059, `Use structured Project Memory apply payloads`;
- ADR 0063, `Use answer-domain Project Memory documentation maps`;
- ADR 0064, `Use a two-pass Project Memory evidence workflow`;
- ADR 0065, `Require independent first-create usefulness critique`.

ADR 0067 partially supersedes ADR 0058: `project learn` remains mode-scoped, but create and maintenance outputs are no longer structured curator drafts/proposals.

The design preserves:

- ADR 0021: curated Project Memory remains markdown plus metadata JSON;
- ADR 0060: canonical writes use journal-backed staged promotion and recovery;
- ADR 0062: retrieval is derived from canonical markdown and may remain pending after promotion;
- ADR 0066: explicit clean rebootstrap/reset remains available for untrusted or recreated Project Memory.

There is no local `CONTEXT.md`, pseudocode artifact, or child spec/agenda for this design. That is intentional for this slice: the spec, agenda, and ADR 0067 are the authoritative design artifacts.

## User-Stated Direction

The desired model is intentionally simpler:

- First run: multi-agent create mode documents the whole repo.
- Immediately after create mode, maintenance mode processes any existing candidates against the newly created documentation.
- Later runs: maintenance mode only.
- Create mode ignores memory candidates and focuses on full repo documentation.
- Maintenance mode owns memory candidates and updates documentation from those leads.
- Agents should write markdown documentation directly, not JSON page payloads.
- Create mode is the highest-cost and highest-gain phase: it should spend agent work up front to create real project documentation rather than a shallow summary.
- Structure/content validations should be removed or reduced because they constrain the agent more than they help.

## User-Facing Behavior

### First Project Learn Run

When `myelin project learn <key>` runs for a project without curated Project Memory:

1. Myelin creates a timestamped `project-learn` run directory.
2. Myelin prepares a draft wiki directory inside the run, such as `draft-wiki/`.
3. Myelin invokes a create planner/index agent with read access to the target repository and a writable run-local workspace.
4. The planner agent inspects the repository, decides which documentation subjects/domains this repo needs, writes `draft-wiki/index.md`, and creates one placeholder markdown file per subject with a short description of what that file must document.
5. Myelin invokes one subject writer agent per planned documentation file.
6. Each subject writer inspects the repository for its assigned subject and replaces the placeholder with detailed documentation for that subject.
7. The create run writes machine-readable reports describing the planned subjects, completed subject files, and known gaps.
8. Myelin snapshots the completed create output as `pre-maintenance-wiki/`.
9. Myelin runs maintenance mode once against any pending project candidates and runtime inbox items, using the created documentation as the maintenance input.
10. Myelin promotes the final safe wiki output to canonical `projects/<key>/wiki/`.
11. Myelin marks Project Memory curated for successful live provider runs, recording that the documentation was agent-curated.
12. Myelin rebuilds or queues Project Memory retrieval indexing from the final canonical markdown.

The first run may result in no maintenance changes. That is expected when create mode already documented the relevant repo facts.

If create succeeds and the follow-up maintenance pass fails for candidate-specific or otherwise non-destructive reasons, Myelin may still promote the create documentation snapshot from `pre-maintenance-wiki/` and leave the affected candidates pending or reviewable. If maintenance fails because of infrastructure failure, unsafe writes, corrupted draft state, or unclear wiki safety, Myelin should block promotion until the run is repaired or retried.

### Later Project Learn Runs

When `myelin project learn <key>` runs for a project with curated Project Memory:

1. Myelin runs runtime inbox intake.
2. Myelin selects pending project memory candidates and handoffs.
3. Myelin invokes a maintenance agent with read access to the target repository and a writable run-local workspace.
4. The maintenance agent reads the existing wiki, inspects the repo as needed, updates markdown files directly in a draft wiki overlay, and records candidate dispositions.
5. Myelin promotes the resulting documentation changes atomically.
6. Myelin reconciles candidate/source lifecycle.
7. Myelin refreshes retrieval indexing.

## Technical Design

### Create Mode: Multi-Agent Documentation Authoring

Create mode has two required phases.

#### Planner / Index Agent

The planner agent should use a prompt shaped like:

> Review this repository and design the Project Memory documentation set. Inspect the codebase, tests, docs, commands, state files, architecture, and roadmap. Create a navigable `index.md` and one markdown file per documentation subject under the provided draft wiki directory. Each subject file should contain only a short purpose description and assignment instructions for the subject writer. Do not write full documentation yet. Do not modify the repository outside the draft wiki and required report files.

The planner agent receives:

- read access to the target repository;
- writable cwd set to the run-local planner workspace;
- absolute path to the draft wiki directory;
- absolute path to a required planning report output;
- repo/project metadata;
- documentation planning instructions;
- safety rules limiting writes to the draft wiki/report paths;
- optional seed context from product docs such as `MY_VISION.md`, `MYELIN.md`, `AGENTS.md`, and `docs/ROADMAP.md`.

The planner agent does not receive memory candidates as inputs.

The planner agent writes:

```text
draft-wiki/
  index.md
  <subject>.md
reports/
  documentation-planner-report.json
  documentation-subject-manifest.json
```

The subject files are placeholders at this phase. Each placeholder should name the subject, explain what the page must document, and provide any scoped repo areas the subject writer should inspect.

`reports/documentation-subject-manifest.json` is orchestration metadata only. It should list planned subject writer jobs with fields such as subject id, draft wiki path, title, purpose, and suggested repo areas. Myelin may validate that every manifest path is safe, every listed subject has a placeholder file, and every placeholder has a corresponding writer job. The manifest must not define required markdown sections, coverage scores, content domains, or any other content-quality gate.

### File-Authoring Runner Contract

Agent-authored documentation uses a new file-authoring runner contract, separate from JSON-only `invokeLlm`.

The existing `invokeLlm` path remains appropriate for read-only JSON stages. File-authoring create and maintenance stages need a runner that:

- invokes provider-backed agents with a writable sandbox rooted at a run-local agent workspace, not the target repo root;
- gives the agent read access to the target repo and write access only to explicit run-local output paths;
- passes absolute output paths for draft wiki files and required reports;
- records the provider, model, sandbox mode, cwd, allowed output roots, prompt path, and exit status in run artifacts;
- discovers outputs from the filesystem rather than from a JSON stdout payload;
- fails the stage if any modified or generated path escapes the allowed output roots;
- keeps canonical `projects/<key>/wiki/` and `projects/<key>/state/` writes owned by Myelin promotion code.

For Codex, the intended implementation path is a new file-authoring invocation that uses a writable sandbox such as `workspace-write`, with cwd set to a run-local agent workspace under the `project-learn` run directory. It should not reuse the current `invokeCodex` call that hard-codes `--sandbox read-only` and parses JSON stdout.

Stub/test behavior must be explicit. Deterministic tests may populate draft wiki/report artifacts from fixture directories, but stubbed file-authoring runs must set provider mode to `stub` or `test` and must not be mistaken for live product-quality dogfood.

#### Subject Writer Agents

After planning, Myelin invokes one writer agent per planned subject file using bounded parallelism. The concurrency limit should be configurable so create mode can get multi-agent throughput without unbounded provider pressure or local resource contention.

Default subject writer concurrency is 4. Implementations may expose an override, but should reject values below 1 and should cap excessive values to avoid provider and local resource pressure.

Each writer receives:

- read access to the target repository;
- writable cwd set to the run-local subject writer workspace;
- absolute path to its assigned draft wiki file;
- the planner's subject description for that file;
- the current `draft-wiki/index.md` for navigation context;
- safety rules limiting writes to its assigned file and required report path;
- optional seed context from product docs when relevant.

Each writer replaces the placeholder with detailed markdown documentation for its assigned subject. It may reference other draft pages but should not edit them. If the writer discovers the planned subject boundary is wrong, it records that in its report instead of reorganizing the tree directly.

If a subject writer fails mechanically, Myelin should retry that writer before failing the create run. Mechanical failures include non-zero exit, missing assigned file, unchanged placeholder, missing or malformed subject report, or writes outside the assigned output boundary. Retries should not become a content-quality scoring system.

Default subject writer retry count is one retry after the initial failed attempt. The retry receives the same subject assignment plus the prior failure reason.

The writer agents write:

```text
draft-wiki/<subject>.md
reports/subject-report.json
```

Subject writers should include natural repository references in the markdown where they help future agents verify or navigate the documented concept. These references should read like normal project documentation, not forced citation scaffolding.

Each subject report is operational evidence, not a documentation contract. It should include the subject id, assigned path, status, touched path, evidence paths inspected, and known gaps. Myelin may validate the report for mechanical completion, evidence presence, and path safety, but not for section coverage, citation density, or content quality.

The markdown tree is the primary output. The JSON reports are operational metadata, not the documentation shape.

Create mode should not include a final synthesis agent by default. The initial product shape is two authoring layers: planner/index, then per-subject writers. Adding a third content-reconciliation layer is deferred until live dogfood shows repeated evidence that subject writers can document their assigned subjects well but the whole wiki still fails as a coherent documentation set.

### Documentation Shape Ownership

The planner agent owns the documentation shape. Myelin should not require specific files such as `architecture.md`, a fixed skeleton, or a predefined list of documentation domains. The prompt should ask the planner to inspect the repo and decide which subject files are needed.

The only required documentation entrypoint is a navigable `index.md`. The planner-created subject manifest exists so Myelin can launch writer jobs; it is not a schema for what the wiki must contain. Myelin should not reject a documentation tree merely because the planner chose an unexpected but useful page breakdown.

### Maintenance Mode: Candidate-Guided Documentation Agent

Maintenance mode should receive:

- canonical wiki snapshot or draft copy;
- pending project memory candidates from Session Memory and runtime inbox intake;
- candidate source metadata;
- read access to the target repository;
- writable cwd set to the run-local maintenance workspace;
- absolute path to a draft wiki directory or overlay;
- absolute path to a required maintenance report.

The maintenance agent should:

- read the existing documentation first;
- inspect repo files only as needed for candidate verification;
- update existing docs when the candidate reveals missing, stale, or weak coverage;
- create new docs when no existing page owns the concept;
- adjust `index.md` when maintenance adds, removes, or materially changes documentation navigation;
- mark each candidate with one of the canonical candidate dispositions defined below;
- preserve uncertainty instead of inventing documentation.

Maintenance writes markdown directly. It should not emit structured patch operations unless implementation later proves direct writes are unsafe.

The maintenance report should be structured only for candidate lifecycle reconciliation and audit. It may include candidate id, disposition, touched documentation paths, source/evidence pointers, and a short reason for each touched path. It should not contain a structured documentation proposal, page schema, required section list, or quality score that Myelin uses to shape or reject the markdown content.

Canonical maintenance candidate dispositions for this design:

- `applied_to_project_memory`: maintenance changed wiki documentation for the candidate.
- `already_covered`: the existing wiki already covered the candidate after repo verification.
- `insufficient_evidence`: the candidate could not be grounded in the repo or preserved source evidence.
- `not_durable`: the candidate is too transient or task-local for Project Memory.
- `belongs_to_other_layer`: the candidate belongs in Session Memory, schema memory, retrieval maintenance, or another non-Project-Memory layer.
- `deferred_unsafe_change`: the candidate may be useful, but applying it would require a broader or unsafe wiki rewrite.
- `blocked_by_runner_failure`: the maintenance agent could not complete candidate evaluation because of mechanical runner failure.

During migration, existing `already_trusted` records may be read as equivalent to `already_covered`. New maintenance reports should write `already_covered`. The old `blocked_by_quality` disposition is not part of this design because content-quality scoring is removed.

### First Run Composition

The first run is:

```text
create planner/index agent
then per-subject documentation writer agents
then maintenance agent
then promote final wiki output
then retrieval indexing
```

The maintenance phase runs after create because existing candidates may include useful recent product context. The expected no-op path is valid: if create mode documented the whole repo well, maintenance should mostly mark candidates already covered.

### Later Run Composition

Later runs are:

```text
runtime inbox intake
candidate selection
maintenance agent
candidate/source reconciliation
retrieval indexing
```

Create mode does not rerun for curated projects unless the operator explicitly resets or recreates Project Memory.

Automatic recreate is out of scope for normal `project learn`. Once Project Memory is curated, ordinary learn runs are maintenance-only. Recreate is an explicit high-cost rebuild path for cases where the existing documentation shape is wrong or the repo changed enough that maintenance is the wrong tool.

The explicit operator surface for recreate is `myelin project learn <key> --recreate`. That path may use the clean rebootstrap/reset behavior described by ADR 0066, but it must be opt-in and visible.

## Data / State

Run artifacts should preserve enough evidence for audit without making Myelin inspect every content claim:

```text
projects/<key>/runs/project-learn/<run>/
  input-summary.json
  create-planner-prompt.md
  create-subject-prompts/
  maintenance-prompt.md
  draft-wiki/
  pre-maintenance-wiki/
  post-maintenance-wiki/
  documentation-plan-report.json
  documentation-subject-reports/
  reports/documentation-maintenance-report.json
  promotion-journal.json
  promotion-result.json
  retrieval-index-result.json
  summary.md
```

Canonical truth remains:

```text
projects/<key>/wiki/
projects/<key>/state/project-memory.json
```

`project-memory.json` should distinguish:

- `schema_version`: `2`;
- `status`: `curated` when canonical wiki promotion succeeds;
- `project_key`;
- `source_run_dir`;
- `updated_at`;
- `provider_mode`: `live`, `stub`, or `test`;
- `curation_kind`: `agent_authored` or `human_reviewed`;
- `run_kind`: `create`, `maintenance`, `create_then_maintenance`, or `recreate`;
- `create.status`: `completed`, `failed`, or `skipped`;
- `create.planner_status`: `completed` or `failed`;
- `create.subject_writer_status`: `completed`, `failed`, or `partial_failed`;
- `create.subject_count`;
- `create.subject_writer_concurrency_limit`;
- `create.subject_writer_retry_limit`;
- `maintenance.status`: `completed`, `noop`, `degraded`, `skipped`, or `failed`;
- `maintenance.degraded_reason`, when create output was promoted after a candidate-specific maintenance failure;
- `retrieval_readiness.status`: `ready`, `pending`, `degraded`, or `not_applicable`.

For compatibility during migration, `content_quality` may remain present as a summary field, but it must not represent a content-shape validation gate. A live provider run that passes file-authoring safety and promotion checks may record `content_quality.status: trusted` with a contract version for agent-authored documentation. Stub/test runs should not record product-trusted state unless invoked through an explicit test-only path.

Candidate lifecycle state remains structured. Maintenance may move a candidate to terminal status only when the required disposition report names the candidate and records a supported disposition. Missing, malformed, or unknown candidate dispositions should leave those candidates pending or reviewable rather than silently consuming them.

## Validation Boundary

Remove content-shape validation from the harness.

Do not validate:

- required answer domains;
- old role taxonomies;
- section counts;
- body character counts;
- citation counts as a quality proxy;
- line-precise citation density;
- curator-declared quality diagnostics;
- provider JSON page payload shape.

Keep safety and integrity checks:

- all agent writes stay inside the allowed draft wiki/report paths;
- `draft-wiki/index.md` exists;
- draft wiki contains markdown files;
- subject manifest paths are safe and correspond to placeholder files;
- `index.md` provides a navigable entrypoint to the generated docs;
- markdown links can be checked where practical;
- no generated file escapes the project/run/canonical wiki roots;
- subject reports list safe evidence paths;
- promotion is all-or-nothing;
- run artifacts are preserved;
- candidate dispositions are present when maintenance candidates were supplied;
- retrieval indexing derives from promoted markdown.

Optional review agents can critique quality in development experiments, but they are not part of the default create-mode product path and should not become a replacement for deterministic schema scoring.

## Integrations

This design keeps current lower-level capabilities where they still fit:

- JSON-only `invokeLlm` for read-only structured stages that remain outside agent-authored documentation;
- file-authoring provider invocation through the run-local workspace runner;
- project run directories and artifacts;
- runtime inbox intake into project memory candidates;
- source-consumption reconciliation after maintenance dispositions;
- retrieval indexing from canonical markdown sections;
- clean project reset for untrusted recreated docs.

It should replace or bypass:

- create-mode `ProjectMemoryCreationDraft`;
- create-mode `curator-output-contract.json`;
- answer-domain create validation;
- rendered-quality scoring;
- schema-shaped page rendering.

Maintenance may initially bypass structured maintenance proposals too, if direct draft-wiki writes plus a disposition report are sufficient.

## Permissions / Security

Agents should run with explicit write boundaries:

- create planner may write only under the run's draft wiki directory and its planning report file;
- subject writer agents may write only to their assigned draft wiki file and their subject report file;
- maintenance agent may write only under its draft wiki/overlay directory and report file;
- promotion code, not the agent, writes canonical wiki/state files;
- the target repo should be read-only from the agent's perspective except for allowed run outputs.

Provider-backed documentation runs may export repository context to the configured LLM provider. Live dogfood must be explicit about whether it used a real provider or a stub.

## Error Handling

Create mode should fail before promotion when:

- the planner agent exits non-zero;
- any required subject writer still fails after retry;
- no draft wiki is produced;
- `index.md` is missing;
- no markdown files are produced;
- any planned subject file remains an unchanged placeholder after retry;
- writes escape the allowed output boundary;
- required planner or subject report is malformed or absent;
- promotion cannot complete safely.

Maintenance mode should fail before promotion when:

- the agent exits non-zero;
- candidate dispositions are missing for supplied candidates;
- writes escape the allowed output boundary;
- the generated draft would delete the whole wiki accidentally;
- promotion cannot complete safely.

If create succeeds but maintenance fails on the first run, Myelin should distinguish candidate-specific/non-destructive maintenance failure from unsafe run failure. Candidate-specific failures should not normally block useful first documentation; unsafe write-boundary, corrupted draft, infrastructure, or ambiguous promotion failures should block canonical promotion.

## Testing Strategy

Tests should focus on orchestration and safety, not whether test fixtures look like good documentation.

Useful tests:

- create mode invokes the planner with a draft wiki path and no candidate packet;
- create planner writes `index.md` and placeholder subject files with no candidate packet;
- create planner writes a small subject manifest for writer-job orchestration;
- subject writers receive one assigned draft file and write detailed markdown for that subject;
- subject writers run with bounded parallelism;
- subject writers cannot edit another subject file;
- failed subject writers are retried before create fails;
- create fails before promotion when a required subject remains a placeholder after retry;
- create mode promotes a draft wiki tree atomically;
- create mode rejects missing `index.md`;
- create mode rejects output outside the draft wiki/report paths;
- first run invokes maintenance after successful create;
- maintenance receives pending candidates and existing wiki;
- maintenance dispositions drive candidate lifecycle;
- later runs skip create and run maintenance only;
- stubbed/test provider runs cannot be confused with live product-quality dogfood;
- retrieval indexing runs from promoted markdown.

Live dogfood acceptance should still be product-facing while the redesign is being built:

- run create + maintenance on `llm-wiki` with a live provider;
- inspect the resulting wiki as documentation;
- ask representative product questions from Project Memory query;
- accept only if a future agent could use the docs without rediscovering the repo.

This manual dogfood inspection is a development confidence check, not the normal product success path. In the intended product, successful live agent-authored documentation plus safety/promotion checks is enough for Project Memory to become curated.

## Planning Boundary Guidance

Split implementation into smaller plans:

1. Documentation draft-wiki run boundary.
   - Goal: create run dirs, draft wiki paths, write constraints, and artifact preservation.
   - Depends on current project run infrastructure.
   - Enables create and maintenance agents.
2. Agent-authored create mode.
   - Goal: invoke a planner/index agent and per-subject writer agents that write markdown directly.
   - Depends on draft-wiki run boundary.
   - Enables first-run documentation.
3. Draft wiki promotion.
   - Goal: promote draft markdown tree atomically to canonical wiki and state.
   - Depends on create output shape.
   - Enables retrieval indexing.
4. Candidate-guided maintenance mode.
   - Goal: invoke maintenance agent against existing docs and candidates, with disposition report.
   - Depends on draft wiki promotion and existing candidate intake.
   - Enables later Project Memory growth.
5. First-run create-plus-maintenance composition.
   - Goal: compose create followed by maintenance, then retrieval indexing.
   - Depends on create and maintenance modes.
6. Dogfood reset and live acceptance.
   - Goal: rerun `llm-wiki` with live provider and manually evaluate the generated docs.
   - Depends on the redesigned flow.

## Acceptance Criteria

- First `project learn <key>` creates a multi-page markdown documentation tree from a live agent-authored draft wiki.
- First run does not feed memory candidates into create mode.
- First run plans documentation subjects before invoking per-subject writer agents.
- First run retries failed subject writers before failing create.
- First run invokes maintenance after create and records dispositions for existing candidates.
- Later `project learn <key>` runs maintenance only.
- Content-shape validation no longer blocks create docs based on schema, role, answer-domain, body-char, or citation-count rules.
- Safety checks still prevent writes outside allowed paths and prevent partial promotion.
- Stubbed runs are clearly identified and cannot be mistaken for product-quality dogfood.
- Successful live create-plus-maintenance runs mark Project Memory curated automatically, with state recording the agent-curated provenance.
- If create output is promoted after candidate-specific/non-destructive maintenance failure, state records curated create documentation plus degraded or incomplete maintenance.
- The `llm-wiki` dogfood wiki is judged by manual/product usefulness and query answerability, not by schema-valid JSON.

## Assumptions

- Codex can write files inside a provided run output directory when invoked with the right sandbox/workdir permissions.
- Myelin can enforce promotion boundaries even if the agent writes freeform markdown.
- Direct markdown generation is more aligned with Project Memory's product goal than structured page payload generation.
- Candidate maintenance can be useful even when create mode already produced comprehensive docs, because it can mark candidates already covered and preserve lifecycle.

## Open Questions

See `agenda.md`.
