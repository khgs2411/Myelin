# CLI Reference

This is the canonical reference for Myelin CLI commands.

Operator examples use the installed `myelin` command. Contributors working in
the Myelin checkout can explicitly run the source entrypoint when needed:

```bash
bun src/cli.ts <command>
```

The source form is contributor guidance, not the public operator boundary.

The sections below document purpose, usage, options, output, and side effects. Commands that mutate SQLite, project files, provider hooks, or launch detached workers call that out explicitly.

## Live embedding network access

Live embedding operations require network access from the Myelin process. This
includes localhost socket access for Ollama and external HTTPS access for
Gemini. The boundary applies to provider checks in `myelin status`, query
embedding in `myelin memory query`, embedding indexing, and embedding
migrations.

When Codex invokes one of these commands, it must run the command with network
permission. A Myelin child process cannot elevate itself beyond the invoking
sandbox. If the current process cannot open the provider connection, Myelin
reports `provider_state: "unreachable"` and instructs the operator to verify both the
provider and the process's network permission; it does not claim that the
provider itself is down. Re-run with network permission before diagnosing a
provider outage.

Structured query failures use `degraded_code`; structured indexing and migration
failures use `failure_code`. The stable reachability value is
`embedding_provider_unreachable`. A reachability failure leaves embedding rows
pending without incrementing retries, and migration does not replace the active
contract or terminally fail a retryable staging contract.

Deterministic tests must inject a provider transport or set
`EMBEDDING_STUB_RESPONSES_DIR`; tests must not infer provider health from host
network access.

## status

### `myelin status [project-key] [--json]`

Shows project status for a specific project key, or resolves the project from the current working directory when no key is supplied.

Arguments:

- `project-key`: optional project key.

Options:

- `--json`: emit the structured `myelin.status.v1` response.

Output:

- Human-readable project summary by default.
- Human output places a deterministic Session continuity briefing immediately
  after the overall state and project identity, then reports installation
  health, Session Memory and Project Memory health, warnings, suggested actions,
  and evidence paths.
- JSON output has `contract_version: "myelin.status.v1"` and
  `kind: "project_operational_status"`.
- The current producer emits the additive `briefing` container with
  `contract_version: "myelin.status.briefing.v1"`. Its
  `session_continuity` member has
  `contract_version: "myelin.session_continuity.v1"`; readers of older status
  payloads must tolerate the whole `briefing` container being absent.
- Session continuity groups memories by their durable `ingest_jobs.id`. The
  newest eligible group is the `anchor_job`; this is unrelated to a worker's
  internal prompt or evidence chunks. Items identify their relationship as
  `anchor_job` or `prior_job`.
- The briefing exposes current state, completed outcomes, recent decisions,
  all eligible active blockers, and all eligible active next actions. Latest
  channels select the latest eligible ingest job for that memory kind.
- Eligibility is structural and fails closed: an active memory must point to an
  existing same-project ingest job and to nonempty, same-job, finalized output
  tombstones whose metadata and output backreferences are valid. At least one
  source must be content-bearing. Mixed control/content provenance remains
  eligible but reports `integrity.state: "degraded"`; control-only provenance is
  excluded. `integrity.state: "valid"` describes provenance integrity, not the
  semantic truth of a memory's content.
- Continuity state is `ready`, `lagging`, `degraded`, or `unavailable`, with
  precedence `unavailable` over `degraded` over `lagging` over `ready`.
  Freshness counts only queued content events; `session.start` does not make a
  briefing lagging.
- Retrieval sections report persisted active and configured desired embedding contracts, active-contract indexed/pending/failed counts, provider reachability/availability, migration state, and historical contract rows separately. `provider_state: "unreachable"` means the current process could not open the required connection; it is distinct from a provider configuration or response failure and does not replace the section's primary lifecycle. Historical rows do not make current health unhealthy.

Side effects:

- Read-only.
- Successfully observed `healthy`, `attention`, and `blocked` states exit `0`.
- Project-resolution, invocation, or inspection failures that prevent the
  contract from being built exit nonzero.

Examples:

```bash
myelin status wizepal
myelin status --json
```

## bootstrap

### `myelin bootstrap <project-key> --repo <absolute-path>`

Creates or updates the Myelin project shell for a software repository.

Arguments:

- `project-key`: stable Myelin project key.

Options:

- `--repo <absolute-path>`: absolute path to the repository being bootstrapped.

Output:

- Bootstrapped project key, repo path, created artifact count, and kept artifact count.

Side effects:

- Writes project state and memory shell under `projects/<project-key>/`.
- Rejects repo paths already registered to another project key.

Examples:

```bash
myelin bootstrap wizepal --repo /Users/liadgoren/Wizepal/droplet-bot
```

## schema

### `myelin schema check <project-key>`

Validates the generated schema context for a project.

Arguments:

- `project-key`: project to validate.

Options:

- None.

