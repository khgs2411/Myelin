import type { Database } from "bun:sqlite";
import { randomUUID } from "node:crypto";
import type { Cli, CommandResult } from "./registry.ts";
import { fail, ok } from "./registry.ts";
import { IngestJobAdminService, type IngestJobAdminServiceDeps } from "../ingest/job-admin-service.ts";
import { openMemoryDb } from "../memory/db.ts";
import { EmbeddingProviderFactory } from "../memory/embedding-provider-factory.ts";
import { createCompatiblePurposeEmbeddingTransport } from "../memory/embedding-service.ts";
import { listSessionMemoryAnchorAttempts } from "../session-maintenance/job-lifecycle.ts";
import { readSMCManifest } from "../session-maintenance/manifest.ts";
import { SMC_ADDITIVE_WORKFLOW_BUDGET_KEYS } from "../session-maintenance/manifest.ts";
import { reconstructSMCOverlay } from "../session-maintenance/overlay-store.ts";
import { readSMCActionJournal } from "../session-maintenance/action-journal.ts";
import { readLatestCuratorBatchChannelPlan } from "../session-maintenance/curator-channel-plan.ts";
import { queryCuratorMemory } from "../session-maintenance/curator-retrieval-service.ts";
import type { CuratorQueryRequest } from "../session-maintenance/curator-retrieval-types.ts";
import { fetchCuratorRecord, type CuratorRecordRequest } from "../session-maintenance/curator-record-service.ts";
import { inspectSMCBatchProposal } from "../session-maintenance/proposal-validator.ts";
import {
  finalizeSessionMaintenance,
  SessionMaintenanceFinalizationError,
} from "../session-maintenance/finalization-service.ts";
import { recordSMCBudgetGrant } from "../session-maintenance/coverage-receipts.ts";
import { StatusService, type StatusServiceDeps } from "../status/status-service.ts";
import { openStatusDatabase } from "../status/session-memory-inspector.ts";
import type { LaunchContext } from "../runtime/launch-context.ts";
import { loadConfig, selectModelProfile } from "../runtime/config.ts";
import type { EmbeddingTransport } from "../memory/embedding-types.ts";
import { embeddingProviderFailureKind } from "../memory/embedding-provider-errors.ts";
import {
  SMC_CLI_CONTRACT_VERSION,
  SMC_CLI_REASON_CODES,
  type SMCCliFailure,
  type SMCCliReasonCode,
  type SMCCliSuccess,
  type SMCCliSuccessKind,
} from "../session-maintenance/status-types.ts";

export { SMC_CLI_CONTRACT_VERSION } from "../session-maintenance/status-types.ts";

export type SMCCommandDeps = IngestJobAdminServiceDeps & {
  context: LaunchContext;
  db?: Database;
  statusDeps?: StatusServiceDeps;
  initializeEmbedding?: (manifest: NonNullable<ReturnType<typeof readSMCManifest>>) => Promise<EmbeddingTransport>;
  requestIndexing?: (projectKey: string) => void | Promise<void>;
  forensicRetentionMs?: number | null;
};

export function registerSMCCommands(cli: Cli, deps: SMCCommandDeps): void {
  cli.command(["smc", "status"], (args) => status(args, deps));
  cli.command(["smc", "manifest"], (args) => manifest(args, deps));
  cli.command(["smc", "progress"], (args) => progress(args, deps));
  cli.command(["smc", "batches"], (args) => batches(args, deps));
  cli.command(["smc", "overlay"], (args) => overlay(args, deps));
  cli.command(["smc", "journal"], (args) => journal(args, deps));
  cli.command(["smc", "query"], (args) => query(args, deps));
  cli.command(["smc", "record"], (args) => record(args, deps));
  cli.command(["smc", "proposal", "validate"], (args) => validateProposal(args, deps));
  cli.command(["smc", "finalize"], (args) => finalize(args, deps));
  cli.command(["smc", "resume"], (args) => resume(args, deps));
  cli.command(["smc", "abandon"], (args) => runSMCAbandonCommand(args, deps));
  cli.command(["smc", "grant"], (args) => runSMCGrantCommand(args, deps));
  cli.command(["smc", "cleanup"], (args) => cleanup(args, deps));
  cli.command(["smc"], (args) => args.length === 0 || args[0] === "--help" || args[0] === "-h"
    ? ok(SMC_HELP)
    : fail(`Unknown SMC command: ${args.join(" ")}\n\n${SMC_HELP}`));
}

async function status(args: string[], deps: SMCCommandDeps): Promise<CommandResult> {
  const parsed = parseProjectArgs(args, "Usage: myelin smc status <project-key> [--json]");
  if (parsed.error) return parsedFailure(parsed);
  try {
    const summary = await new StatusService(deps.context.myelinRoot, {
      ...deps.statusDeps,
      now: deps.now,
      isProcessAlive: deps.statusDeps?.isProcessAlive,
      locatorPath: deps.context.locatorPath ?? undefined,
    }).summary({ projectKey: parsed.projectKey, cwd: deps.context.callerCwd });
    const value = summary.session_memory.smc;
    if (!value) return failure(parsed.json, "smc_status_unavailable", "SMC status projection is unavailable");
    return success(parsed.json, "status", value, renderSMCStatusHuman(value));
  } catch (error) {
    return failure(parsed.json, "smc_internal_error", message(error));
  }
}

