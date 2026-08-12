# Chunk 14: CLI, Debugging, And Honest Status

**Plan Set:** `../plan.md`
**Approved Source:** `../spec.md` — Operator Entry; Dedicated SMC Surface; Trigger Policy
**Status:** Approved for Execution
**Depends on:** Chunks 08, 11, 12, 13
**Enables:** Chunk 15

## Goal

Operators and automation can start, inspect, resume, grant, abandon, validate, and diagnose Session
maintenance through stable CLI/JSON contracts that distinguish freshness, audit coverage, indexing,
project ownership, and global embedding ownership.

## Source Artifacts And Constraints

- `myelin ingest <key>` remains the normal command. `myelin smc ...` is machine/debug service access,
  not the end-user query facade and not an agent mutation capability.
- Preserve documented `--evidence-chunk-size` vocabulary and deprecated `--batch-size`/
  `INGEST_BATCH_SIZE` aliases only at compatibility boundaries.
- Status/logs expose IDs, digests, counts, phases, reason codes, and compact errors—not raw evidence,
  memory payloads, prompts, or query text unless an explicitly scoped record-read command is used.
- Freshness and rolling-audit coverage are separate facts. Blocked/no-work cannot report progress.
- Audit coverage inspection uses the same typed `auditPartitionLimit` as scheduling; it does not
  substitute the affected-work-set ceiling for audit selection.
- Embedding/network rejection is `unreachable from current process`, never proof of sandbox denial.

## Relationships

- Exposes recovery, coordinator protocol services, finalization receipts, scheduler eligibility, and
  both fences without changing their behavior.
- Produces public contracts consumed by Chunk 15 dogfood and future detached/MCP consumers.

## File Responsibility Map

**Create:**
- `src/commands/smc.ts` — debug/machine subcommands over trusted services.
- `src/session-maintenance/status-service.ts` — anchor/fence/progress/coverage status projection.
- `src/session-maintenance/status-types.ts` — stable JSON schemas/reason codes.
- `tests/commands/smc.test.ts`
- `tests/session-maintenance/status-service.test.ts`

**Modify:**
- `src/commands/registry.ts` and `src/cli.ts` — register `smc` namespace.
- `src/commands/ingest.ts` — start/status/resume/abandon/grant outputs and compatibility flags.
- `src/commands/status.ts` and status inspectors/renderers — Session maintenance section.
- `src/ingest/status.ts` and `src/ingest/job-admin-service.ts` — delegate authoritative state/actions.
- `src/commands/memory.ts` — embedding lifecycle busy/recovery output consistency.
- `src/runtime/config.ts`, `docs/CLI.md`, and `AGENTS.md` — current config/command/sandbox contract,
  including the resolved forensic-retention key from Chunk 08.

**Test:**
- `tests/commands/ingest.test.ts`
- `tests/commands/status.test.ts`
- `tests/status/status-service.test.ts`
- `tests/status/status-renderer.test.ts`
- `tests/ingest/status.test.ts`

## Behavioral And Contract Changes

- `myelin ingest` returns `started`, `no_work`, or stable blocked outcomes with one anchor job ID and
  trigger/workload summary. It never describes internal batches as jobs.
- Recovery commands act on exact job/epoch: resume, explicit abandon, and additive budget grant.
  Stale owner or incompatible state returns an actionable reason without implicit release. Policy
  v3 makes earlier-policy anchors incompatible, so operators must abandon and restart them rather
  than resume across governing identities.
- `myelin smc` exposes manifest/progress, bounded batch/query/record/overlay/journal inspection,
  proposal validation, and exact-digest finalization for trusted operator debugging. Mutating
  commands require job capability/epoch/digest and call the same coordinator services.
- Status separately reports queued content/oldest age, current anchor phase/owner epoch, project and
  global fences, incremental freshness, due/covered audit revisions, indexing health, and typed
  provider reachability warnings. Its due-audit selector uses the configured per-anchor audit
  partition limit while still reporting the full due revision count.
