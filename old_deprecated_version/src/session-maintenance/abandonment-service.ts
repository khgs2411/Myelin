import { createHash } from "node:crypto";
import type { Database } from "bun:sqlite";
import { stableJson } from "../runtime/json.ts";
import { withAnchorLifecycleAdmission } from "../memory/session-memory-write-firewall.ts";
import { getSessionMemoryAnchorJob } from "./job-lifecycle.ts";
import {
  legacyQuarantineTerminalBasis,
  readSMCTerminalReceipt,
  writeSMCTerminalReceiptInOpenTransaction,
  type SMCTerminalBasis,
  type SMCTerminalReceipt,
} from "./terminal-receipts.ts";

export type AbandonSessionMaintenanceResult =
  | { kind: "abandoned" | "replayed"; receipt: SMCTerminalReceipt; released_lease_count: number }
  | {
      kind: "rejected";
      code:
        | "smc_abandon_anchor_not_found"
        | "smc_abandon_wrong_project"
        | "smc_abandon_stale_epoch"
        | "smc_abandon_wrong_phase"
        | "smc_abandon_fence_mismatch"
        | "smc_abandon_terminal_conflict"
        | "smc_abandon_basis_invalid"
        | "smc_abandon_request_conflict";
    };

type AbandonmentReceiptResult = {
  outcome: "abandoned";
  operator_id: string;
  request_id: string;
  reason: string;
  released_lease_count: number;
};

export function abandonSessionMaintenanceAnchor(
  db: Database,
  input: {
    job_id: string;
    project_key: string;
    expected_owner_epoch: number;
    receipt_id: string;
    request_id: string;
    operator_id: string;
    reason: string;
    now: string;
    failure_injection?: { before_commit?: () => void };
  },
): AbandonSessionMaintenanceResult {
  if (db.inTransaction) throw new Error("SMC abandonment must own its BEGIN IMMEDIATE transaction");
  requireNonEmpty(input.request_id, "request_id");
  requireNonEmpty(input.operator_id, "operator_id");
  requireNonEmpty(input.reason, "reason");
  return db.transaction(() => {
    const anchor = getSessionMemoryAnchorJob(db, input.job_id);
    if (!anchor) return rejected("smc_abandon_anchor_not_found");
    if (anchor.project_key !== input.project_key) return rejected("smc_abandon_wrong_project");
    const existing = readSMCTerminalReceipt(db, input.job_id);
    if (existing) return replayExisting(existing, input);

    if (anchor.owner_epoch !== input.expected_owner_epoch) return rejected("smc_abandon_stale_epoch");
    if (!["preparing", "running", "needs_followup", "finalizing"].includes(anchor.phase)) {
      return rejected("smc_abandon_wrong_phase");
    }
    const fence = db.query(
      `SELECT owner_id, owner_epoch, owner_kind, phase
       FROM project_session_mutation_fences WHERE project_key = ?`,
    ).get(input.project_key) as {
      owner_id: string;
      owner_epoch: number;
      owner_kind: string;
      phase: string;
    } | null;
    if (
      !fence
      || fence.owner_id !== input.job_id
      || fence.owner_epoch !== input.expected_owner_epoch
      || fence.owner_kind !== "anchor_job"
      || fence.phase !== anchor.phase
    ) return rejected("smc_abandon_fence_mismatch");

    const basis = resolveTerminalBasis(db, input);
    if (!basis) return rejected("smc_abandon_basis_invalid");
    const released = db.query(
      `SELECT count(*) AS count FROM experience_event_tombstones
       WHERE ingest_job_id = ? AND project_key = ? AND state = 'claimed'`,
    ).get(input.job_id, input.project_key) as { count: number };
    const result: AbandonmentReceiptResult = {
      outcome: "abandoned",
      operator_id: input.operator_id,
      request_id: input.request_id,
      reason: input.reason,
      released_lease_count: released.count,
    };
    const receipt = writeSMCTerminalReceiptInOpenTransaction(db, {
      id: input.receipt_id,
      job_id: input.job_id,
      project_key: input.project_key,
      receipt_kind: "abandonment",
      terminal_basis: basis,
      target_owner_epoch: input.expected_owner_epoch,
      result,
      created_at: input.now,
    });

    const trustedOwner = trustedAbandonmentOwner(input);
    const transferred = db.query(
      `UPDATE project_session_mutation_fences
       SET owner_id = ?, heartbeat_at = ?
       WHERE project_key = ? AND owner_id = ? AND owner_kind = 'anchor_job'
         AND owner_epoch = ? AND phase = ?`,
    ).run(
      trustedOwner,
      input.now,
      input.project_key,
      input.job_id,
      input.expected_owner_epoch,
      anchor.phase,
    );
    if (transferred.changes !== 1) throw new Error("SMC abandonment lost the trusted-authority fence transfer CAS");

    withAnchorLifecycleAdmission(db, {
      operation: "anchor_abandon",
      projectKey: input.project_key,
      ownerId: trustedOwner,
      ownerEpoch: input.expected_owner_epoch,
      phase: anchor.phase,
      targetId: input.job_id,
    }, () => {
      const leases = db.query(
        `UPDATE experience_event_tombstones
         SET state = 'unfinished', finalized_at = ?, terminal_decision = 'smc.abandoned',
             output_references_json = '[]'
         WHERE ingest_job_id = ? AND project_key = ? AND state = 'claimed'`,
      ).run(input.now, input.job_id, input.project_key);
      if (leases.changes !== released.count) {
        throw new Error("SMC abandonment lease release count changed inside the transaction");
      }
      const job = db.query(
        `UPDATE ingest_jobs
         SET status = 'failed', error_json = ?, terminal_summary = ?, finished_at = ?, updated_at = ?
         WHERE id = ? AND project_key = ?`,
      ).run(
        stableJson({ code: "smc_abandoned_by_operator", detail: input.reason }),
        `Session Memory anchor abandoned: ${input.reason}`,
        input.now,
        input.now,
        input.job_id,
        input.project_key,
      );
      if (job.changes !== 1) throw new Error("SMC abandonment lost the compatibility job target");
    });

    const anchorUpdated = db.query(
      `UPDATE session_memory_anchor_jobs
       SET phase = 'abandoned', reason_code = ?, heartbeat_at = ?, updated_at = ?
       WHERE job_id = ? AND project_key = ? AND owner_epoch = ? AND phase = ?`,
    ).run(
      "smc_abandoned_by_operator",
      input.now,
      input.now,
      input.job_id,
      input.project_key,
      input.expected_owner_epoch,
      anchor.phase,
    );
    if (anchorUpdated.changes !== 1) throw new Error("SMC abandonment lost the anchor CAS");
    db.query(
      `UPDATE session_memory_anchor_attempts
       SET status = 'abandoned', finished_at = ?, updated_at = ?
       WHERE job_id = ? AND owner_epoch = ?`,
    ).run(input.now, input.now, input.job_id, input.expected_owner_epoch);
    const terminalFence = db.query(
      `UPDATE project_session_mutation_fences
       SET phase = 'abandoned', terminal_receipt_id = ?, heartbeat_at = ?
       WHERE project_key = ? AND owner_id = ? AND owner_epoch = ? AND phase = ?`,
    ).run(receipt.id, input.now, input.project_key, trustedOwner, input.expected_owner_epoch, anchor.phase);
    if (terminalFence.changes !== 1) throw new Error("SMC abandonment lost the terminal fence CAS");
    const releasedFence = db.query(
      `DELETE FROM project_session_mutation_fences
       WHERE project_key = ? AND owner_id = ? AND owner_epoch = ? AND phase = 'abandoned'`,
    ).run(input.project_key, trustedOwner, input.expected_owner_epoch);
    if (releasedFence.changes !== 1) throw new Error("SMC abandonment failed to release the trusted fence");
    input.failure_injection?.before_commit?.();
    return { kind: "abandoned", receipt, released_lease_count: released.count } as const;
  }).immediate();
}