Output:

- Success message, or validation errors.

Side effects:

- Read-only.

### `myelin schema build <project-key> [--dry-run]`

Builds generated schema context for a project.

Arguments:

- `project-key`: project to build.

Options:

- `--dry-run`: print generated context JSON without writing it.

Output:

- Write/current message by default.
- Generated context JSON with `--dry-run`.

Side effects:

- Writes `state/<project-key>/schema-context.json` unless `--dry-run` is used.

Examples:

```bash
myelin schema check class-kit
myelin schema build class-kit
myelin schema build class-kit --dry-run
```

## project

### `myelin project learn <project-key> [--dry-run] [--review] [--recreate] [--resume <run>] [--provider codex|claude] [--model <model>] [--json]`

Runs the broad project-memory learning pipeline.

Arguments:

- `project-key`: project to learn.

Options:

- `--dry-run`: preview without committing writes.
- `--review`: run in review-oriented mode.
- `--recreate`: rebuild already-curated Project Memory from a fresh create stage.
- `--resume <run>`: resume maintenance from a verified, unpromoted create checkpoint. Accepts the run ID or exact `runs/<key>/project-learn/<run>` path and cannot be combined with `--dry-run`, `--review`, or `--recreate`.
- `--provider codex|claude`: provider override.
- `--model <model>`: model override.
- `--json`: emit structured result JSON.

Output:

- Human-readable run summary by default.
- Structured run result with `--json`.
- Human mode writes stage progress and periodic active-stage heartbeats to stderr. Interactive terminals use one updating spinner line; redirected logs use stable stage lines. Counts are shown only when the runtime knows the real total.
- A subject writer that reports provider capacity exhaustion is retried in place up to three times with 15, 45, and 90 second backoffs. Completed sibling subjects are retained, retry countdowns and attempts are shown in human progress, and failed-attempt metadata remains under the subject workspace.
- Create and recreate runs finalize `index.md` after subject authoring, require links to every planned subject, and reject planner lifecycle language before canonical publication. Repository identity is published as `state/<key>/repository-identity.json`; run-local identity links are rewritten to that canonical state path.
- `--json` keeps stdout as one valid JSON result and suppresses human progress output.
- Foreground and automatic Project Memory mutations are serialized per project through the full authoring, promotion, reconciliation, and retrieval lifecycle. A competing command fails with the active mutation ID; a lock whose recorded process is dead is recovered before a new run starts.
- Status `completed_with_pending_index` means canonical Project Memory writes succeeded, but derived retrieval hints or indexing still need follow-up.
- A failure after a verified create checkpoint reports `resumable`, the checkpoint-bearing run, and the exact `myelin project learn <key> --resume <run>` command.

Side effects:

- May invoke provider CLIs.
- Runs deterministic runtime inbox intake before packet construction, creating or reusing Project Memory candidates for valid `sources/<project-key>/inbox/*.json` source proposals.
- Writes `prompt-budget.json` before curator invocation. Codex-backed curator prompts reference run artifacts instead of inlining the full packet; bounded inline prompt fallback can reduce supporting packet context when needed.
- May write run artifacts under `runs/<project-key>/`.
- Create and recreate publication may update canonical repository identity state under `state/<project-key>/repository-identity.json`.
- First-create runs preserve sanitized repository identity, an immutable create checkpoint, maintenance-report schema, and canonical-publication validation artifacts. Target-repository snapshots remain temporary and are removed after each authoring invocation.
- May update project memory outputs unless `--dry-run` stops writes.

### No Active `myelin project ingest`

`myelin project ingest <project-key>` is not part of the active CLI surface.
Project Memory runtime-inbox intake runs inside `myelin project learn <project-key>`
before packet construction. Top-level `myelin ingest <project-key>` is separate:
it processes Experience Log rows into Session Memory and downstream handoff inputs.

### `myelin project migrate-layout <project-key>`

Migrates legacy project layout into the current project directory structure.

Arguments:

- `project-key`: project to migrate.

Options:

- None.

Side effects:

- Moves or creates project layout files/directories as needed.

Examples:

```bash
myelin project learn class-kit --dry-run
myelin project learn class-kit --resume projects/class-kit/runs/project-learn/2026-07-15T08-00-00.000Z-run
myelin ingest class-kit
myelin project migrate-layout class-kit
```

## ingest

Top-level `ingest` is the Experience Log to Session Memory pipeline.

### `myelin ingest <project-key> [--limit N] [--evidence-chunk-size N] [--provider codex|claude] [--json]`

Starts one detached, provider-backed Session Memory Curator (SMC) anchor job. Myelin freezes the
selected evidence, active-memory retrieval snapshot, governing identities, and work budgets under
one durable `ingest_job_id`; bounded curator turns then stage proposals before one trusted atomic
promotion. Repo/branch/commit evidence fields constrain retrieval candidates; they do not seed
additional hits, and affected work-set members do not recursively expand recall.

