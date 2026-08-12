import type { SMCTriggerReason } from "../session-maintenance/evidence-selection.ts";

export type SessionMaintenanceWakeKind =
  | "manual"
  | "capture"
  | "session_start"
  | "explicit_maintenance"
  | "index_request";

export type SessionMaintenanceEligibility = Readonly<{
  wake_kind: SessionMaintenanceWakeKind;
  trigger_reason: SMCTriggerReason | null;
  index: Readonly<{ due: boolean; pending_count: number }>;
  evidence: Readonly<{
    due: boolean;
    queued_count: number;
    oldest_inserted_at: string | null;
    count_threshold_reached: boolean;
    max_age_reached: boolean;
  }>;
  audit: Readonly<{ due: boolean; due_count: number }>;
  curation_due: boolean;
}>;

export function evaluateSessionMaintenanceEligibility(input: {
  wake_kind: SessionMaintenanceWakeKind;
  queued_content_count: number;
  oldest_content_inserted_at: string | null;
  pending_index_count: number;
  due_audit_count: number;
  min_content_count: number;
  max_pending_age_ms: number;
  now: Date;
}): SessionMaintenanceEligibility {
  const countReached = input.queued_content_count >= input.min_content_count;
  const oldest = input.oldest_content_inserted_at === null ? null : Date.parse(input.oldest_content_inserted_at);
  const maxAgeReached = oldest !== null && Number.isFinite(oldest)
    && input.now.getTime() - oldest >= input.max_pending_age_ms;
  const manual = input.wake_kind === "manual";
  const sessionStart = input.wake_kind === "session_start";
  const automaticEvidence = countReached || maxAgeReached;
  const evidenceDue = input.queued_content_count > 0
    && (manual || sessionStart || automaticEvidence);
  const curationWake = manual || sessionStart || automaticEvidence;
  const auditDue = input.due_audit_count > 0 && curationWake;
  const triggerReason: SMCTriggerReason | null = evidenceDue
    ? manual ? "manual" : sessionStart ? "session_start" : countReached ? "content_threshold" : "max_pending_age"
    : auditDue
      ? manual ? "manual_audit" : sessionStart ? "session_start" : countReached ? "content_threshold" : "max_pending_age"
      : null;
  return {
    wake_kind: input.wake_kind,
    trigger_reason: triggerReason,
    index: { due: input.pending_index_count > 0, pending_count: input.pending_index_count },
    evidence: {
      due: evidenceDue,
      queued_count: input.queued_content_count,
      oldest_inserted_at: input.oldest_content_inserted_at,
      count_threshold_reached: countReached,
      max_age_reached: maxAgeReached,
    },
    audit: { due: auditDue, due_count: input.due_audit_count },
    curation_due: evidenceDue || auditDue,
  };
}
