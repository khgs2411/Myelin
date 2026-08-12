import type { Database } from "bun:sqlite";
import type {
  IngestJobRow,
  IngestJobStatus,
  ProjectSessionMutationFenceRow,
  SessionMemoryAnchorAttemptRow,
  SessionMemoryAnchorJobPhase,
  SessionMemoryAnchorJobRow,
  SessionMemoryAnchorReasonCode,
} from "../memory/ingest-types.ts";
import { readSessionMemoryMutationAuthorityMode } from "../memory/project-session-mutation-fence.ts";
import { withAnchorLifecycleAdmission } from "../memory/session-memory-write-firewall.ts";

export type SessionMemoryAnchorJobCasFailureCode =
  | "session_memory_authority_not_activated"
  | "session_memory_anchor_not_found"
  | "session_memory_anchor_wrong_project"
  | "session_memory_anchor_stale_epoch"
  | "session_memory_anchor_wrong_phase"
  | "session_memory_anchor_fence_mismatch"
  | "session_memory_anchor_not_resumable"
  | "session_memory_anchor_abandonment_service_required"
  | "session_memory_anchor_legacy_denied"
  | "session_memory_anchor_attempt_required";

export type SessionMemoryAnchorJobCasResult =
  | { kind: "updated"; anchor: SessionMemoryAnchorJobRow; fence: ProjectSessionMutationFenceRow }
  | {
    kind: "rejected";
    code: SessionMemoryAnchorJobCasFailureCode;
    anchor: SessionMemoryAnchorJobRow | null;
    fence: ProjectSessionMutationFenceRow | null;
  };

export function getSessionMemoryAnchorJob(
  db: Database,
  jobId: string,
): SessionMemoryAnchorJobRow | null {
  return (db.query("SELECT * FROM session_memory_anchor_jobs WHERE job_id = ?").get(jobId) as
    SessionMemoryAnchorJobRow | null) ?? null;
}

export function listSessionMemoryAnchorJobs(
  db: Database,
  input: { projectKey: string; phase?: SessionMemoryAnchorJobPhase },
): SessionMemoryAnchorJobRow[] {
  return input.phase
    ? db.query(
      `SELECT * FROM session_memory_anchor_jobs
       WHERE project_key = ? AND phase = ?
       ORDER BY created_at, job_id`,
    ).all(input.projectKey, input.phase) as SessionMemoryAnchorJobRow[]
    : db.query(
      `SELECT * FROM session_memory_anchor_jobs
       WHERE project_key = ?
       ORDER BY created_at, job_id`,
    ).all(input.projectKey) as SessionMemoryAnchorJobRow[];
}

export function listSessionMemoryAnchorAttempts(
  db: Database,
  jobId: string,
): SessionMemoryAnchorAttemptRow[] {
  return db.query(
    `SELECT * FROM session_memory_anchor_attempts
     WHERE job_id = ?
     ORDER BY attempt_number, id`,
  ).all(jobId) as SessionMemoryAnchorAttemptRow[];
}

export function readIngestJobWithAnchor(
  db: Database,
  jobId: string,
): { job: IngestJobRow; anchor: SessionMemoryAnchorJobRow | null } | null {
  const job = db.query("SELECT * FROM ingest_jobs WHERE id = ?").get(jobId) as IngestJobRow | null;
  return job ? { job, anchor: getSessionMemoryAnchorJob(db, jobId) } : null;
}

