import { createHash } from "node:crypto";
import type { Database } from "bun:sqlite";
import { finalizeAnchorExperienceEventsInOpenTransaction } from "../memory/experience.ts";
import { issueFinalizingProjectSessionMutationAuthorityInOpenTransaction } from "../memory/project-session-mutation-fence.ts";
import { stableJson } from "../runtime/json.ts";
import { writeSessionMemoryAuditReceiptInOpenTransaction } from "./audit-receipts.ts";
import { applySessionMaintenanceProjectionInOpenTransaction } from "./commit.ts";
import {
  completeSessionMemoryAnchorJobInOpenTransaction,
  getSessionMemoryAnchorJob,
  transitionSessionMemoryAnchorJob,
} from "./job-lifecycle.ts";
import {
  sessionMaintenanceOutputContractIdentity,
  sessionMaintenancePolicyIdentity,
  sessionMaintenanceToolProtocolIdentity,
} from "./identity.ts";
import { readSMCManifest } from "./manifest.ts";
import { validateSessionMaintenanceFrozenState } from "./recovery-service.ts";
import { buildSessionMaintenanceProjection } from "./projection.ts";
import {
  readSessionMaintenanceProjectionResult,
  writeSessionMaintenanceProjectionResultInOpenTransaction,
} from "./result.ts";
import {
  readSMCTerminalReceipt,
  writeSMCTerminalReceiptInOpenTransaction,
  type SMCTerminalReceipt,
} from "./terminal-receipts.ts";

export type FinalizationIndexingState =
  | { kind: "requested" }
  | { kind: "degraded"; code: "session_memory_index_request_failed"; reason: string };

export type SessionMaintenanceFinalizationResult = Readonly<{
  kind: "finalized" | "replayed";
  job_id: string;
  accepted_projection_digest: string;
  receipt: SMCTerminalReceipt;
  indexing: FinalizationIndexingState;
}>;

export class SessionMaintenanceFinalizationError extends Error {
  constructor(readonly code: string, detail: string) {
    super(`${code}: ${detail}`);
    this.name = "SessionMaintenanceFinalizationError";
  }
}