function resolveTerminalBasis(
  db: Database,
  input: { job_id: string; project_key: string },
): SMCTerminalBasis | null {
  const manifest = db.query(
    "SELECT manifest_digest FROM smc_manifests WHERE job_id = ? AND project_key = ?",
  ).get(input.job_id, input.project_key) as { manifest_digest: `sha256:${string}` } | null;
  return manifest
    ? { kind: "smc_manifest", digest: manifest.manifest_digest }
    : legacyQuarantineTerminalBasis(db, input);
}

function replayExisting(
  receipt: SMCTerminalReceipt,
  input: Parameters<typeof abandonSessionMaintenanceAnchor>[1],
): AbandonSessionMaintenanceResult {
  if (receipt.receipt_kind !== "abandonment" || receipt.target_owner_epoch !== input.expected_owner_epoch) {
    return rejected("smc_abandon_terminal_conflict");
  }
  const result = receipt.result as Partial<AbandonmentReceiptResult> | null;
  if (
    !result
    || result.outcome !== "abandoned"
    || result.operator_id !== input.operator_id
    || result.request_id !== input.request_id
    || result.reason !== input.reason
    || !Number.isSafeInteger(result.released_lease_count)
  ) return rejected("smc_abandon_request_conflict");
  return {
    kind: "replayed",
    receipt,
    released_lease_count: result.released_lease_count as number,
  };
}

function trustedAbandonmentOwner(input: {
  job_id: string;
  project_key: string;
  request_id: string;
  operator_id: string;
}): string {
  const suffix = createHash("sha256").update(stableJson(input), "utf8").digest("hex").slice(0, 32);
  return `smc-abandonment-service:${suffix}`;
}

function requireNonEmpty(value: string, label: string): void {
  if (value.trim() === "") throw new Error(`SMC abandonment ${label} must not be empty`);
}

function rejected(code: Extract<AbandonSessionMaintenanceResult, { kind: "rejected" }>["code"]):
  Extract<AbandonSessionMaintenanceResult, { kind: "rejected" }> {
  return { kind: "rejected", code };
}