export function createPreparingSessionMemoryAnchorJobInOpenTransaction(
  db: Database,
  input: {
    jobId: string;
    projectKey: string;
    ownerEpoch: number;
    now: string;
  },
): SessionMemoryAnchorJobRow {
  if (!db.inTransaction) throw new Error("SMC anchor companion creation requires an open transaction");
  if (isLegacyJobDenied(db, input.jobId)) {
    throw new Error(`session_memory_anchor_legacy_denied: ${input.jobId}`);
  }
  const fence = readFence(db, input.projectKey);
  if (
    !fence
    || fence.owner_id !== input.jobId
    || fence.owner_kind !== "anchor_job"
    || fence.phase !== "preparing"
    || fence.owner_epoch !== input.ownerEpoch
  ) {
    throw new Error("session_memory_anchor_fence_mismatch: preparing anchor does not own the project fence");
  }
  db.query(
    `INSERT INTO session_memory_anchor_jobs
      (job_id, project_key, phase, owner_epoch, reason_code, heartbeat_at, created_at, updated_at)
     VALUES (?, ?, 'preparing', ?, NULL, ?, ?, ?)`,
  ).run(input.jobId, input.projectKey, input.ownerEpoch, input.now, input.now, input.now);
  return getSessionMemoryAnchorJob(db, input.jobId)!;
}

export function heartbeatSessionMemoryAnchorJob(
  db: Database,
  input: {
    jobId: string;
    projectKey: string;
    expectedPhase: SessionMemoryAnchorJobPhase;
    expectedOwnerEpoch: number;
    now: string;
  },
): SessionMemoryAnchorJobCasResult {
  return inImmediateTransaction(db, () => {
    const current = diagnoseIdentity(db, input);
    if (current.kind === "rejected") return current;
    if (isLegacyJobDenied(db, input.jobId)) {
      return reject(db, input.jobId, input.projectKey, "session_memory_anchor_legacy_denied");
    }
    const anchorUpdated = db.query(
      `UPDATE session_memory_anchor_jobs
       SET heartbeat_at = ?, updated_at = ?
       WHERE job_id = ? AND project_key = ? AND phase = ? AND owner_epoch = ?`,
    ).run(
      input.now,
      input.now,
      input.jobId,
      input.projectKey,
      input.expectedPhase,
      input.expectedOwnerEpoch,
    );
    const fenceUpdated = db.query(
      `UPDATE project_session_mutation_fences
       SET heartbeat_at = ?
       WHERE project_key = ? AND owner_id = ? AND owner_kind = 'anchor_job'
         AND phase = ? AND owner_epoch = ?`,
    ).run(
      input.now,
      input.projectKey,
      input.jobId,
      input.expectedPhase,
      input.expectedOwnerEpoch,
    );
    if (anchorUpdated.changes !== 1 || fenceUpdated.changes !== 1) {
      throw new Error("Session Memory anchor heartbeat lost its paired anchor/fence CAS");
    }
    return currentRows(db, input.jobId, input.projectKey);
  });
}

export function recordSessionMemoryAnchorFollowupReason(
  db: Database,
  input: {
    jobId: string;
    projectKey: string;
    expectedOwnerEpoch: number;
    reasonCode: SessionMemoryAnchorReasonCode;
    now: string;
  },
): SessionMemoryAnchorJobCasResult {
  return inImmediateTransaction(db, () => {
    const current = diagnoseIdentity(db, {
      ...input,
      expectedPhase: "needs_followup",
    });
    if (current.kind === "rejected") return current;
    if (isLegacyJobDenied(db, input.jobId)) {
      return reject(db, input.jobId, input.projectKey, "session_memory_anchor_legacy_denied");
    }
    return withAnchorLifecycleAdmission(db, {
      operation: "anchor_resume",
      projectKey: input.projectKey,
      ownerId: input.jobId,
      ownerEpoch: input.expectedOwnerEpoch,
      phase: "needs_followup",
    }, () => {
      const anchorUpdated = db.query(
        `UPDATE session_memory_anchor_jobs
         SET reason_code = ?, updated_at = ?
         WHERE job_id = ? AND project_key = ? AND phase = 'needs_followup' AND owner_epoch = ?`,
      ).run(input.reasonCode, input.now, input.jobId, input.projectKey, input.expectedOwnerEpoch);
      if (anchorUpdated.changes !== 1) {
        throw new Error("Session Memory follow-up reason lost its anchor CAS");
      }
      updateCompatibilityProjection(db, {
        jobId: input.jobId,
        phase: "needs_followup",
        reasonCode: input.reasonCode,
        now: input.now,
      });
      return currentRows(db, input.jobId, input.projectKey);
    });
  });
}