function manifest(args: string[], deps: SMCCommandDeps): CommandResult {
  const parsed = parseJobArgs(args, "Usage: myelin smc manifest <job-id> [--json]");
  if (parsed.error) return parsedFailure(parsed);
  return withReadDb(deps, (db) => {
    const value = readSMCManifest(db, parsed.jobId);
    if (!value) return failure(parsed.json, "smc_manifest_not_found", `No SMC manifest for ${parsed.jobId}`);
    const projected = {
      job_id: value.job_id,
      project_key: value.project_key,
      owner_epoch: value.owner_epoch,
      trigger_reason: value.trigger_reason,
      manifest_digest: value.manifest_digest,
      snapshot_token: value.snapshot_token,
      evidence_count: value.selected_evidence_count,
      no_agent_intent_count: value.no_agent_intent_count,
      audit_member_count: value.audit_member_count,
      memory_count: value.active_memory_count,
      work_batch_count: value.work_batch_count,
      governing_identities: value.governing_identities,
      embedding_contract: {
        id: value.embedding_contract_id,
        provider: value.embedding_provider,
        model: value.embedding_model,
        dimensions: value.embedding_dimensions,
        format_version: value.embedding_format_version,
      },
      evidence_budgets: value.evidence_budgets,
      workflow_budgets: value.workflow_budgets,
      target_context: value.target_context,
      overlay: value.current_overlay_identity,
      created_at: value.created_at,
    };
    return success(parsed.json, "manifest", projected,
      `${value.job_id}: ${value.selected_evidence_count} evidence, ${value.audit_member_count} audit, ${value.work_batch_count} work batches; overlay r${value.current_overlay_identity.revision}`);
  });
}

function progress(args: string[], deps: SMCCommandDeps): CommandResult {
  const parsed = parseJobArgs(args, "Usage: myelin smc progress <job-id> [--json]");
  if (parsed.error) return parsedFailure(parsed);
  return withReadDb(deps, (db) => {
    const anchor = db.query("SELECT * FROM session_memory_anchor_jobs WHERE job_id = ?").get(parsed.jobId) as Record<string, unknown> | null;
    if (!anchor) return failure(parsed.json, "smc_anchor_not_found", `No SMC anchor ${parsed.jobId}`);
    const counts = {
      work_batches: count(db, "smc_work_batches", parsed.jobId),
      accepted_batches: scalar(db, "SELECT count(*) AS count FROM smc_overlay_revisions WHERE job_id = ?", parsed.jobId),
      journal_actions: count(db, "smc_action_journal", parsed.jobId),
      coverage_receipts: count(db, "smc_coverage_receipts", parsed.jobId),
      budget_grants: count(db, "smc_budget_grants", parsed.jobId),
    };
    const attempts = listSessionMemoryAnchorAttempts(db, parsed.jobId).map((item) => ({
      id: item.id,
      attempt_number: item.attempt_number,
      owner_epoch: item.owner_epoch,
      provider: item.provider,
      status: item.status,
      process: { process_id: item.process_id, authority: "diagnostic_only" as const },
      started_at: item.started_at,
      finished_at: item.finished_at,
    }));
    const value = { anchor, counts, attempts };
    return success(parsed.json, "progress", value,
      `${parsed.jobId}: ${String(anchor.phase)}@${String(anchor.owner_epoch)}; ${counts.accepted_batches}/${counts.work_batches} accepted`);
  });
}

function batches(args: string[], deps: SMCCommandDeps): CommandResult {
  const parsed = parsePagedJobArgs(args, "Usage: myelin smc batches <job-id> [--cursor N] [--limit N] [--json]");
  if (parsed.error) return parsedFailure(parsed);
  return withReadDb(deps, (db) => {
    const page = pagination(db, parsed.jobId, parsed.cursor, parsed.limit);
    if (page.kind === "error") return failure(parsed.json, page.error, page.reason);
    const rows = db.query(
      `SELECT batch_id, ordinal, work_kind, item_count, encoded_bytes, batch_digest
       FROM smc_work_batches WHERE job_id = ? ORDER BY ordinal, batch_id LIMIT ? OFFSET ?`,
    ).all(parsed.jobId, page.limit, parsed.cursor) as Array<Record<string, unknown>>;
    const total = count(db, "smc_work_batches", parsed.jobId);
    const value = { job_id: parsed.jobId, cursor: parsed.cursor, limit: page.limit, next_cursor: nextCursor(parsed.cursor, rows.length, total), items: rows };
    return success(parsed.json, "batches", value, `${rows.length} work batches for ${parsed.jobId}`);
  });
}