Arguments:

- `project-key`: project whose Experience Log rows should be drained.

Options:

- `--limit N`: maximum Experience Log rows to select.
- `--evidence-chunk-size N`: rows claimed per internal evidence-selection chunk. Must be `1..500`; it does not create additional ingest jobs.
- `--batch-size N`: compatibility alias for `--evidence-chunk-size`.
- `--provider codex|claude`: provider override.
- `--json`: emit `myelin.ingest.start.v1` with `started`, `no_work`, or a stable blocked outcome,
  plus trigger/workload and compatibility metadata.

Session Memory curator plan configuration is all-or-nothing. `SMC_AUDIT_PARTITION_LIMIT` is a
required positive integer alongside the evidence and workflow controls; this repository sets it to
`10`. It caps the due audit revisions selected into each anchor independently of
`SMC_MAX_AFFECTED_WORK_SET_SIZE`, which remains the grantable ceiling for retrieval-derived affected
work. The scheduler and status audit selector both use the audit-partition limit; it is not an
additive grant budget.

Preparation also proves the frozen turn floor before creating anchor state:
`min_turns = evidence text formulations + one proposal per work batch + one exact fetch per frozen
audit member`. The root sets `SMC_MAX_TURNS=20`. For the current acceptance case, seven evidence
formulations plus two batch proposals plus ten audit fetches require 19 turns, so the frozen plan is
admissible with one turn above its minimum. This is a feasibility floor, not a promise that retries
or rejected actions will fit; later exhaustion still requires an explicit `max_turns` grant.

Output:

- One durable anchor job id, queued valid-content count, selected row count, evidence chunk size,
  trigger reason, audit workload count, and any terminal replay rows reconciled before selection.
- `smc_workflow_budget_infeasible` is returned before any anchor state when frozen controls cannot
  satisfy the selected job's minimum work. JSON includes exact configured, required, and deficit
  details.
- Warns when the registered target repo is on a non-`master` branch; this is warning-only.

Side effects:

- Creates at most one anchor job and one complete immutable manifest for the invocation. Internal
  evidence chunks, work batches, curator turns, and retrieval pages are not jobs.
- Runs pending derived Session Memory indexing before creating a curator anchor. Incomplete or
  unavailable retrieval blocks before manifest acceptance.
- Preserves selected raw evidence while the anchor is active and copies the complete job-owned
  evidence and memory retrieval state needed for deterministic resume.
- Launches one detached coordinator worker in the registered target repository. Codex receives
  read-only repository access; agent shell access is not the Myelin mutation boundary.
- Coordinator-owned exact/link/overlay retrieval and cursor continuation run without provider
  turns. Provider turns are `text_formulation` for one trusted evidence obligation,
  `audit_fetch` for exactly one coordinator-selected unfetched audit member, or `proposal_ready`
  only after fixed-plan coverage and all required audit-fetch receipts are complete. An
  `audit_fetch` envelope exposes only the next `required_action` descriptor—batch, memory, expected
  revision, and maximum bytes—and the provider must return that exact fetch. Remaining-turn reserve
  never auto-grants; operators must use the explicit grant command.
- Stages curator proposals in a revisioned noncanonical overlay. The curator cannot write canonical
  Session Memory or terminalize evidence directly.
- Applies the accepted projection, lifecycle changes, source tombstones, audit receipts, and anchor
  completion in one trusted atomic finalization.
- Manual ingest starts evidence-plus-audit work when content exists, audit-only work when only audit
  coverage is due, and returns `no_work` only when neither workload exists. Each anchor selects at
  most the configured audit-partition limit even when more revisions remain due.
- `session.start` is a control signal used to request a below-threshold drain; new control signals are not persisted as Experience Log content. Thresholds count valid content only.

Examples:

```bash
myelin ingest wizepal
myelin ingest class-kit --limit 50 --evidence-chunk-size 25 --json
```

### `myelin ingest status <ingest-job-id> [--json]`

Shows one ingest job.

Arguments:

- `ingest-job-id`: job id to inspect.

Options:

- `--json`: emit `myelin.ingest.status.v1`, including a privacy-projected compatibility job and
  authoritative anchor companion metadata when present. Raw input, follow-up, and error JSON are
  omitted.

Side effects:

- Read-only for SMC anchors. Process liveness is diagnostic and never changes anchor ownership.
- Legacy non-anchor jobs may still use the compatibility stale-worker refresh until authoritative
  cutover removes that owner.

### `myelin ingest status --project <project-key> [--json]`

Shows project-level ingest completion status.

Options:

- `--project <project-key>`: project to inspect.
- `--json`: emit `myelin.ingest.status.v1` with project status.

Side effects:

- Read-only for SMC anchor state. Legacy non-anchor compatibility jobs may still be refreshed.

Examples:

```bash
myelin ingest status ingest_2026-06-17T16-18-48.233Z_110a77 --json
myelin ingest status --project wizepal --json
```

### `myelin ingest jobs <project-key> [--status starting|running|needs_followup|completed|failed] [--limit N] [--json]`

Lists ingest jobs for investigation.

Arguments:

- `project-key`: project whose jobs should be listed.

Options:

- `--status <status>`: optional job status filter.
- `--limit N`: maximum rows to return. Default `50`.
- `--json`: emit `myelin.ingest.jobs.v1` with privacy-projected job, anchor, reason-code, and
  permanent-deny metadata. Raw input, follow-up, and error JSON are omitted.

Side effects:

- Read-only.

Examples:

```bash
myelin ingest jobs class-kit --status failed --json
myelin ingest jobs class-kit --status failed --limit 10
```

### `myelin ingest jobs resolve <project-key> (--id <job-id> | --all) --reason <text> [--code <error-code>] [--dry-run] [--json]`

Marks failed ingest jobs as resolved when the operator has determined they are environmental or otherwise non-actionable failures.

Arguments:

- `project-key`: project whose failed jobs should be resolved.

Options:

- `--id <job-id>`: resolve a specific failed job. May be repeated.
- `--all`: target all failed jobs for the project.
- `--reason <text>`: required explanation.
- `--code <error-code>`: optional filter against `error_json.code`.
- `--dry-run`: show matched jobs without updating them.
- `--json`: emit `myelin.ingest.jobs-resolution.v1` with privacy-projected resolved jobs.

Output:

- Count of jobs that would be or were resolved.

Side effects:

- Without `--dry-run`, updates matched failed jobs to `completed`.
- Clears `error_json`.
- Stores previous error and resolution metadata under `followup_state_json.resolved_failed_job`.

Examples:

```bash
myelin ingest jobs resolve class-kit --all --reason "environment cleanup" --dry-run --json
myelin ingest jobs resolve class-kit --all --code detached_worker_exited --reason "environment cleanup"
myelin ingest jobs resolve class-kit --id ingest_2026-06-17T15-58-53.443Z_afb829 --reason "obsolete branch policy failure"
```

### Session Memory recovery commands

```bash
myelin ingest resume <project-key> <job-id> --owner-epoch N [--attempt-id ID] [--provider codex|claude] [--json]
myelin ingest abandon <project-key> <job-id> --owner-epoch N --receipt-id ID --request-id ID --operator-id ID --reason TEXT [--json]
myelin ingest grant <project-key> <job-id> --owner-epoch N --manifest-digest sha256:... --grant-id ID --budget max_turns|max_queries|max_cumulative_returned_result_bytes|max_provider_envelope_bytes|max_affected_work_set_size --amount N --operator-id ID --reason TEXT [--json]
```

- `resume` validates the exact manifest, frozen evidence/snapshot, overlay, journal, provider, epoch,
  and governing identities before appending a higher-epoch attempt.
- Session maintenance policy v3 governs the `audit_fetch` phase. An anchor frozen under an earlier
  policy identity is incompatible: it must be explicitly abandoned and restarted from its preserved
  raw evidence, not resumed or silently rebased.
- `abandon` is explicit and idempotent. It writes a terminal receipt, releases the project fence,
  preserves raw evidence for a later anchor, and never revives a permanently denied legacy owner.
- `grant` records an additive, manifest/epoch-bound workflow budget grant. It does not change the
  frozen evidence or memory view.
- Stale epochs and incompatible state fail with stable reason codes; no command implicitly releases
  or transfers ownership.

### `myelin ingest worker <ingest-job-id>`

Runs the worker runtime for an existing job. This is primarily called by detached ingest workers.

Arguments:

- `ingest-job-id`: job id with stored worker input.

Side effects:

- For a prepared SMC anchor, runs the provider-neutral coordinator over the immutable manifest and
  revisioned overlay, then invokes the trusted atomic finalizer for an accepted projection.
- Refuses every worker invocation without an SMC anchor; no legacy one-shot execution fallback remains.

## smc

`myelin smc` is a machine/debug service surface over the same trusted coordinator services. It is
not the day-to-day memory query facade and does not give the curator arbitrary SQL or canonical
write access.

```bash
myelin smc status <project-key> [--json]
myelin smc manifest <job-id> [--json]
myelin smc progress <job-id> [--json]
myelin smc batches <job-id> [--cursor N] [--limit N] [--json]
myelin smc overlay <job-id> [--revision N] [--cursor N] [--limit N] [--json]
myelin smc journal <job-id> [--attempt-id ID] [--cursor N] [--limit N] [--json]
myelin smc query --request-json <json> [--json]
myelin smc record --request-json <json> [--json]
myelin smc proposal validate --request-json <json> [--json]
myelin smc finalize <job-id> --owner-epoch N --accepted-projection-digest sha256:... [--json]
myelin smc resume <project-key> <job-id> --owner-epoch N [--attempt-id ID] [--provider codex|claude] [--json]
myelin smc abandon <project-key> <job-id> --owner-epoch N --receipt-id ID --request-id ID --operator-id ID --reason TEXT [--json]
myelin smc grant <project-key> <job-id> --owner-epoch N --manifest-digest sha256:... --grant-id ID --budget max_turns|max_queries|max_cumulative_returned_result_bytes|max_provider_envelope_bytes|max_affected_work_set_size --amount N --operator-id ID --reason TEXT [--json]
myelin smc cleanup <project-key> <job-id> --owner-epoch N --terminal-receipt-digest sha256:... [--json]
```