export function transitionSessionMemoryAnchorJob(
  db: Database,
  input: {
    jobId: string;
    projectKey: string;
    expectedPhase: SessionMemoryAnchorJobPhase;
    expectedOwnerEpoch: number;
    nextPhase: SessionMemoryAnchorJobPhase;
    now: string;
    reasonCode?: SessionMemoryAnchorReasonCode | null;
    resumeAttempt?: {
      id: string;
      provider: string;
      providerSessionId?: string | null;
      processId?: number | null;
      details?: Record<string, unknown>;
    };
  },
): SessionMemoryAnchorJobCasResult {
  return inImmediateTransaction(db, () => {
    const current = diagnoseIdentity(db, input);
    if (current.kind === "rejected") return current;
    if (isLegacyJobDenied(db, input.jobId)) {
      return reject(db, input.jobId, input.projectKey, "session_memory_anchor_legacy_denied");
    }
    if (!isAllowedTransition(input.expectedPhase, input.nextPhase)) {
      return reject(db, input.jobId, input.projectKey, "session_memory_anchor_wrong_phase");
    }
    if (input.nextPhase === "abandoned") {
      return reject(db, input.jobId, input.projectKey, "session_memory_anchor_abandonment_service_required");
    }
    if (
      input.nextPhase === "running"
      && current.anchor.reason_code === "legacy_state_missing_smc_manifest"
    ) {
      return reject(db, input.jobId, input.projectKey, "session_memory_anchor_not_resumable");
    }
    if (
      input.expectedPhase === "needs_followup"
      && input.nextPhase === "running"
      && !input.resumeAttempt
    ) {
      return reject(db, input.jobId, input.projectKey, "session_memory_anchor_attempt_required");
    }

    const rotateEpoch = input.nextPhase === "needs_followup"
      || (input.expectedPhase === "needs_followup" && input.nextPhase === "running");
    const nextEpoch = input.expectedOwnerEpoch + (rotateEpoch ? 1 : 0);
    const reasonCode = input.reasonCode === undefined ? current.anchor.reason_code : input.reasonCode;
    return withAnchorLifecycleAdmission(db, {
      operation: transitionAdmissionOperation(input.expectedPhase, input.nextPhase),
      projectKey: input.projectKey,
      ownerId: input.jobId,
      ownerEpoch: input.expectedOwnerEpoch,
      phase: input.expectedPhase,
    }, () => {
      const anchorUpdated = db.query(
        `UPDATE session_memory_anchor_jobs
         SET phase = ?, owner_epoch = ?, reason_code = ?, heartbeat_at = ?, updated_at = ?
         WHERE job_id = ? AND project_key = ? AND phase = ? AND owner_epoch = ?`,
      ).run(
        input.nextPhase,
        nextEpoch,
        reasonCode,
        input.now,
        input.now,
        input.jobId,
        input.projectKey,
        input.expectedPhase,
        input.expectedOwnerEpoch,
      );
      const fenceUpdated = db.query(
        `UPDATE project_session_mutation_fences
         SET phase = ?, owner_epoch = ?, heartbeat_at = ?
         WHERE project_key = ? AND owner_id = ? AND owner_kind = 'anchor_job'
           AND phase = ? AND owner_epoch = ?`,
      ).run(
        input.nextPhase,
        nextEpoch,
        input.now,
        input.projectKey,
        input.jobId,
        input.expectedPhase,
        input.expectedOwnerEpoch,
      );
      if (anchorUpdated.changes !== 1 || fenceUpdated.changes !== 1) {
        throw new Error("Session Memory anchor transition lost its paired anchor/fence CAS");
      }

      updateCompatibilityProjection(db, {
        jobId: input.jobId,
        phase: input.nextPhase,
        reasonCode,
        now: input.now,
      });
      if (input.nextPhase === "running" && input.resumeAttempt) {
        appendSMCAttempt(db, {
          jobId: input.jobId,
          ownerEpoch: nextEpoch,
          now: input.now,
          attempt: input.resumeAttempt!,
        });
      } else {
        updateCurrentAttemptProjection(db, {
          jobId: input.jobId,
          ownerEpoch: input.expectedOwnerEpoch,
          phase: input.nextPhase,
          now: input.now,
        });
      }
      return currentRows(db, input.jobId, input.projectKey);
    });
  });
}