- Status also reports permanent legacy deny and optional process-liveness diagnostics without
  presenting PID state or `legacy_compatibility` as authority/quiescence proof.
- Machine JSON uses versioned fields and stable reason codes; human text is a projection of those
  fields. Deprecated aliases remain accepted/reported as compatibility metadata only.

## Implementation Tasks

- [ ] Define versioned status/CLI result types and privacy projection. Map every recovery, retrieval,
      budget, fence, indexing, migration, and no-work outcome to a stable code.
- [ ] Implement `smc` debug commands over existing services with strict pagination and expected
      revision/epoch/digest arguments; do not add arbitrary SQL or canonical write bypasses.
- [ ] Adapt ingest/status/memory commands and renderers. Preserve installed hook ABI and existing
      command names; document source CLI use for pre-install dogfood and conditional host access.
- [ ] Add JSON/human contract tests for aliases, no raw evidence leakage, stale owner actions,
      project/global busy states, permanent-deny diagnostics, liveness-as-diagnostic-only,
      freshness-versus-audit distinction, and provider unavailability.

## Verification

- `bun test tests/commands/smc.test.ts tests/session-maintenance/status-service.test.ts tests/commands/ingest.test.ts tests/commands/status.test.ts tests/status/status-service.test.ts tests/status/status-renderer.test.ts tests/ingest/status.test.ts`
  — stable JSON, human projection, privacy, aliases, and honest state distinctions pass.
- `bun run typecheck` — exits 0.
- `git diff --check` — exits 0.
- `bun src/cli.ts smc --help` and `bun src/cli.ts ingest --help` — exit 0 and show current vocabulary.

## Acceptance Criteria Covered

- Dedicated SMC inspection/control surface is decoupled from consumer memory query.
- Operators can safely resume/abandon/grant and understand ownership/degradation.
- Status does not conflate incremental freshness, audit coverage, or indexing health.

## Risks, Rollback, And Isolation

- Debug surfaces can leak sensitive evidence; default listings remain metadata-only and explicit
  record reads are job-scoped and bounded.
- Compatibility aliases must not become internal schema/vocabulary owners.

## Non-Goals

- MCP implementation, Session inbox, install/runtime publication, or Project Memory status redesign.

## Consistency Check

- Verify every documented command/flag exists in parser tests and every machine reason code is typed.
- Verify status reads are DB/sidecar immutable and do not schedule work.
- Verify CLI mutations call trusted services rather than duplicating lifecycle SQL.

## Execution Notes

### 2026-08-12: Accepted Implementation

- Independent review accepted finite owned machine reason vocabularies and versioned privacy-safe
  envelopes across SMC, ingest, status, and embedding lifecycle commands. JSON mode remains JSON for
  malformed arguments and runtime/configuration failures; unknown errors map to stable internal codes.
- Operator mutations require exact project, job, epoch, digest, and receipt authority as applicable
  and delegate to trusted services. Only the five budgets that actually expand enforced ceilings can
  be granted.
- Status separates queued age/content, incremental freshness, audit coverage, indexing, project and
  global fences, provider unavailable versus unreachable state, permanent legacy denial, and
  diagnostic-only PID liveness without exposing raw evidence or internal payloads.
- Status and scheduler resolve the same separate audit-partition plan control; the root value is 10
  and is not derived from the affected-work-set budget.
- Primary ingest contracts use one anchor job and current evidence-work vocabulary; deprecated batch
  aliases remain only at compatibility parsing/projection boundaries.
- CLI recovery preserves the policy identity boundary: pre-v3 anchors surface as incompatible and
  require explicit evidence-preserving abandonment before a new v3 anchor starts.
- Final independent gates passed 53 focused tests, 149 broader affected tests, 26 embedding-command
  tests, TypeScript typecheck, `git diff --check`, and both CLI help commands.