All JSON results use `myelin.smc.cli.v1`. Default manifest, progress, batch, overlay, and journal
inspection exposes IDs, digests, counts, phases, and compact diagnostics only. Raw evidence, memory
payloads, prompts, and query text are omitted. `record` is the explicit bounded, job-scoped record
read. Listings use the manifest's frozen page limit and stable cursors.

Mutating commands require the current job capability fields: project/job identity, owner epoch, and
the applicable manifest, overlay, or accepted-projection digest. They call coordinator/finalizer
services rather than duplicating lifecycle SQL.

Budget grants are additive only for enforced ceilings: `max_turns`, `max_queries`,
`max_cumulative_returned_result_bytes`, `max_provider_envelope_bytes`, and
`max_affected_work_set_size`. Page-size and semantic-selection controls remain frozen and cannot be
granted. The cumulative/provider-envelope byte ceilings apply to provider-visible record fetches and
work envelopes; coordinator-owned retrieval pages remain durable internal receipts and charge zero
provider-result bytes.

The provider-facing SMC protocol does not expose obligation arrays, selectors, page limits, or
cursors. `myelin smc query` remains a trusted low-level operator/debug wrapper over the internal
query request; it is not the provider action contract.

During `audit_fetch`, returning `insufficient_evidence` merely because the admitted audit target has
not yet been fetched is invalid and receives a journaled action-validation result. The coordinator
accepts only the exact required fetch (or a genuine typed transport/system blocker), persists one
exact fetch receipt, and then emits the next required audit action. Proposal submission remains
unavailable until every frozen audit member has that receipt.

`smc status` separates incremental freshness, rolling audit coverage, indexing health, project
mutation ownership, and scope-global embedding ownership. PID/liveness and permanent legacy-deny
state are diagnostics; neither grants authority. `provider_state: "unreachable"` means unreachable
from the current Myelin process and must be verified with appropriate host network permission.

Forensic cleanup is disabled unless `SESSION_MAINTENANCE_FORENSIC_RETENTION_MS` is configured. Even
then, cleanup requires a valid completion or abandonment receipt and elapsed retention period.

## memory

### `myelin memory inbox create <project-key> --layer project --body <text> --title <title> --rationale <text> --confidence low|medium|high --risk low|medium|high [--evidence-ref <ref>] [--target-hint <hint>] [--json]`

Creates an explicit runtime durable-memory inbox source proposal for Project Memory.

Arguments:

- `project-key`: project that owns the proposal.

Options:

- `--layer project`: required. Practice and Personal layers are not accepted until their consumers exist.
- `--body <text>`: required source/proposal text.
- `--title <title>`: required short summary.
- `--rationale <text>`: required explanation for why this should become durable memory.
- `--confidence low|medium|high`: required proposal confidence signal.
- `--risk low|medium|high`: required proposal risk signal.
- `--evidence-ref <ref>`: optional repeatable source reference.
- `--target-hint <hint>`: optional curator routing hint.
- `--json`: emit the structured creation result.

Output:

- Human-readable created item id, source ref, path, confidence, and risk by default.
- Structured creation result with `--json`.

Side effects:

- Writes immutable preserved source JSON under `sources/<project-key>/inbox/<id>.json`.
- Creates `sources/<project-key>/inbox/` when needed.
- Does not create memory candidate rows. Use `myelin memory inbox intake <project-key>` or `myelin project learn <project-key>` after this command.

### `myelin memory inbox intake <project-key> [--json]`

Deterministically normalizes valid Project runtime inbox source records into Project Memory candidates without invoking a provider.

Arguments:

- `project-key`: project whose runtime inbox source records should be normalized.

Options:

- `--json`: emit the structured intake summary.

Output:

- Human-readable counts for created, existing, terminal duplicate, skipped, unsupported, and invalid source records by default.
- Structured intake summary with `--json`.

Side effects:

- Creates or reuses `memory_candidates` rows for valid `sources/<project-key>/inbox/*.json` files.
- Creates only `scope="project"`, `candidate_type="project.inbox"`, `status="needs_review"` candidates in this slice.
- Does not invoke the Project Memory Curator.
- Does not rewrite runtime inbox source files.

### `myelin memory review <project-key> [--status <status>] [--limit N] [--json]`

