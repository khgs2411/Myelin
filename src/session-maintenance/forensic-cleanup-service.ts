import type { Database } from "bun:sqlite";
import { getSessionMemoryAnchorJob } from "./job-lifecycle.ts";
import {
  isForensicCleanupEligible,
  readSMCTerminalReceipt,
} from "./terminal-receipts.ts";

export type CleanupSessionMaintenanceForensicsResult =
  | { kind: "disabled"; code: "smc_forensic_cleanup_retention_not_configured" }
  | {
      kind: "blocked";
      code:
        | "smc_forensic_cleanup_invalid_retention"
        | "smc_forensic_cleanup_anchor_not_found"
        | "smc_forensic_cleanup_wrong_project"
        | "smc_forensic_cleanup_stale_epoch"
        | "smc_forensic_cleanup_receipt_missing"
        | "smc_forensic_cleanup_receipt_mismatch"
        | "smc_forensic_cleanup_receipt_invalid"
        | "smc_forensic_cleanup_not_eligible";
    }
  | { kind: "cleaned"; deleted_rows: number };

const FORENSIC_DETAIL_TABLES = [
  "smc_overlay_search_indexes",
  "smc_overlay_records",
  "smc_overlay_revisions",
  "smc_action_journal",
  "smc_coverage_receipts",
  "smc_curator_fetch_receipts",
  "smc_curator_action_charges",
  "smc_curator_batch_channel_plans",
  "smc_budget_grants",
  "smc_overlay_state",
  "smc_memory_snapshot_contexts",
  "smc_memory_snapshot_links",
  "smc_memory_snapshot_search_texts",
  "smc_memory_snapshot_vectors",
  "smc_retrieval_snapshot_completeness",
  "smc_evidence_batch_members",
  "smc_audit_batch_members",
  "smc_work_batches",
  "smc_evidence_snapshot",
  "smc_no_agent_intents",
  "smc_memory_snapshot",
  "smc_manifests",
] as const;

export function cleanupSessionMaintenanceForensics(
  db: Database,
  input: {
    job_id: string;
    project_key: string;
    expected_owner_epoch: number;
    terminal_receipt_digest: string;
    now: Date;
    forensic_retention_ms: number | null;
    failure_injection?: { before_commit?: () => void };
  },
): CleanupSessionMaintenanceForensicsResult {
  if (input.forensic_retention_ms === null) {
    return { kind: "disabled", code: "smc_forensic_cleanup_retention_not_configured" };
  }
  if (!Number.isSafeInteger(input.forensic_retention_ms) || input.forensic_retention_ms < 0) {
    return { kind: "blocked", code: "smc_forensic_cleanup_invalid_retention" };
  }
  const retentionMs = input.forensic_retention_ms;
  if (!Number.isFinite(input.now.getTime())) {
    return { kind: "blocked", code: "smc_forensic_cleanup_not_eligible" };
  }
  if (db.inTransaction) throw new Error("SMC forensic cleanup must own its BEGIN IMMEDIATE transaction");
  return db.transaction(() => {
    const anchor = getSessionMemoryAnchorJob(db, input.job_id);
    if (!anchor) return { kind: "blocked", code: "smc_forensic_cleanup_anchor_not_found" } as const;
    if (anchor.project_key !== input.project_key) {
      return { kind: "blocked", code: "smc_forensic_cleanup_wrong_project" } as const;
    }
    if (anchor.owner_epoch !== input.expected_owner_epoch) {
      return { kind: "blocked", code: "smc_forensic_cleanup_stale_epoch" } as const;
    }
    let receipt;
    try {
      receipt = readSMCTerminalReceipt(db, input.job_id);
    } catch {
      return { kind: "blocked", code: "smc_forensic_cleanup_receipt_invalid" } as const;
    }
    if (!receipt) return { kind: "blocked", code: "smc_forensic_cleanup_receipt_missing" } as const;
    if (receipt.receipt_digest !== input.terminal_receipt_digest) {
      return { kind: "blocked", code: "smc_forensic_cleanup_receipt_mismatch" } as const;
    }
    if (!isForensicCleanupEligible({
      receipt,
      anchor,
      now: input.now,
      retention_ms: retentionMs,
    })) return { kind: "blocked", code: "smc_forensic_cleanup_not_eligible" } as const;

    let deletedRows = 0;
    for (const table of FORENSIC_DETAIL_TABLES) {
      deletedRows += db.query(`DELETE FROM ${table} WHERE job_id = ?`).run(input.job_id).changes;
    }
    input.failure_injection?.before_commit?.();
    return { kind: "cleaned", deleted_rows: deletedRows } as const;
  }).immediate();
}