function overlay(args: string[], deps: SMCCommandDeps): CommandResult {
  const parsed = parsePagedJobArgs(args, "Usage: myelin smc overlay <job-id> [--revision N] [--cursor N] [--limit N] [--json]", true);
  if (parsed.error) return parsedFailure(parsed);
  return withReadDb(deps, (db) => {
    const page = pagination(db, parsed.jobId, parsed.cursor, parsed.limit);
    if (page.kind === "error") return failure(parsed.json, page.error, page.reason);
    try {
      const value = reconstructSMCOverlay(db, { job_id: parsed.jobId, ...(parsed.revision === undefined ? {} : { revision: parsed.revision }) });
      const items = value.records.slice(parsed.cursor, parsed.cursor + page.limit).map((item) => ({
        record_kind: item.record_kind,
        staged_id: item.staged_id,
        stable_key: item.stable_key,
        operation: item.operation,
        base_memory_id: item.base_memory_id,
        final_id: item.final_id,
        payload_digest: item.payload_digest,
        revision: item.revision,
      }));
      const projected = {
        job_id: parsed.jobId,
        identity: value.identity,
        masked_base_memory_ids: value.masked_base_memory_ids,
        cursor: parsed.cursor,
        limit: page.limit,
        next_cursor: nextCursor(parsed.cursor, items.length, value.records.length),
        items,
      };
      return success(parsed.json, "overlay", projected, `${items.length} staged overlay records at r${value.identity.revision}`);
    } catch (error) {
      return failure(parsed.json, "smc_internal_error", message(error));
    }
  });
}

function journal(args: string[], deps: SMCCommandDeps): CommandResult {
  const parsed = parseJournalArgs(args);
  if (parsed.error) return parsedFailure(parsed);
  return withReadDb(deps, (db) => {
    const page = pagination(db, parsed.jobId, parsed.cursor, parsed.limit);
    if (page.kind === "error") return failure(parsed.json, page.error, page.reason);
    const all = readSMCActionJournal(db, { job_id: parsed.jobId, attempt_id: parsed.attemptId });
    const items = all.slice(parsed.cursor, parsed.cursor + page.limit).map((item) => ({
      work_batch_id: item.work_batch_id,
      attempt_id: item.attempt_id,
      sequence: item.sequence,
      owner_epoch: item.owner_epoch,
      protocol_version: item.protocol_version,
      manifest_digest: item.manifest_digest,
      snapshot_token: item.snapshot_token,
      expected_overlay_revision: item.expected_overlay_revision,
      action_kind: item.action_kind,
      request_digest: item.request_digest,
      result_digest: item.result_digest,
      created_at: item.created_at,
    }));
    const value = { job_id: parsed.jobId, cursor: parsed.cursor, limit: page.limit, next_cursor: nextCursor(parsed.cursor, items.length, all.length), items };
    return success(parsed.json, "journal", value, `${items.length} journal entries for ${parsed.jobId}`);
  });
}

async function query(args: string[], deps: SMCCommandDeps): Promise<CommandResult> {
  const parsed = parseRequestArgs(args, "Usage: myelin smc query --request-json <json> [--json]");
  if (parsed.error) return parsedFailure(parsed);
  return await withWriteDbAsync(deps, async (db) => {
    try {
      const request = parsed.request as CuratorQueryRequest;
      const manifest = readSMCManifest(db, request?.job_id);
      if (!manifest) return failure(parsed.json, "smc_manifest_not_found", "Query job manifest is absent");
      const embedding = await initializeEmbedding(deps, manifest);
      const result = await queryCuratorMemory(db, request, { embedding_transport: embedding });
      return result.kind === "blocked"
        ? failure(parsed.json, result.code, result.reason, { retryable: result.retryable, result })
        : success(parsed.json, "query", result, `${result.matches.length} curator matches; complete=${result.complete}`);
    } catch (error) {
      const providerFailure = embeddingProviderFailureKind(error);
      return failure(
        parsed.json,
        providerFailure === "unreachable" ? "embedding_provider_unreachable" : "embedding_provider_unavailable",
        neutralProviderMessage(error),
        { retryable: providerFailure === "unreachable" },
      );
    }
  });
}

function record(args: string[], deps: SMCCommandDeps): CommandResult {
  const parsed = parseRequestArgs(args, "Usage: myelin smc record --request-json <json> [--json]");
  if (parsed.error) return parsedFailure(parsed);
  return withWriteDb(deps, (db) => {
    try {
      const result = fetchCuratorRecord(db, parsed.request as CuratorRecordRequest);
      return result.kind === "rejected"
        ? failure(parsed.json, result.code, result.reason)
        : success(parsed.json, "record", result, `Fetched explicit job-scoped record (${result.encoded_bytes} bytes)`);
    } catch (error) {
      return failure(parsed.json, "smc_internal_error", message(error));
    }
  });
}

function validateProposal(args: string[], deps: SMCCommandDeps): CommandResult {
  const parsed = parseRequestArgs(args, "Usage: myelin smc proposal validate --request-json <json> [--json]");
  if (parsed.error) return parsedFailure(parsed);
  return withReadDb(deps, (db) => {
    const request = parsed.request as Parameters<typeof inspectSMCBatchProposal>[1];
    const result = inspectSMCBatchProposal(db, request);
    const projected = result.valid
      ? { valid: true, response_digest: result.response_digest, delta_digest: result.delta_digest, record_count: result.records.length, issues: [] }
      : result;
    return result.valid
      ? success(parsed.json, "proposal_validation", projected, "Proposal is valid and remains noncanonical")
      : failure(parsed.json, "proposal_validation_failed", `${result.issues.length} validation issue(s)`, { result: projected });
  });
}