export async function finalizeSessionMaintenance(
  db: Database,
  input: {
    jobId: string;
    ownerEpoch: number;
    acceptedProjectionDigest: string;
    now?: () => Date;
    requestIndexing?: (projectKey: string) => void | Promise<void>;
    failure_injection?: {
      after_effect?: (effect: string) => void;
      before_commit?: () => void;
      after_commit_before_response?: () => void;
    };
  },
): Promise<SessionMaintenanceFinalizationResult> {
  if (db.inTransaction) throw new Error("finalizeSessionMaintenance must own its BEGIN IMMEDIATE transaction");
  const now = input.now ?? (() => new Date());
  const replay = replayReceipt(db, input.jobId, input.acceptedProjectionDigest);
  if (replay) {
    const indexing = await requestIndexing(input.requestIndexing, projectKeyFromReceipt(replay), input.jobId);
    return {
      kind: "replayed",
      job_id: input.jobId,
      accepted_projection_digest: input.acceptedProjectionDigest,
      receipt: replay,
      indexing,
    };
  }

  let receipt: SMCTerminalReceipt;
  let projectKey = "";
  receipt = db.transaction(() => {
    const committed = replayReceipt(db, input.jobId, input.acceptedProjectionDigest);
    if (committed) return committed;
    const anchor = getSessionMemoryAnchorJob(db, input.jobId);
    if (!anchor) fail("finalization_anchor_not_found", input.jobId);
    projectKey = anchor.project_key;
    if (anchor.phase !== "running" || anchor.owner_epoch !== input.ownerEpoch) {
      fail("finalization_authority_mismatch", `${anchor.phase}@${anchor.owner_epoch}`);
    }
    const manifest = readSMCManifest(db, input.jobId);
    if (!manifest || manifest.project_key !== anchor.project_key) fail("finalization_manifest_mismatch", input.jobId);
    const frozenState = validateSessionMaintenanceFrozenState(db, manifest);
    if (frozenState.kind === "blocked") {
      fail(`finalization_${frozenState.code.slice(4)}`, frozenState.reason);
    }
    assertGoverningIdentityUnchanged(manifest);
    const stored = readSessionMaintenanceProjectionResult(db, input.jobId);
    if (!stored || stored.accepted_projection_digest !== input.acceptedProjectionDigest) {
      fail("finalization_projection_mismatch", "accepted projection is absent or differs");
    }
    const rebuilt = buildSessionMaintenanceProjection(db, {
      job_id: manifest.job_id,
      project_key: manifest.project_key,
      manifest_digest: manifest.manifest_digest,
      snapshot_token: manifest.snapshot_token,
      overlay_revision: manifest.current_overlay_identity.revision,
      overlay_digest: manifest.current_overlay_identity.digest,
    });
    if (
      rebuilt.projection_digest !== input.acceptedProjectionDigest
      || stableJson(rebuilt.projection) !== stableJson(stored.accepted_projection)
    ) fail("finalization_projection_drift", "rebuilt projection differs from the accepted result");
    const finalizing = transitionSessionMemoryAnchorJob(db, {
      jobId: input.jobId,
      projectKey: manifest.project_key,
      expectedPhase: "running",
      expectedOwnerEpoch: input.ownerEpoch,
      nextPhase: "finalizing",
      now: now().toISOString(),
      reasonCode: null,
    });
    if (finalizing.kind !== "updated") fail("finalization_cas_rejected", finalizing.code);
    input.failure_injection?.after_effect?.("finalizing_cas");
    const finalizedAt = now().toISOString();
    const authority = issueFinalizingProjectSessionMutationAuthorityInOpenTransaction(db, {
      projectKey: manifest.project_key,
      ownerId: input.jobId,
      ownerEpoch: input.ownerEpoch,
    });
    const counts = applySessionMaintenanceProjectionInOpenTransaction(db, {
      projectKey: manifest.project_key,
      jobId: input.jobId,
      provider: manifest.governing_identities.invocation.provider,
      providerSessionId: null,
      projection: rebuilt.projection,
      finalizedAt,
      embeddingContract: {
        provider: manifest.embedding_provider as "ollama_nomic" | "ollama_qwen" | "gemini",
        model: manifest.embedding_model,
        dimensions: manifest.embedding_dimensions,
        purpose: "retrieval_document",
        formatVersion: manifest.embedding_format_version,
      },
      authority,
    });
    input.failure_injection?.after_effect?.("canonical_projection");

    const finalizationEvents = selectedFinalizationEvents(db, manifest.job_id, rebuilt.projection);
    finalizeAnchorExperienceEventsInOpenTransaction(db, {
      ingest_job_id: manifest.job_id,
      project_key: manifest.project_key,
      owner_epoch: input.ownerEpoch,
      finalized_at: finalizedAt,
      events: finalizationEvents,
    });
    input.failure_injection?.after_effect?.("source_terminalization");

    const auditReceiptIds: string[] = [];
    const auditMembers = db.query(
      `SELECT a.memory_id, a.revision, a.state_digest, a.batch_id,
              a.work_kind, b.work_kind AS batch_work_kind
       FROM smc_audit_batch_members a
       LEFT JOIN smc_work_batches b ON b.job_id = a.job_id AND b.batch_id = a.batch_id
       WHERE a.job_id = ? ORDER BY a.ordinal`,
    ).all(manifest.job_id) as Array<{
      memory_id: string; revision: number; state_digest: string; batch_id: string;
      work_kind: string; batch_work_kind: string | null;
    }>;
    if (auditMembers.length !== manifest.audit_member_count
      || auditMembers.some((member) => member.work_kind !== "audit" || member.batch_work_kind !== "audit")) {
      fail("finalization_audit_coverage_invalid", "frozen audit membership differs from the manifest");
    }
    const dispositions = new Map(rebuilt.projection.memory_dispositions.map((item) => [item.memory_id, item]));
    for (const member of auditMembers) {
      const disposition = dispositions.get(member.memory_id);
      if (!disposition || disposition.work_kind !== "audit") {
        fail("finalization_audit_coverage_invalid", member.memory_id);
      }
      auditReceiptIds.push(writeSessionMemoryAuditReceiptInOpenTransaction(db, {
        manifest,
        memory_id: member.memory_id,
        work_batch_id: member.batch_id,
        reviewed_revision: member.revision,
        reviewed_state_digest: member.state_digest,
        disposition: disposition.disposition,
        accepted_projection_digest: rebuilt.projection_digest,
        created_at: finalizedAt,
      }).id);
    }
    const persistedAuditReceiptCount = (db.query(
      "SELECT count(*) AS count FROM session_memory_audit_receipts WHERE job_id = ?",
    ).get(manifest.job_id) as { count: number }).count;
    if (auditReceiptIds.length !== manifest.audit_member_count
      || persistedAuditReceiptCount !== manifest.audit_member_count) {
      fail("finalization_audit_coverage_invalid", "audit receipt count differs from the frozen manifest");
    }
    input.failure_injection?.after_effect?.("audit_receipts");

    const accepted = writeSessionMaintenanceProjectionResultInOpenTransaction(db, {
      project_key: manifest.project_key,
      job_id: manifest.job_id,
      owner_epoch: input.ownerEpoch,
      phase: "finalizing",
      projection: rebuilt.projection,
      stored_at: finalizedAt,
      state: "committed",
    });
    const acceptedResultDigest = digest(accepted);
    input.failure_injection?.after_effect?.("accepted_result");

    const tombstoneIds = finalizationEvents.map((event) => event.tombstone_id).sort(compareText);
    const terminalResult = {
      schema_version: 1,
      accepted_projection_digest: rebuilt.projection_digest,
      accepted_result_digest: acceptedResultDigest,
      output_counts: { ...counts, finalized_sources: tombstoneIds.length },
      output_ids: {
        session_memories: rebuilt.projection.session_memories.map((item) => item.id).sort(compareText),
        memory_candidates: rebuilt.projection.memory_candidates.map((item) => item.id).sort(compareText),
        handoff_instructions: rebuilt.projection.handoff_instructions.map((item) => item.id).sort(compareText),
        memory_dispositions: rebuilt.projection.memory_dispositions.map((item) => item.memory_id).sort(compareText),
        audit_receipts: auditReceiptIds.sort(compareText),
      },
      terminal_tombstone_ids: tombstoneIds,
      committed_at: finalizedAt,
      project_key: manifest.project_key,
    };
    const terminal = writeSMCTerminalReceiptInOpenTransaction(db, {
      id: finalizationReceiptId(manifest.job_id, rebuilt.projection_digest),
      job_id: manifest.job_id,
      project_key: manifest.project_key,
      receipt_kind: "finalization",
      terminal_basis: { kind: "smc_manifest", digest: manifest.manifest_digest as `sha256:${string}` },
      target_owner_epoch: input.ownerEpoch,
      result: terminalResult,
      created_at: finalizedAt,
    });
    input.failure_injection?.after_effect?.("terminal_receipt");
    completeSessionMemoryAnchorJobInOpenTransaction(db, {
      jobId: manifest.job_id,
      projectKey: manifest.project_key,
      expectedOwnerEpoch: input.ownerEpoch,
      terminalReceiptId: terminal.id,
      outputCounts: terminalResult.output_counts,
      terminalSummary: null,
      now: finalizedAt,
    });
    input.failure_injection?.after_effect?.("job_completion_and_fence_release");
    input.failure_injection?.before_commit?.();
    return terminal;
  }).immediate();

  projectKey ||= projectKeyFromReceipt(receipt);
  const indexing = await requestIndexing(input.requestIndexing, projectKey, input.jobId);
  input.failure_injection?.after_commit_before_response?.();
  return {
    kind: "finalized",
    job_id: input.jobId,
    accepted_projection_digest: input.acceptedProjectionDigest,
    receipt,
    indexing,
  };
}