function appendSMCAttempt(
  db: Database,
  input: {
    jobId: string;
    ownerEpoch: number;
    now: string;
    attempt: NonNullable<Parameters<typeof transitionSessionMemoryAnchorJob>[1]["resumeAttempt"]>;
  },
): void {
  const row = db.query(
    `SELECT COALESCE(MAX(attempt_number), 0) AS attempt_number
     FROM session_memory_anchor_attempts
     WHERE job_id = ?`,
  ).get(input.jobId) as { attempt_number: number };
  db.query(
    `INSERT INTO session_memory_anchor_attempts
      (id, job_id, attempt_number, owner_epoch, attempt_kind, provider, provider_session_id,
       process_id, status, started_at, finished_at, details_json, created_at, updated_at)
     VALUES (?, ?, ?, ?, 'smc', ?, ?, ?, 'running', ?, NULL, ?, ?, ?)`,
  ).run(
    input.attempt.id,
    input.jobId,
    row.attempt_number + 1,
    input.ownerEpoch,
    input.attempt.provider,
    input.attempt.providerSessionId ?? null,
    input.attempt.processId ?? null,
    input.now,
    JSON.stringify(input.attempt.details ?? {}),
    input.now,
    input.now,
  );
}

export function completeSessionMemoryAnchorJobInOpenTransaction(
  db: Database,
  input: {
    jobId: string;
    projectKey: string;
    expectedOwnerEpoch: number;
    terminalReceiptId: string;
    outputCounts: Record<string, unknown>;
    terminalSummary: string | null;
    now: string;
  },
): SessionMemoryAnchorJobRow {
  if (!db.inTransaction) throw new Error("Session Memory anchor completion requires an open transaction");
  const current = diagnoseIdentity(db, {
    jobId: input.jobId,
    projectKey: input.projectKey,
    expectedPhase: "finalizing",
    expectedOwnerEpoch: input.expectedOwnerEpoch,
  });
  if (current.kind === "rejected") throw new Error(`session_memory_anchor_completion_rejected: ${current.code}`);
  const receipt = db.query(
    `SELECT id FROM smc_terminal_receipts
     WHERE job_id = ? AND id = ? AND receipt_kind = 'finalization' AND target_owner_epoch = ?`,
  ).get(input.jobId, input.terminalReceiptId, input.expectedOwnerEpoch);
  if (!receipt) throw new Error("session_memory_anchor_completion_receipt_missing");

  withAnchorLifecycleAdmission(db, {
    operation: "anchor_finalize",
    projectKey: input.projectKey,
    ownerId: input.jobId,
    ownerEpoch: input.expectedOwnerEpoch,
    phase: "finalizing",
  }, () => {
    const anchor = db.query(
      `UPDATE session_memory_anchor_jobs
       SET phase = 'completed', reason_code = NULL, heartbeat_at = ?, updated_at = ?
       WHERE job_id = ? AND project_key = ? AND phase = 'finalizing' AND owner_epoch = ?`,
    ).run(input.now, input.now, input.jobId, input.projectKey, input.expectedOwnerEpoch);
    const fence = db.query(
      `UPDATE project_session_mutation_fences
       SET phase = 'completed', heartbeat_at = ?, terminal_receipt_id = ?
       WHERE project_key = ? AND owner_id = ? AND owner_kind = 'anchor_job'
         AND phase = 'finalizing' AND owner_epoch = ?`,
    ).run(input.now, input.terminalReceiptId, input.projectKey, input.jobId, input.expectedOwnerEpoch);
    const job = db.query(
      `UPDATE ingest_jobs
       SET status = 'completed', output_counts_json = ?, terminal_summary = ?, error_json = NULL,
           finished_at = ?, updated_at = ?
       WHERE id = ? AND project_key = ?`,
    ).run(
      JSON.stringify(input.outputCounts),
      input.terminalSummary,
      input.now,
      input.now,
      input.jobId,
      input.projectKey,
    );
    if (anchor.changes !== 1 || fence.changes !== 1 || job.changes !== 1) {
      throw new Error("Session Memory anchor completion lost its exact CAS");
    }
    updateCurrentAttemptProjection(db, {
      jobId: input.jobId,
      ownerEpoch: input.expectedOwnerEpoch,
      phase: "completed",
      now: input.now,
    });
    const released = db.query(
      `DELETE FROM project_session_mutation_fences
       WHERE project_key = ? AND owner_id = ? AND owner_kind = 'anchor_job'
         AND phase = 'completed' AND owner_epoch = ? AND terminal_receipt_id = ?`,
    ).run(input.projectKey, input.jobId, input.expectedOwnerEpoch, input.terminalReceiptId);
    if (released.changes !== 1) throw new Error("Session Memory finalization fence release lost its exact CAS");
  });
  return getSessionMemoryAnchorJob(db, input.jobId)!;
}