async function finalize(args: string[], deps: SMCCommandDeps): Promise<CommandResult> {
  const parsed = parseFinalizeArgs(args);
  if (parsed.error) return parsedFailure(parsed);
  return await withWriteDbAsync(deps, async (db) => {
    try {
      const result = await finalizeSessionMaintenance(db, {
        jobId: parsed.jobId,
        ownerEpoch: parsed.ownerEpoch,
        acceptedProjectionDigest: parsed.acceptedProjectionDigest,
        now: deps.now,
        requestIndexing: deps.requestIndexing,
      });
      return success(parsed.json, "finalization", result, `${result.kind} ${result.job_id}`);
    } catch (error) {
      return failure(parsed.json, finalizationReason(error), message(error));
    }
  });
}

async function resume(args: string[], deps: SMCCommandDeps): Promise<CommandResult> {
  const parsed = parseResumeArgs(args);
  if (parsed.error) return parsedFailure(parsed);
  try {
    const config = await loadConfig(deps.context.myelinRoot);
    const profile = selectModelProfile(config, "ingest", parsed.provider);
    const result = new IngestJobAdminService(deps.context.myelinRoot, deps).resumeSessionMaintenance({
      jobId: parsed.jobId,
      projectKey: parsed.projectKey,
      expectedOwnerEpoch: parsed.ownerEpoch,
      attemptId: parsed.attemptId ?? `attempt_${randomUUID()}`,
      invocation: { provider: profile.provider, model: profile.model ?? null, reasoning_effort: profile.reasoningEffort ?? null },
    });
    return result.kind === "blocked"
      ? failure(parsed.json, result.code, result.reason, { result })
      : success(parsed.json, "resume", result, `Resumed ${result.anchor.job_id} at epoch ${result.anchor.owner_epoch}`);
  } catch (error) {
    return failure(parsed.json, "smc_internal_error", message(error));
  }
}

export function runSMCResumeCommand(args: string[], deps: SMCCommandDeps): Promise<CommandResult> {
  return resume(args, deps);
}

export function runSMCAbandonCommand(args: string[], deps: SMCCommandDeps): CommandResult {
  const parsed = parseAbandonArgs(args);
  if (parsed.error) return parsedFailure(parsed);
  try {
    const result = new IngestJobAdminService(deps.context.myelinRoot, deps).abandonSessionMaintenance({
      jobId: parsed.jobId,
      projectKey: parsed.projectKey,
      expectedOwnerEpoch: parsed.ownerEpoch,
      receiptId: parsed.receiptId,
      requestId: parsed.requestId,
      operatorId: parsed.operatorId,
      reason: parsed.reason,
    });
    return result.kind === "rejected"
      ? failure(parsed.json, result.code, "Abandonment was rejected", { result })
      : success(parsed.json, "abandonment", result, `${result.kind} ${parsed.jobId}; released ${result.released_lease_count} leases`);
  } catch (error) {
    return failure(parsed.json, "smc_internal_error", message(error));
  }
}

export function runSMCGrantCommand(args: string[], deps: SMCCommandDeps): CommandResult {
  const parsed = parseGrantArgs(args);
  if (parsed.error) return parsedFailure(parsed);
  return withWriteDb(deps, (db) => {
    const manifest = readSMCManifest(db, parsed.jobId);
    if (!manifest || manifest.project_key !== parsed.projectKey) {
      return failure(parsed.json, "smc_budget_grant_identity_mismatch", "Grant job/project manifest is absent");
    }
    if (manifest.manifest_digest !== parsed.manifestDigest) {
      return failure(parsed.json, "smc_budget_grant_identity_mismatch", "Grant manifest digest differs");
    }
    try {
      const result = recordSMCBudgetGrant(db, {
        id: parsed.grantId,
        job_id: parsed.jobId,
        project_key: parsed.projectKey,
        owner_epoch: parsed.ownerEpoch,
        budget_name: parsed.budgetName as Parameters<typeof recordSMCBudgetGrant>[1]["budget_name"],
        additive_amount: parsed.amount,
        operator_id: parsed.operatorId,
        reason: parsed.reason,
        manifest_digest: parsed.manifestDigest,
        created_at: (deps.now ?? (() => new Date()))().toISOString(),
      });
      return success(parsed.json, "budget_grant", result, `Granted +${result.additive_amount} ${result.budget_name} to ${result.job_id}`);
    } catch (error) {
      return failure(parsed.json, budgetGrantReason(error), message(error));
    }
  });
}

