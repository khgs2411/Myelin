import { expect, test } from "bun:test";
import { evaluateSessionMaintenanceEligibility } from "../../src/maintenance/session-maintenance-eligibility.ts";

const now = new Date("2026-08-11T12:00:00.000Z");

function evaluate(overrides: Partial<Parameters<typeof evaluateSessionMaintenanceEligibility>[0]> = {}) {
  return evaluateSessionMaintenanceEligibility({
    wake_kind: "capture",
    queued_content_count: 0,
    oldest_content_inserted_at: null,
    pending_index_count: 0,
    due_audit_count: 0,
    min_content_count: 60,
    max_pending_age_ms: 24 * 60 * 60 * 1000,
    now,
    ...overrides,
  });
}

test("content count and observed age are independent automatic OR conditions", () => {
  expect(evaluate({ queued_content_count: 59 }).curation_due).toBeFalse();
  expect(evaluate({ queued_content_count: 60 })).toMatchObject({
    trigger_reason: "content_threshold",
    evidence: { due: true, count_threshold_reached: true },
  });
  expect(evaluate({
    queued_content_count: 1,
    oldest_content_inserted_at: "2026-08-10T12:00:00.000Z",
  })).toMatchObject({
    trigger_reason: "max_pending_age",
    evidence: { due: true, max_age_reached: true },
  });
});

test("manual and session.start flush below threshold without inventing evidence", () => {
  expect(evaluate({ wake_kind: "manual", queued_content_count: 1 })).toMatchObject({
    trigger_reason: "manual",
    evidence: { due: true },
  });
  expect(evaluate({ wake_kind: "session_start", queued_content_count: 1 })).toMatchObject({
    trigger_reason: "session_start",
    evidence: { due: true },
  });
  expect(evaluate({ wake_kind: "session_start" })).toMatchObject({
    trigger_reason: null,
    curation_due: false,
  });
});

test("audit and indexing are independent workloads", () => {
  expect(evaluate({ wake_kind: "manual", due_audit_count: 2, pending_index_count: 3 })).toMatchObject({
    trigger_reason: "manual_audit",
    evidence: { due: false },
    audit: { due: true, due_count: 2 },
    index: { due: true, pending_count: 3 },
    curation_due: true,
  });
  expect(evaluate({ wake_kind: "index_request", pending_index_count: 1, due_audit_count: 2 })).toMatchObject({
    trigger_reason: null,
    audit: { due: false },
    index: { due: true },
    curation_due: false,
  });
});