function transitionAdmissionOperation(
  current: SessionMemoryAnchorJobPhase,
  next: SessionMemoryAnchorJobPhase,
): "anchor_resume" | "anchor_finalize" | "anchor_abandon" {
  if (next === "abandoned") return "anchor_abandon";
  if (current === "finalizing" && next === "completed") return "anchor_finalize";
  return "anchor_resume";
}

function diagnoseIdentity(
  db: Database,
  input: {
    jobId: string;
    projectKey: string;
    expectedPhase: SessionMemoryAnchorJobPhase;
    expectedOwnerEpoch: number;
  },
): SessionMemoryAnchorJobCasResult {
  if (readSessionMemoryMutationAuthorityMode(db) !== "smc_v1") {
    return reject(db, input.jobId, input.projectKey, "session_memory_authority_not_activated");
  }
  const anchor = getSessionMemoryAnchorJob(db, input.jobId);
  if (!anchor) return reject(db, input.jobId, input.projectKey, "session_memory_anchor_not_found");
  if (anchor.project_key !== input.projectKey) {
    return reject(db, input.jobId, input.projectKey, "session_memory_anchor_wrong_project");
  }
  if (anchor.owner_epoch !== input.expectedOwnerEpoch) {
    return reject(db, input.jobId, input.projectKey, "session_memory_anchor_stale_epoch");
  }
  if (anchor.phase !== input.expectedPhase) {
    return reject(db, input.jobId, input.projectKey, "session_memory_anchor_wrong_phase");
  }
  const fence = readFence(db, input.projectKey);
  if (
    !fence
    || fence.owner_id !== input.jobId
    || fence.owner_kind !== "anchor_job"
    || fence.owner_epoch !== input.expectedOwnerEpoch
    || fence.phase !== input.expectedPhase
  ) {
    return reject(db, input.jobId, input.projectKey, "session_memory_anchor_fence_mismatch");
  }
  return { kind: "updated", anchor, fence };
}

function updateCompatibilityProjection(
  db: Database,
  input: {
    jobId: string;
    phase: SessionMemoryAnchorJobPhase;
    reasonCode: SessionMemoryAnchorReasonCode | null;
    now: string;
  },
): void {
  const job = db.query("SELECT * FROM ingest_jobs WHERE id = ?").get(input.jobId) as IngestJobRow | null;
  if (!job) throw new Error(`Unknown ingest job: ${input.jobId}`);
  const status = compatibilityStatus(input.phase);
  const error = input.phase === "abandoned"
    ? { code: "abandoned", reason_code: input.reasonCode }
    : input.phase === "needs_followup" && input.reasonCode
      ? { code: input.reasonCode }
      : parseObject(job.error_json);
  db.query(
    `UPDATE ingest_jobs
     SET status = ?, error_json = ?, finished_at = ?, updated_at = ?
     WHERE id = ?`,
  ).run(
    status,
    Object.keys(error).length === 0 ? null : JSON.stringify(error),
    input.phase === "completed" || input.phase === "abandoned" ? input.now : job.finished_at,
    input.now,
    input.jobId,
  );
}