async function cleanup(args: string[], deps: SMCCommandDeps): Promise<CommandResult> {
  const parsed = parseCleanupArgs(args);
  if (parsed.error) return parsedFailure(parsed);
  try {
    const config = await loadConfig(deps.context.myelinRoot);
    const result = new IngestJobAdminService(deps.context.myelinRoot, deps).cleanupSessionMaintenanceForensics({
      jobId: parsed.jobId,
      projectKey: parsed.projectKey,
      expectedOwnerEpoch: parsed.ownerEpoch,
      terminalReceiptDigest: parsed.terminalReceiptDigest,
      forensicRetentionMs: deps.forensicRetentionMs ?? config.sessionMaintenance.forensicRetentionMs,
    });
    return result.kind === "cleaned"
      ? success(parsed.json, "forensic_cleanup", result, `Cleaned ${result.deleted_rows} forensic detail rows for ${parsed.jobId}`)
      : failure(parsed.json, result.code, "Forensic cleanup did not run", { result });
  } catch (error) {
    return failure(parsed.json, "smc_internal_error", message(error));
  }
}

async function initializeEmbedding(
  deps: SMCCommandDeps,
  manifest: NonNullable<ReturnType<typeof readSMCManifest>>,
): Promise<EmbeddingTransport> {
  if (deps.initializeEmbedding) return await deps.initializeEmbedding(manifest);
  const config = await loadConfig(deps.context.myelinRoot);
  const initialized = await new EmbeddingProviderFactory(config).initializeTrustedCoordinatorContract({
    provider: manifest.embedding_provider as "ollama_nomic" | "ollama_qwen" | "gemini",
    model: manifest.embedding_model,
    dimensions: manifest.embedding_dimensions,
    purpose: "retrieval_document",
    formatVersion: manifest.embedding_format_version,
  });
  return createCompatiblePurposeEmbeddingTransport(initialized.client);
}

function success(json: boolean, kind: SMCCliSuccessKind, result: unknown, human: string): CommandResult {
  const value: SMCCliSuccess = { contract_version: SMC_CLI_CONTRACT_VERSION, ok: true, kind, result };
  return ok(json ? JSON.stringify(value, null, 2) : human);
}

function failure(
  json: boolean,
  reasonCode: SMCCliReasonCode,
  detail: string,
  extra: Record<string, unknown> = {},
): CommandResult {
  const value: SMCCliFailure = {
    contract_version: SMC_CLI_CONTRACT_VERSION,
    ok: false,
    kind: "blocked",
    reason_code: reasonCode,
    detail: compact(detail),
    ...extra,
  };
  return fail(json ? JSON.stringify(value, null, 2) : `${reasonCode}: ${value.detail}`);
}

function parsedFailure(parsed: { json: boolean; error: string }): CommandResult {
  return failure(parsed.json, "smc_cli_invalid_arguments", parsed.error);
}

function withReadDb(deps: SMCCommandDeps, fn: (db: Database) => CommandResult): CommandResult {
  if (deps.db) return fn(deps.db);
  const snapshot = openStatusDatabase(deps.context.myelinRoot);
  try { return fn(snapshot.db); } finally { snapshot.close(); }
}

function withWriteDb(deps: SMCCommandDeps, fn: (db: Database) => CommandResult): CommandResult {
  if (deps.db) return fn(deps.db);
  const db = openMemoryDb(deps.context.myelinRoot);
  try { return fn(db); } finally { db.close(); }
}

async function withWriteDbAsync(
  deps: SMCCommandDeps,
  fn: (db: Database) => Promise<CommandResult>,
): Promise<CommandResult> {
  if (deps.db) return await fn(deps.db);
  const db = openMemoryDb(deps.context.myelinRoot);
  try { return await fn(db); } finally { db.close(); }
}

function pagination(db: Database, jobId: string, cursor: number, requested?: number) {
  const manifest = readSMCManifest(db, jobId);
  if (!manifest) {
    return { kind: "error", error: "smc_manifest_not_found", reason: `No SMC manifest for ${jobId}` } as const;
  }
  const maximum = manifest.workflow_budgets.retrieval_page_item_limit;
  const limit = requested ?? maximum;
  if (!Number.isSafeInteger(limit) || limit <= 0 || limit > maximum) {
    return { kind: "error", error: "smc_page_limit_invalid", reason: `limit must be between 1 and ${maximum}` } as const;
  }
  return { kind: "page", limit } as const;
}

function parseProjectArgs(args: string[], usage: string) {
  let projectKey = "";
  let json = args.includes("--json");
  for (const arg of args) {
    if (arg === "--json") json = true;
    else if (arg.startsWith("-") || projectKey) return { projectKey, json, error: usage };
    else projectKey = arg;
  }
  return projectKey ? { projectKey, json } : { projectKey, json, error: usage };
}

function parseJobArgs(args: string[], usage: string) {
  let jobId = "";
  let json = args.includes("--json");
  for (const arg of args) {
    if (arg === "--json") json = true;
    else if (arg.startsWith("-") || jobId) return { jobId, json, error: usage };
    else jobId = arg;
  }
  return jobId ? { jobId, json } : { jobId, json, error: usage };
}