Reports memory-related outcomes that are terminal or near-terminal but not ordinary success or failure.

This command is for operator review, not mutation. It gathers:

- Project Memory maintenance dispositions such as `insufficient_evidence`, `not_durable`, `belongs_to_other_layer`, and `deferred_unsafe_change`.
- Degraded Project Memory maintenance reports.
- `ingest_jobs` rows with `needs_followup`.
- Experience Log tombstones finalized as `no_output`.
- Rejected memory candidates and rejected layer handoff instructions.

Arguments:

- `project-key`: project to inspect.

Options:

- `--status <status>`: filter by outcome status, such as `insufficient_evidence`, `not_durable`, `belongs_to_other_layer`, `deferred_unsafe_change`, `needs_followup`, `no_output`, `rejected`, or `degraded`.
- `--limit N`: maximum returned rows. Default `100`.
- `--json`: emit structured report JSON.

Output:

- Human-readable review list by default.
- Structured JSON with `reviewable_count`, `returned_count`, and `items` with artifact paths or SQLite table names.

Side effects:

- Read-only.
- Does not resolve jobs, reopen candidates, alter source-consumption state, or run research.

Examples:

```bash
myelin memory review class-kit --status insufficient_evidence --json
myelin memory review class-kit --status no_output --limit 25
```

### `myelin memory maintain project <project-key> [--dry-run] [--review] [--promote <run>] [--provider codex|claude] [--model <model>] [--json]`

Maintains already-curated Project Memory from runtime inbox items and pending Project Memory candidates.

This is the post-bootstrap Project Memory maintenance pipeline:

1. Deterministically normalize runtime inbox source JSON into Project Memory candidates.
2. Invoke the maintenance agent over pending Project Memory candidates and existing wiki docs.
3. Publish canonical markdown updates and refresh derived Project Memory retrieval indexes.

For an operator-reviewed update, first run with `--review`, inspect the run-local draft, and then pass that run to `--promote`. Promotion does not invoke the authoring agent again. It cryptographically verifies the reviewed draft and report, canonical Project Memory baseline, target repository snapshot, and reviewed pending sources before publishing those exact reviewed markdown bytes through a separate journaled apply run.

Arguments:

- `project-key`: project whose already-curated Project Memory should be maintained.

Options:

- `--dry-run`: run without publishing canonical writes.
- `--review`: author a review checkpoint and stop before publishing canonical writes.
- `--promote <run>`: publish an exact validated maintenance review. Accepts the run ID or exact `runs/<key>/project-learn/<run>` path and cannot be combined with `--dry-run` or `--review`.
- `--provider codex|claude`: provider override.
- `--model <model>`: model override.
- `--json`: emit structured run result JSON.

Output:

- Human-readable maintenance run summary by default.
- Structured curator run result with `--json`.

Side effects:

- Fails without bootstrapping if Project Memory is not already curated. Use `myelin project learn <project-key>` for first-time create mode.
- May invoke provider CLIs.
- `--promote` does not invoke maintenance authoring; optional post-apply retrieval hint generation may still use the selected provider.
- May update canonical Project Memory markdown and source-consumption state.
- Marks terminal Project Memory candidates as processed through source-consumption reconciliation.
- Refreshes Project Memory retrieval sections, hints, vector index, and FTS index after published markdown changes.

Examples:

```bash
myelin memory maintain project llm-wiki --review
myelin memory maintain project llm-wiki --promote runs/llm-wiki/project-learn/2026-07-19T10-00-00.000Z-run
```

Automation:

- When `AUTO_PROJECT_MEMORY_MAINTENANCE=1`, runtime inbox writes and Session Memory ingest-created project candidates schedule this maintenance pipeline in a detached worker after `AUTO_PROJECT_MEMORY_MIN_PENDING_ITEMS` un-intaked inbox items or pending project candidates exist.
- Deterministic inbox intake inside this command does not schedule another auto-maintenance run.

### `myelin memory query <project-key> <question> [--limit N] [--layer session|project] [--branch current|<branch>] [--json] [--debug]`

Queries indexed Session Memory vectors and returns deterministic matches.

Arguments:

- `project-key`: project to query.
- `question`: natural-language query.

Options:

- `--limit N`: number of matches. Default `5`.
- `--layer session|project`: query indexed Session Memory (the default) or
  canonical Project Memory through its derived retrieval index.
- `--branch current|<branch>`: filter matches by captured branch context. `current` resolves the registered repo branch.
- `--json`: emit structured query response.
- `--debug`: include diagnostic route/layer information.

Output:

- Human-readable list of matched Session Memory rows by default.
- JSON response with matches, citations, confidence, degraded reason, and source tools with `--json`. Confidence is a deterministic retrieval-evidence score, not a probability derived from raw embedding distance.

Side effects:

- May create or update cached query embeddings.
- Does not call an answer-synthesis LLM.

Examples:

```bash
myelin memory query wizepal "What did we decide about sqlite-vec?"
myelin memory query wizepal "What did we last work on in this branch?" --branch current --json
```

### `myelin memory index session <project-key> [--limit N] [--batch-size N] [--retry-failed] [--json]`

Indexes pending Session Memory embeddings for retrieval.

Arguments:

- `project-key`: project whose Session Memory rows should be indexed.

Options:

- `--limit N`: maximum rows to select. Default embedding batch size.
- `--batch-size N`: provider batch size. Must be `1..500`.
- `--retry-failed`: include failed embedding rows.
- `--json`: emit structured index result.

Side effects:

- Calls embedding provider unless a stub provider is configured.
- Writes `session_memory_embeddings` status and vector table rows.
- Uses only the persisted active Session Memory embedding contract and its owned vector table.

Examples:

```bash
myelin memory index session wizepal
myelin memory index session class-kit --retry-failed --json
```

### `myelin memory embeddings migrate [--apply] [--json]`

Previews or applies a controlled embedding-contract migration for Session and Project Memory.

Options:

- `--apply`: build versioned staging indexes and atomically activate them after complete metadata/vector coverage and a vector-query smoke check.
- `--json`: emit the per-scope migration result.

Without `--apply`, this command is read-only. A failed apply leaves the previous active contract queryable and records the staging contract as failed.

### `myelin memory embeddings rollback [--apply] [--json]`

Previews or atomically swaps each scope's active and previous healthy embedding contracts. Without `--apply`, no lifecycle state changes.

### `myelin memory embeddings prune [--apply] [--json]`

Previews or removes retired and failed derived embedding state. Active and previous contracts are always protected. Apply removes owned historical metadata, query-cache entries, and vector rows or tables; it does not delete canonical Session Memory or Project Memory markdown.

### `myelin memory session list <project-key> [--status active|superseded|retracted] [--limit N] [--json]`

Lists Session Memory rows for operator inspection.

Arguments:

- `project-key`: project to inspect.

Options:

- `--status active|superseded|retracted`: optional lifecycle status filter.
- `--limit N`: maximum rows. Default `50`.
- `--json`: emit `{ "memories": [...] }`.

Side effects:

- Read-only.

### `myelin memory session show <memory-id> [--json]`

Shows one Session Memory row, including lifecycle metadata and captured contexts.

Arguments:

- `memory-id`: Session Memory id.

Options:

- `--json`: emit structured memory details.

Side effects:

- Read-only.

### `myelin memory session links <project-key> [--memory <memory-id>] [--limit N] [--json]`

Lists Session Memory lifecycle/reconciliation links.

Arguments:

- `project-key`: project to inspect.

Options:

- `--memory <memory-id>`: restrict to links where the memory is source or target.
- `--limit N`: maximum links. Default `100`.
- `--json`: emit `{ "links": [...] }`.

Side effects:

- Read-only.

### `myelin memory session repair <project-key> [--apply] [--json]`

Previews or applies the active Session Memory repair policy for one project. Repair policies are versioned so layer-specific state corrections remain explicit and can be introduced gradually.

The current `session-control-events-v1` policy retracts active Session Memory whose complete provenance consists of control-plane `session.start` events. Mixed control/content provenance is outside this policy and is never retracted automatically.

Arguments:

- `project-key`: project whose active Session Memory should be inspected.

Options:

- `--apply`: apply compare-and-set retractions and write a durable repair report. Without this option, the command is read-only.
- `--json`: emit the policy, proposed dispositions, source-reference hashes, counts, and report path as structured JSON.

Side effects with `--apply`:

- Transitions qualifying rows from `active` to `retracted` with a stable lifecycle reason.
- Preserves original Session Memory, source tombstones, tombstone terminal outcomes, contexts, and provenance.
- Writes a prepared/completed journal under `runs/<project-key>/memory-session-repair/<run-id>/report.json`.
- Is idempotent: a repeated preview after a successful apply proposes no already-applied retractions.

Examples:

```bash
myelin memory session list class-kit --status active --json
myelin memory session show mem_sqlite_knowledge_domain
myelin memory session links class-kit --memory mem_old --json
myelin memory session repair llm-wiki --json
myelin memory session repair llm-wiki --apply --json
```

### `myelin memory candidates <project-key> [--status pending|needs-review|processed|rejected] [--scope session|project|practice|personal] [--json]`

Lists memory candidates.

Arguments:

- `project-key`: project to inspect.

Options:

- `--status <status>`: optional candidate status filter. Hyphenated aliases like `needs-review` are normalized.
- `--scope session|project|practice|personal`: optional scope filter.
- `--json`: emit `{ "candidates": [...] }`.

Side effects:

- Read-only.

### `myelin memory candidate show <candidate-id> [--json]`

Shows one memory candidate.

Arguments:

- `candidate-id`: candidate id.

Options:

- `--json`: emit structured candidate details.

Side effects:

- Read-only.

## session

Manual sessions are a lightweight operator log separate from hook-captured Experience Log ingestion. Hook capture is the default path for provider sessions.

### `myelin session start <project-key> [--title "..."] [--json]`

Starts a manual session.

Side effects:

- Writes a row to `sessions`.

### `myelin session log <project-key> <message> [--kind note|decision|finding|followup] [--session <id>] [--json]`

Logs a manual event to an open session.

Side effects:

- Writes a row to `session_events`.

### `myelin session close <project-key> [--summary "..."] [--session <id>] [--json]`

Closes a manual session.

Side effects:

- Updates the selected `sessions` row.

### `myelin session recent <project-key> [--limit N] [--json]`

Lists recent manual sessions.

Side effects:

- Read-only.

### `myelin session show <session-id> [--json]`

Shows one manual session and its events.

Side effects:

- Read-only.

## install

The repo-root `./install` script delegates to this command using that checkout
as the durable data root and runtime snapshot source. Installation is
preview-first and manages immutable runtime versions, a copied stable launcher,
and its ownership locator; it does not install a symlink.

### `myelin install [--provider codex] [--command-only] [--rebind] [--rollback] [--prune] [--bin-dir <absolute-path>] [--apply]`

Previews or applies the machine command lifecycle and selected provider
integration.

Options:

- `--provider codex`: explicitly install or repair Codex integration. The option
  is repeatable and duplicate selections converge to one provider.
- `--command-only`: install or repair only the copied launcher and locator.
  This cannot be combined with `--provider`.
- `--rebind`: explicitly approve binding an existing installation to the
  current checkout after its recorded root changes. Applying a rebind without
  this option is refused.
- `--bin-dir <absolute-path>`: use a custom launcher directory instead of
  `~/.local/bin`. The path must be absolute. An existing locator will not
  silently change its recorded launcher target.
- `--apply`: write changes. Without this, the command previews.
- `--rollback`: swap the active and previous immutable versions. It can only be
  combined with `--apply`.
- `--prune`: after successful activation verification, remove every inactive
  manifest-owned version instead of retaining one rollback version.

Provider selection:

- With no provider option, one detected supported provider is selected.
- With no detected supported provider, Myelin installs the command only and
  reports a warning.
- If several supported providers are detected, installation requires explicit
  `--provider` selection.

Examples:

```bash
./install
./install --apply
./install --provider codex
./install --provider codex --apply
./install --command-only --apply
./install --bin-dir /absolute/bin --apply
./install --rebind --apply
myelin install --rollback
myelin install --rollback --apply
./install --prune --apply
```

Side effects:

- Preview mode is read-only.
- Apply mode stages and atomically promotes a content-addressed runtime under
  `~/.local/share/myelin/versions/`, writes the copied launcher,
  `~/.myelin/install.json`, a temporary recoverable journal, and selected
  Myelin-owned provider files.
- Reapply repairs missing owned artifacts and activates changed runtime content.
- Activation is smoke-tested through the stable launcher. Failure restores the
  previous locator. Successful upgrades retain one rollback version by default.
- Changed or unowned launcher/provider/version artifacts are refused instead of being
  overwritten.
- Existing recorded providers are preserved when a command-only or differently
  selected repair runs.
- Shell profiles are never edited. When the bin directory is absent from PATH,
  the exact warning is `<absolute-bin-dir> is not on PATH. Add it to your shell PATH before invoking myelin globally.`

### `myelin uninstall [--provider codex] [--apply]`

Previews or applies conservative removal of recorded Myelin-owned artifacts.
Full uninstall also removes manifest-owned runtime versions but never removes
the durable checkout, project memory, SQLite state, configuration, or unknown
directories in the version store.

Options:

- `--provider codex`: remove only the recorded Codex integration and retain the
  copied launcher, locator, and other recorded providers.
- `--apply`: perform the previewed removal.

Examples:

```bash
myelin uninstall --provider codex
myelin uninstall --provider codex --apply
myelin uninstall
myelin uninstall --apply
```

Side effects:

- Preview mode is read-only.
- Provider-only apply removes only verified, recorded Myelin-owned provider
  artifacts and updates the locator.
- Full apply removes recorded providers first, then the verified copied launcher
  and locator.
- Checkout files, `myelin.config`, `.env`, project memory/state, run/log data,
  and unrelated provider hooks are preserved.
- Hash or ownership mismatches fail closed instead of deleting modified or
  unowned files.

## capture

### `myelin capture codex-hook`

Reads a Codex hook payload from stdin and records an Experience Log event.

Side effects:

- Writes to `experience_events` or hook-error fallback logs.
- Fails open: malformed payloads or capture failures do not interrupt provider sessions.
- No-ops when `MYELIN_CAPTURE_DISABLED=1`.

This command is normally invoked by installed hooks, not by operators directly.