function assertGoverningIdentityUnchanged(manifest: NonNullable<ReturnType<typeof readSMCManifest>>): void {
  const currentIdentities = {
    policy: sessionMaintenancePolicyIdentity(),
    output_contract: sessionMaintenanceOutputContractIdentity(),
    tool_protocol: sessionMaintenanceToolProtocolIdentity(),
  };
  const frozenIdentities = {
    policy: manifest.governing_identities.policy,
    output_contract: manifest.governing_identities.output_contract,
    tool_protocol: manifest.governing_identities.tool_protocol,
  };
  if (stableJson(currentIdentities) !== stableJson(frozenIdentities)) {
    fail("finalization_governing_identity_drift", "policy, output, or tool identity changed");
  }
}

function selectedFinalizationEvents(
  db: Database,
  jobId: string,
  projection: ReturnType<typeof buildSessionMaintenanceProjection>["projection"],
) {
  const contentRows = db.query(
    `SELECT source_id, tombstone_id FROM smc_evidence_snapshot WHERE job_id = ? ORDER BY ordinal`,
  ).all(jobId) as Array<{ source_id: string; tombstone_id: string }>;
  const dispositions = new Map(projection.source_event_dispositions.map((item) => [item.source_event_id, item]));
  const content = contentRows.map((row) => {
    const disposition = dispositions.get(row.source_id);
    if (!disposition) fail("finalization_source_coverage_invalid", row.source_id);
    return {
      tombstone_id: row.tombstone_id,
      source_event_id: row.source_id,
      state: disposition.disposition === "used" ? "output" as const : "no_output" as const,
      terminal_decision: disposition.disposition,
      output_references: disposition.disposition === "used" ? disposition.output_refs : [],
    };
  });
  const noAgent = db.query(
    `SELECT source_id, tombstone_id, terminal_state, terminal_decision
     FROM smc_no_agent_intents WHERE job_id = ? ORDER BY ordinal`,
  ).all(jobId) as Array<{
    source_id: string; tombstone_id: string; terminal_state: "no_output"; terminal_decision: string;
  }>;
  return [...content, ...noAgent.map((row) => ({
    tombstone_id: row.tombstone_id,
    source_event_id: row.source_id,
    state: row.terminal_state,
    terminal_decision: row.terminal_decision,
    output_references: [] as string[],
  }))];
}