function parsePagedJobArgs(args: string[], usage: string, allowRevision = false) {
  let jobId = "";
  let cursor = 0;
  let limit: number | undefined;
  let revision: number | undefined;
  let json = args.includes("--json");
  const valueOptions = allowRevision ? ["--cursor", "--limit", "--revision"] : ["--cursor", "--limit"];
  if (hasMissingOptionValue(args, valueOptions)) {
    return { jobId, cursor, limit, revision, json, error: usage };
  }
  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];
    if (arg === "--json") json = true;
    else if (arg === "--cursor") cursor = Number(args[++i]);
    else if (arg === "--limit") limit = Number(args[++i]);
    else if (allowRevision && arg === "--revision") revision = Number(args[++i]);
    else if (!arg.startsWith("-") && !jobId) jobId = arg;
    else return { jobId, cursor, limit, revision, json, error: usage };
  }
  if (!jobId || !Number.isSafeInteger(cursor) || cursor < 0
    || (limit !== undefined && (!Number.isSafeInteger(limit) || limit <= 0))
    || (revision !== undefined && (!Number.isSafeInteger(revision) || revision < 0))) {
    return { jobId, cursor, limit, revision, json, error: usage };
  }
  return { jobId, cursor, limit, revision, json };
}

function parseJournalArgs(args: string[]) {
  const usage = "Usage: myelin smc journal <job-id> [--attempt-id ID] [--cursor N] [--limit N] [--json]";
  if (hasMissingOptionValue(args, ["--attempt-id", "--cursor", "--limit"])) {
    return { jobId: "", cursor: 0, limit: undefined, revision: undefined, json: args.includes("--json"), attemptId: undefined, error: usage };
  }
  const page = parsePagedJobArgs(args.filter((_, i) => args[i - 1] !== "--attempt-id" && args[i] !== "--attempt-id"), usage);
  let attemptId: string | undefined;
  for (let i = 0; i < args.length; i += 1) if (args[i] === "--attempt-id") attemptId = args[++i];
  return page.error || attemptId === "" ? { ...page, attemptId, error: usage } : { ...page, attemptId };
}

function parseRequestArgs(args: string[], usage: string) {
  let raw = "";
  let json = args.includes("--json");
  if (hasMissingOptionValue(args, ["--request-json"])) return { request: null, json, error: usage };
  for (let i = 0; i < args.length; i += 1) {
    if (args[i] === "--json") json = true;
    else if (args[i] === "--request-json") raw = args[++i] ?? "";
    else return { request: null, json, error: usage };
  }
  if (!raw) return { request: null, json, error: usage };
  try { return { request: JSON.parse(raw) as unknown, json }; }
  catch { return { request: null, json, error: "request JSON is invalid" }; }
}

function parseFinalizeArgs(args: string[]) {
  const usage = "Usage: myelin smc finalize <job-id> --owner-epoch N --accepted-projection-digest sha256:... [--json]";
  let jobId = "";
  let ownerEpoch = 0;
  let acceptedProjectionDigest = "";
  let json = args.includes("--json");
  if (hasMissingOptionValue(args, ["--owner-epoch", "--accepted-projection-digest"])) {
    return { jobId, ownerEpoch, acceptedProjectionDigest, json, error: usage };
  }
  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];
    if (arg === "--json") json = true;
    else if (arg === "--owner-epoch") ownerEpoch = Number(args[++i]);
    else if (arg === "--accepted-projection-digest") acceptedProjectionDigest = args[++i] ?? "";
    else if (!arg.startsWith("-") && !jobId) jobId = arg;
    else return { jobId, ownerEpoch, acceptedProjectionDigest, json, error: usage };
  }
  return jobId && Number.isSafeInteger(ownerEpoch) && ownerEpoch > 0 && validDigest(acceptedProjectionDigest)
    ? { jobId, ownerEpoch, acceptedProjectionDigest, json }
    : { jobId, ownerEpoch, acceptedProjectionDigest, json, error: usage };
}

function parseResumeArgs(args: string[]) {
  const usage = "Usage: myelin smc resume <project-key> <job-id> --owner-epoch N [--attempt-id ID] [--provider codex|claude] [--json]";
  let projectKey = "", jobId = "", ownerEpoch = 0, attemptId: string | undefined, provider: "codex" | "claude" | undefined, json = args.includes("--json");
  if (hasMissingOptionValue(args, ["--owner-epoch", "--attempt-id", "--provider"])) {
    return { projectKey, jobId, ownerEpoch, attemptId, provider, json, error: usage };
  }
  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];
    if (arg === "--json") json = true;
    else if (arg === "--owner-epoch") ownerEpoch = Number(args[++i]);
    else if (arg === "--attempt-id") attemptId = args[++i];
    else if (arg === "--provider") {
      const value = args[++i];
      if (value !== "codex" && value !== "claude") return { projectKey, jobId, ownerEpoch, attemptId, provider, json, error: usage };
      provider = value;
    } else if (!arg.startsWith("-") && !projectKey) projectKey = arg;
    else if (!arg.startsWith("-") && !jobId) jobId = arg;
    else return { projectKey, jobId, ownerEpoch, attemptId, provider, json, error: usage };
  }
  return projectKey && jobId && Number.isSafeInteger(ownerEpoch) && ownerEpoch > 0 && attemptId !== ""
    ? { projectKey, jobId, ownerEpoch, attemptId, provider, json }
    : { projectKey, jobId, ownerEpoch, attemptId, provider, json, error: usage };
}