function updateCurrentAttemptProjection(
  db: Database,
  input: {
    jobId: string;
    ownerEpoch: number;
    phase: SessionMemoryAnchorJobPhase;
    now: string;
  },
): void {
  const status = attemptStatus(input.phase);
  if (!status) return;
  db.query(
    `UPDATE session_memory_anchor_attempts
     SET status = ?, finished_at = ?, updated_at = ?
     WHERE job_id = ? AND owner_epoch = ?`,
  ).run(
    status,
    status === "running" ? null : input.now,
    input.now,
    input.jobId,
    input.ownerEpoch,
  );
}

function compatibilityStatus(phase: SessionMemoryAnchorJobPhase): IngestJobStatus {
  switch (phase) {
    case "preparing": return "starting";
    case "running":
    case "finalizing": return "running";
    case "needs_followup": return "needs_followup";
    case "completed": return "completed";
    case "abandoned": return "failed";
  }
}

function attemptStatus(
  phase: SessionMemoryAnchorJobPhase,
): SessionMemoryAnchorAttemptRow["status"] | null {
  switch (phase) {
    case "running": return "running";
    case "needs_followup": return "needs_followup";
    case "completed": return "completed";
    case "abandoned": return "abandoned";
    case "preparing":
    case "finalizing": return null;
  }
}

function currentRows(
  db: Database,
  jobId: string,
  projectKey: string,
): Extract<SessionMemoryAnchorJobCasResult, { kind: "updated" }> {
  const anchor = getSessionMemoryAnchorJob(db, jobId);
  const fence = readFence(db, projectKey);
  if (!anchor || !fence) throw new Error("Session Memory anchor/fence pair disappeared");
  return { kind: "updated", anchor, fence };
}

function reject(
  db: Database,
  jobId: string,
  projectKey: string,
  code: SessionMemoryAnchorJobCasFailureCode,
): Extract<SessionMemoryAnchorJobCasResult, { kind: "rejected" }> {
  return {
    kind: "rejected",
    code,
    anchor: getSessionMemoryAnchorJob(db, jobId),
    fence: readFence(db, projectKey),
  };
}

function readFence(db: Database, projectKey: string): ProjectSessionMutationFenceRow | null {
  return (db.query(
    "SELECT * FROM project_session_mutation_fences WHERE project_key = ?",
  ).get(projectKey) as ProjectSessionMutationFenceRow | null) ?? null;
}

function isLegacyJobDenied(db: Database, jobId: string): boolean {
  return Boolean(db.query(
    "SELECT 1 FROM legacy_session_job_deny_identities WHERE job_id = ?",
  ).get(jobId));
}

function inImmediateTransaction<T>(db: Database, callback: () => T): T {
  return db.inTransaction ? callback() : db.transaction(callback).immediate();
}

function parseObject(value: string | null): Record<string, unknown> {
  if (!value) return {};
  try {
    const parsed = JSON.parse(value) as unknown;
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? parsed as Record<string, unknown>
      : {};
  } catch {
    return {};
  }
}

function isAllowedTransition(
  current: SessionMemoryAnchorJobPhase,
  next: SessionMemoryAnchorJobPhase,
): boolean {
  const allowed: Record<SessionMemoryAnchorJobPhase, readonly SessionMemoryAnchorJobPhase[]> = {
    preparing: ["running", "needs_followup", "abandoned"],
    running: ["needs_followup", "finalizing", "abandoned"],
    needs_followup: ["running", "abandoned"],
    finalizing: ["needs_followup", "completed", "abandoned"],
    completed: [],
    abandoned: [],
  };
  return allowed[current].includes(next);
}