function replayReceipt(db: Database, jobId: string, acceptedProjectionDigest: string): SMCTerminalReceipt | null {
  const receipt = readSMCTerminalReceipt(db, jobId);
  if (!receipt) return null;
  if (receipt.receipt_kind !== "finalization") fail("finalization_terminal_conflict", receipt.receipt_kind);
  const result = asRecord(receipt.result);
  if (result.accepted_projection_digest !== acceptedProjectionDigest) {
    fail("finalization_projection_conflict", "terminal receipt binds another projection digest");
  }
  return receipt;
}

async function requestIndexing(
  request: ((projectKey: string) => void | Promise<void>) | undefined,
  projectKey: string,
  jobId: string,
): Promise<FinalizationIndexingState> {
  if (!request) return { kind: "requested" };
  try {
    await request(projectKey);
    return { kind: "requested" };
  } catch (error) {
    return {
      kind: "degraded",
      code: "session_memory_index_request_failed",
      reason: compact(error, jobId),
    };
  }
}

function projectKeyFromReceipt(receipt: SMCTerminalReceipt): string {
  const result = asRecord(receipt.result);
  if (typeof result.project_key !== "string" || result.project_key.length === 0) {
    fail("finalization_receipt_invalid", "project key is absent");
  }
  return result.project_key;
}

function normalizedEvidenceRow(db: Database, sourceId: string, projectKey: string): unknown | null {
  return db.query(
    `SELECT id AS source_id, project_key, inserted_at, occurred_at, hook_event_name,
            event_kind, cwd, provider, provider_session_id, turn_id, raw_text,
            raw_payload_json, source, status, repo_path, git_branch, git_commit,
            git_worktree_id, dedupe_key
     FROM experience_events WHERE id = ? AND project_key = ?`,
  ).get(sourceId, projectKey);
}

function finalizationReceiptId(jobId: string, projectionDigest: string): string {
  return `smc_finalize_${sha256(stableJson({ job_id: jobId, projection_digest: projectionDigest }))}`;
}

function asRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) fail("finalization_receipt_invalid", "result");
  return value as Record<string, unknown>;
}

function fail(code: string, detail: string): never {
  throw new SessionMaintenanceFinalizationError(code, detail);
}

function digest(value: unknown): `sha256:${string}` {
  return `sha256:${sha256(stableJson(value))}`;
}

function sha256(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function compact(error: unknown, jobId: string): string {
  const message = error instanceof Error ? error.message : String(error);
  const value = `${jobId}: ${message}`;
  return value.length <= 4_000 ? value : `${value.slice(0, 3_997)}...`;
}