function parseAbandonArgs(args: string[]) {
  const usage = "Usage: myelin ingest abandon <project-key> <job-id> --owner-epoch N --receipt-id ID --request-id ID --operator-id ID --reason TEXT [--json]";
  let projectKey = "", jobId = "", ownerEpoch = 0, receiptId = "", requestId = "", operatorId = "", why = "", json = args.includes("--json");
  if (hasMissingOptionValue(args, ["--owner-epoch", "--receipt-id", "--request-id", "--operator-id", "--reason"])) {
    return { projectKey, jobId, ownerEpoch, receiptId, requestId, operatorId, reason: why, json, error: usage };
  }
  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];
    if (arg === "--json") json = true;
    else if (arg === "--owner-epoch") ownerEpoch = Number(args[++i]);
    else if (arg === "--receipt-id") receiptId = args[++i] ?? "";
    else if (arg === "--request-id") requestId = args[++i] ?? "";
    else if (arg === "--operator-id") operatorId = args[++i] ?? "";
    else if (arg === "--reason") why = args[++i] ?? "";
    else if (!arg.startsWith("-") && !projectKey) projectKey = arg;
    else if (!arg.startsWith("-") && !jobId) jobId = arg;
    else return { projectKey, jobId, ownerEpoch, receiptId, requestId, operatorId, reason: why, json, error: usage };
  }
  return projectKey && jobId && ownerEpoch > 0 && receiptId && requestId && operatorId && why
    ? { projectKey, jobId, ownerEpoch, receiptId, requestId, operatorId, reason: why, json }
    : { projectKey, jobId, ownerEpoch, receiptId, requestId, operatorId, reason: why, json, error: usage };
}

function parseGrantArgs(args: string[]) {
  const usage = "Usage: myelin ingest grant <project-key> <job-id> --owner-epoch N --manifest-digest sha256:... --grant-id ID --budget max_turns|max_queries|max_cumulative_returned_result_bytes|max_provider_envelope_bytes|max_affected_work_set_size --amount N --operator-id ID --reason TEXT [--json]";
  let projectKey = "", jobId = "", ownerEpoch = 0, manifestDigest = "", grantId = "", budgetName = "", amount = 0, operatorId = "", why = "", json = args.includes("--json");
  if (hasMissingOptionValue(args, ["--owner-epoch", "--manifest-digest", "--grant-id", "--budget", "--amount", "--operator-id", "--reason"])) {
    return { projectKey, jobId, ownerEpoch, manifestDigest, grantId, budgetName, amount, operatorId, reason: why, json, error: usage };
  }
  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];
    if (arg === "--json") json = true;
    else if (arg === "--owner-epoch") ownerEpoch = Number(args[++i]);
    else if (arg === "--manifest-digest") manifestDigest = args[++i] ?? "";
    else if (arg === "--grant-id") grantId = args[++i] ?? "";
    else if (arg === "--budget") budgetName = args[++i] ?? "";
    else if (arg === "--amount") amount = Number(args[++i]);
    else if (arg === "--operator-id") operatorId = args[++i] ?? "";
    else if (arg === "--reason") why = args[++i] ?? "";
    else if (!arg.startsWith("-") && !projectKey) projectKey = arg;
    else if (!arg.startsWith("-") && !jobId) jobId = arg;
    else return { projectKey, jobId, ownerEpoch, manifestDigest, grantId, budgetName, amount, operatorId, reason: why, json, error: usage };
  }
  return projectKey && jobId && ownerEpoch > 0 && validDigest(manifestDigest) && grantId
    && (SMC_ADDITIVE_WORKFLOW_BUDGET_KEYS as readonly string[]).includes(budgetName)
    && Number.isSafeInteger(amount) && amount > 0 && operatorId && why
    ? { projectKey, jobId, ownerEpoch, manifestDigest, grantId, budgetName, amount, operatorId, reason: why, json }
    : { projectKey, jobId, ownerEpoch, manifestDigest, grantId, budgetName, amount, operatorId, reason: why, json, error: usage };
}

function parseCleanupArgs(args: string[]) {
  const usage = "Usage: myelin smc cleanup <project-key> <job-id> --owner-epoch N --terminal-receipt-digest sha256:... [--json]";
  let projectKey = "", jobId = "", ownerEpoch = 0, terminalReceiptDigest = "", json = args.includes("--json");
  if (hasMissingOptionValue(args, ["--owner-epoch", "--terminal-receipt-digest"])) {
    return { projectKey, jobId, ownerEpoch, terminalReceiptDigest, json, error: usage };
  }
  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];
    if (arg === "--json") json = true;
    else if (arg === "--owner-epoch") ownerEpoch = Number(args[++i]);
    else if (arg === "--terminal-receipt-digest") terminalReceiptDigest = args[++i] ?? "";
    else if (!arg.startsWith("-") && !projectKey) projectKey = arg;
    else if (!arg.startsWith("-") && !jobId) jobId = arg;
    else return { projectKey, jobId, ownerEpoch, terminalReceiptDigest, json, error: usage };
  }
  return projectKey && jobId && Number.isSafeInteger(ownerEpoch) && ownerEpoch > 0 && validDigest(terminalReceiptDigest)
    ? { projectKey, jobId, ownerEpoch, terminalReceiptDigest, json }
    : { projectKey, jobId, ownerEpoch, terminalReceiptDigest, json, error: usage };
}

export function renderSMCStatusHuman(value: NonNullable<Awaited<ReturnType<StatusService["summary"]>>["session_memory"]["smc"]>): string {
  const anchor = value.current_anchor
    ? `${value.current_anchor.job_id} ${value.current_anchor.phase}@${value.current_anchor.owner_epoch}`
      + ` reason=${value.current_anchor.reason_code ?? "none"}`
      + ` liveness=${value.current_anchor.process.liveness} (${value.current_anchor.process.authority})`
    : "none";
  const projectFence = value.project_fence
    ? `${value.project_fence.owner_kind}:${value.project_fence.owner_id}@${value.project_fence.owner_epoch}`
    : "none";
  const globalFence = value.global_embedding_fence
    ? `${value.global_embedding_fence.operation_kind}:${value.global_embedding_fence.operation_id}@${value.global_embedding_fence.owner_epoch}`
    : "none";
  return `SMC ${value.project_key}: freshness=${value.freshness.state}; queued=${value.queued_content.count}`
    + ` oldest_age_ms=${value.queued_content.oldest_age_ms ?? "none"}; anchor=${anchor}; project_fence=${projectFence}`
    + `; global_fence=${globalFence}; audit=${value.audit_coverage.covered_revision_count}/${value.audit_coverage.active_revision_count}`
    + ` (${value.audit_coverage.due_revision_count} due); indexing=${value.indexing.state}/${value.indexing.provider_state}`
    + `; permanent_legacy_denies=${value.legacy.permanently_denied_job_count}`
    + `; reasons=${value.reason_codes.length > 0 ? value.reason_codes.join(",") : "none"}`;
}

function count(db: Database, table: string, jobId: string): number {
  return scalar(db, `SELECT count(*) AS count FROM ${table} WHERE job_id = ?`, jobId);
}

function scalar(db: Database, sql: string, value: string): number {
  return (db.query(sql).get(value) as { count: number }).count;
}

function nextCursor(cursor: number, returned: number, total: number): number | null {
  return returned > 0 && cursor + returned < total ? cursor + returned : null;
}

function validDigest(value: string): boolean { return /^sha256:[0-9a-f]{64}$/u.test(value); }
function hasMissingOptionValue(args: readonly string[], options: readonly string[]): boolean {
  const valued = new Set(options);
  return args.some((arg, index) => valued.has(arg) && (!args[index + 1] || args[index + 1]!.startsWith("--")));
}
function message(error: unknown): string { return error instanceof Error ? error.message : String(error); }
function finalizationReason(error: unknown): SMCCliReasonCode {
  return error instanceof SessionMaintenanceFinalizationError && isSMCCliReasonCode(error.code)
    ? error.code
    : "smc_internal_error";
}
function budgetGrantReason(error: unknown): SMCCliReasonCode {
  const value = message(error);
  switch (value) {
    case "smc_budget_grant_identity_mismatch":
    case "smc_budget_grant_conflict":
    case "invalid_smc_budget_grant_digest":
    case "smc_budget_grant_overflow":
      return value;
    default:
      return "smc_internal_error";
  }
}
function isSMCCliReasonCode(value: string): value is SMCCliReasonCode {
  return (SMC_CLI_REASON_CODES as readonly string[]).includes(value);
}
function compact(value: string): string { return value.replace(/\s+/gu, " ").trim().slice(0, 500); }
function neutralProviderMessage(error: unknown): string {
  const text = compact(message(error));
  return /unreachable|socket|network|fetch failed/iu.test(text)
    ? `Embedding provider is unreachable from the current Myelin process. Verify provider availability and this process's network permission. ${text}`
    : text;
}

const SMC_HELP = `Usage: myelin smc <command>\n\nCommands:\n  myelin smc status <project-key> [--json]\n  myelin smc manifest <job-id> [--json]\n  myelin smc progress <job-id> [--json]\n  myelin smc batches <job-id> [--cursor N] [--limit N] [--json]\n  myelin smc overlay <job-id> [--revision N] [--cursor N] [--limit N] [--json]\n  myelin smc journal <job-id> [--attempt-id ID] [--cursor N] [--limit N] [--json]\n  myelin smc query --request-json <json> [--json]\n  myelin smc record --request-json <json> [--json]\n  myelin smc proposal validate --request-json <json> [--json]\n  myelin smc finalize <job-id> --owner-epoch N --accepted-projection-digest sha256:... [--json]\n  myelin smc resume <project-key> <job-id> --owner-epoch N [--attempt-id ID] [--provider codex|claude] [--json]\n  myelin smc abandon <project-key> <job-id> --owner-epoch N --receipt-id ID --request-id ID --operator-id ID --reason TEXT [--json]\n  myelin smc grant <project-key> <job-id> --owner-epoch N --manifest-digest sha256:... --grant-id ID --budget max_turns|max_queries|max_cumulative_returned_result_bytes|max_provider_envelope_bytes|max_affected_work_set_size --amount N --operator-id ID --reason TEXT [--json]\n  myelin smc cleanup <project-key> <job-id> --owner-epoch N --terminal-receipt-digest sha256:... [--json]`;
