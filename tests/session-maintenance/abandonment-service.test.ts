import { afterEach, beforeEach, expect, test } from "bun:test";
import { openMemoryDbAt, type MemoryDb } from "../../src/memory/db.ts";
import { leaseExperienceEvents, reconcileTerminalExperienceEventReplays } from "../../src/memory/experience.ts";
import { createIngestJob, updateIngestJobStatus } from "../../src/ingest/jobs.ts";
import { acquireProjectSessionMutationFence } from "../../src/memory/project-session-mutation-fence.ts";
import { withAnchorLifecycleAdmission } from "../../src/memory/session-memory-write-firewall.ts";
import { abandonSessionMaintenanceAnchor } from "../../src/session-maintenance/abandonment-service.ts";
import { AuthorityActivationService } from "../../src/session-maintenance/authority-activation-service.ts";
import { transitionSessionMemoryAnchorJob } from "../../src/session-maintenance/job-lifecycle.ts";
import {
  legacyQuarantineTerminalBasis,
  writeSMCTerminalReceiptInOpenTransaction,
} from "../../src/session-maintenance/terminal-receipts.ts";
import {
  defaultSMCGoverningIdentities,
  planSessionMaintenanceEvidence,
} from "../../src/session-maintenance/evidence-selection.ts";
import {
  activateSMCAuthority,
  configureSMCTestContract,
  planEvidence,
  prepare,
  seedEvidence,
  seedIndexedMemory,
  SMC_TEST_NOW,
} from "../helpers/smc-preparation.ts";

let db: MemoryDb;

beforeEach(() => {
  db = openMemoryDbAt(":memory:");
  configureSMCTestContract(db);
  seedIndexedMemory(db, { id: "memory-base" });
});

afterEach(() => db.close());

test("manifest-backed abandonment is idempotent, preserves evidence, and permits exactly one fresh claimed lease", () => {
  seedEvidence(db, "evt-abandon");
  activateSMCAuthority(db);
  const prepared = prepare(db, planEvidence(db, "job-abandon"));
  if (prepared.kind !== "prepared") throw new Error(JSON.stringify(prepared));

  const input = {
    job_id: prepared.manifest.job_id,
    project_key: prepared.manifest.project_key,
    expected_owner_epoch: 1,
    receipt_id: "receipt-abandon",
    request_id: "request-abandon",
    operator_id: "operator-1",
    reason: "operator_cancelled",
    now: "2026-08-11T12:05:00.000Z",
  };
  const abandoned = abandonSessionMaintenanceAnchor(db, input);
  expect(abandoned).toMatchObject({
    kind: "abandoned",
    released_lease_count: 1,
    receipt: { terminal_basis_kind: "smc_manifest", target_owner_epoch: 1 },
  });
  const replayed = abandonSessionMaintenanceAnchor(db, input);
  expect(replayed).toMatchObject({ kind: "replayed", released_lease_count: 1 });
  if (abandoned.kind !== "abandoned" || replayed.kind !== "replayed") throw new Error("unexpected abandonment result");
  expect(replayed.receipt).toEqual(abandoned.receipt);
  expect(abandonSessionMaintenanceAnchor(db, { ...input, project_key: "wrong-project" }))
    .toEqual({ kind: "rejected", code: "smc_abandon_wrong_project" });
  expect(db.query("SELECT phase FROM session_memory_anchor_jobs WHERE job_id = ?").get(input.job_id))
    .toEqual({ phase: "abandoned" });
  expect(db.query("SELECT 1 FROM project_session_mutation_fences WHERE project_key = 'demo'").get()).toBeNull();
  expect(db.query("SELECT state, ingest_job_id FROM experience_event_tombstones WHERE original_event_id = 'evt-abandon'").get())
    .toEqual({ state: "unfinished", ingest_job_id: "job-abandon" });
  expect(db.query("SELECT id FROM experience_events WHERE id = 'evt-abandon'").get()).toEqual({ id: "evt-abandon" });
  expect(reconcileTerminalExperienceEventReplays(db, "demo")).toBe(0);
  expect(db.query("SELECT state FROM experience_event_tombstones WHERE original_event_id = 'evt-abandon'").get())
    .toEqual({ state: "unfinished" });
  expect(db.query("SELECT id FROM experience_events WHERE id = 'evt-abandon'").get()).toEqual({ id: "evt-abandon" });

  const nextPlan = planEvidence(db, "job-next");
  expect(nextPlan.evidence.map((item) => item.source_id)).toEqual(["evt-abandon"]);
  const next = prepare(db, nextPlan);
  if (next.kind !== "prepared") throw new Error(JSON.stringify(next));
  expect(db.query(
    "SELECT state, count(*) AS count FROM experience_event_tombstones WHERE original_event_id = 'evt-abandon' GROUP BY state ORDER BY state",
  ).all()).toEqual([
    { state: "claimed", count: 1 },
    { state: "unfinished", count: 1 },
  ]);
  expect(planEvidenceResultKind("job-third")).toBe("no_work");
});

test("a permanently denied no-manifest legacy job is abandoned by distinct trusted authority without reviving it", () => {
  seedEvidence(db, "evt-legacy");
  createIngestJob(db, {
    id: "legacy-job",
    project_key: "demo",
    provider: "codex",
    input: {},
    now: SMC_TEST_NOW,
  });
  leaseExperienceEvents(db, {
    ingest_job_id: "legacy-job",
    project_key: "demo",
    limit: 1,
    claimed_at: SMC_TEST_NOW,
    tombstone_id_for: () => "legacy-tombstone",
  });
  const activation = new AuthorityActivationService({
    now: () => new Date("2026-08-11T12:01:00.000Z"),
  }).activate(db);
  expect(activation.kind).toBe("activated");
  expect(db.query("SELECT 1 FROM smc_manifests WHERE job_id = 'legacy-job'").get()).toBeNull();
  const legacyBasis = legacyQuarantineTerminalBasis(db, { job_id: "legacy-job", project_key: "demo" });
  if (!legacyBasis) throw new Error("missing legacy terminal basis");
  expect(() => db.transaction(() => writeSMCTerminalReceiptInOpenTransaction(db, {
    id: "receipt-invalid-legacy",
    job_id: "legacy-job",
    project_key: "demo",
    receipt_kind: "abandonment",
    terminal_basis: { ...legacyBasis, digest: `sha256:${"0".repeat(64)}` },
    target_owner_epoch: 1,
    result: { outcome: "abandoned" },
    created_at: "2026-08-11T12:02:00.000Z",
  })).immediate()).toThrow("smc_terminal_receipt_identity_mismatch");

  const abandoned = abandonSessionMaintenanceAnchor(db, {
    job_id: "legacy-job",
    project_key: "demo",
    expected_owner_epoch: 1,
    receipt_id: "receipt-legacy-abandon",
    request_id: "request-legacy-abandon",
    operator_id: "operator-1",
    reason: "legacy_incompatible",
    now: "2026-08-11T12:02:00.000Z",
  });
  expect(abandoned).toMatchObject({
    kind: "abandoned",
    receipt: { terminal_basis_kind: "legacy_quarantine" },
  });
  expect(db.query("SELECT reason_code FROM legacy_session_job_deny_identities WHERE job_id = 'legacy-job'").get())
    .toEqual({ reason_code: "pre_smc_job_identity" });
  expect(db.query("SELECT state FROM experience_event_tombstones WHERE id = 'legacy-tombstone'").get())
    .toEqual({ state: "unfinished" });
  expect(db.query("SELECT id FROM experience_events WHERE id = 'evt-legacy'").get()).toEqual({ id: "evt-legacy" });

  expect(() => acquireProjectSessionMutationFence(db, {
    projectKey: "demo",
    ownerId: "legacy-job",
    ownerKind: "anchor_job",
    phase: "preparing",
    now: "2026-08-11T12:03:00.000Z",
  })).toThrow("session_memory_legacy_authority_rejected");

  const freshPlan = planEvidence(db, "fresh-owner");
  const fresh = prepare(db, freshPlan);
  if (fresh.kind !== "prepared") throw new Error(JSON.stringify(fresh));
  expect(fresh.manifest.job_id).toBe("fresh-owner");
  expect(db.query("SELECT owner_id FROM project_session_mutation_fences WHERE project_key = 'demo'").get())
    .toEqual({ owner_id: "fresh-owner" });
  expect(db.query("SELECT count(*) AS count FROM legacy_session_job_deny_identities WHERE job_id = 'legacy-job'").get())
    .toEqual({ count: 1 });
});

test("abandonment rollback preserves the active anchor, claimed lease, and absence of a terminal receipt", () => {
  seedEvidence(db, "evt-rollback");
  activateSMCAuthority(db);
  const prepared = prepare(db, planEvidence(db, "job-rollback"));
  if (prepared.kind !== "prepared") throw new Error(JSON.stringify(prepared));
  expect(() => abandonSessionMaintenanceAnchor(db, {
    job_id: prepared.manifest.job_id,
    project_key: prepared.manifest.project_key,
    expected_owner_epoch: 1,
    receipt_id: "receipt-rollback",
    request_id: "request-rollback",
    operator_id: "operator-1",
    reason: "rollback",
    now: "2026-08-11T12:05:00.000Z",
    failure_injection: { before_commit: () => { throw new Error("injected rollback"); } },
  })).toThrow("injected rollback");
  expect(db.query("SELECT phase FROM session_memory_anchor_jobs WHERE job_id = ?").get(prepared.manifest.job_id))
    .toEqual({ phase: "preparing" });
  expect(db.query("SELECT state FROM experience_event_tombstones WHERE original_event_id = 'evt-rollback'").get())
    .toEqual({ state: "claimed" });
  expect(db.query("SELECT 1 FROM smc_terminal_receipts WHERE job_id = ?").get(prepared.manifest.job_id)).toBeNull();
});

test("anchor abandonment admission cannot mutate a different compatibility job", () => {
  createIngestJob(db, {
    id: "other-completed-job",
    project_key: "demo",
    provider: "codex",
    input: {},
    now: SMC_TEST_NOW,
  });
  updateIngestJobStatus(db, {
    id: "other-completed-job",
    status: "completed",
    finished_at: SMC_TEST_NOW,
    updated_at: SMC_TEST_NOW,
  });
  seedEvidence(db, "evt-exact-target");
  activateSMCAuthority(db);
  const prepared = prepare(db, planEvidence(db, "job-exact-target"));
  if (prepared.kind !== "prepared") throw new Error(JSON.stringify(prepared));
  expect(transitionSessionMemoryAnchorJob(db, {
    jobId: prepared.manifest.job_id,
    projectKey: "demo",
    expectedPhase: "preparing",
    expectedOwnerEpoch: 1,
    nextPhase: "abandoned",
    now: SMC_TEST_NOW,
  })).toMatchObject({ kind: "rejected", code: "session_memory_anchor_abandonment_service_required" });
  db.query(
    `UPDATE project_session_mutation_fences SET owner_id = 'smc-abandonment-service:test'
     WHERE project_key = 'demo' AND owner_id = ?`,
  ).run(prepared.manifest.job_id);

  expect(() => withAnchorLifecycleAdmission(db, {
    operation: "anchor_abandon",
    projectKey: "demo",
    ownerId: "smc-abandonment-service:test",
    ownerEpoch: 1,
    phase: "preparing",
    targetId: "wrong-target",
  }, () => undefined)).toThrow("session_memory_legacy_write_denied:authority_mismatch");
  expect(() => withAnchorLifecycleAdmission(db, {
    operation: "anchor_abandon",
    projectKey: "demo",
    ownerId: "smc-abandonment-service:test",
    ownerEpoch: 1,
    phase: "preparing",
    targetId: prepared.manifest.job_id,
  }, () => {
    db.query("UPDATE ingest_jobs SET terminal_summary = 'wrong target' WHERE id = 'other-completed-job'").run();
  })).toThrow("session_memory_legacy_write_denied:target_mismatch");
  expect(db.query("SELECT terminal_summary FROM ingest_jobs WHERE id = 'other-completed-job'").get())
    .toEqual({ terminal_summary: null });
});

test("a durable finalization receipt wins atomically over a later abandonment request", () => {
  seedEvidence(db, "evt-terminal-race");
  activateSMCAuthority(db);
  const prepared = prepare(db, planEvidence(db, "job-terminal-race"));
  if (prepared.kind !== "prepared") throw new Error(JSON.stringify(prepared));
  db.query(
    `INSERT INTO session_memory_anchor_attempts
      (id, job_id, attempt_number, owner_epoch, attempt_kind, provider, status,
       details_json, created_at, updated_at)
     VALUES ('attempt-terminal-race', ?, 1, 1, 'smc', 'codex', 'running', '{}', ?, ?)`,
  ).run(prepared.manifest.job_id, SMC_TEST_NOW, SMC_TEST_NOW);
  const running = transitionSessionMemoryAnchorJob(db, {
    jobId: prepared.manifest.job_id,
    projectKey: "demo",
    expectedPhase: "preparing",
    expectedOwnerEpoch: 1,
    nextPhase: "running",
    now: SMC_TEST_NOW,
  });
  if (running.kind !== "updated") throw new Error(JSON.stringify(running));
  const finalizing = transitionSessionMemoryAnchorJob(db, {
    jobId: prepared.manifest.job_id,
    projectKey: "demo",
    expectedPhase: "running",
    expectedOwnerEpoch: 1,
    nextPhase: "finalizing",
    now: SMC_TEST_NOW,
  });
  if (finalizing.kind !== "updated") throw new Error(JSON.stringify(finalizing));
  db.transaction(() => writeSMCTerminalReceiptInOpenTransaction(db, {
    id: "receipt-terminal-race",
    job_id: prepared.manifest.job_id,
    project_key: "demo",
    receipt_kind: "finalization",
    terminal_basis: {
      kind: "smc_manifest",
      digest: prepared.manifest.manifest_digest as `sha256:${string}`,
    },
    target_owner_epoch: 1,
    result: { outcome: "completed" },
    created_at: SMC_TEST_NOW,
  })).immediate();

  expect(abandonSessionMaintenanceAnchor(db, {
    job_id: prepared.manifest.job_id,
    project_key: "demo",
    expected_owner_epoch: 1,
    receipt_id: "receipt-abandon-loser",
    request_id: "request-abandon-loser",
    operator_id: "operator-1",
    reason: "operator_cancelled",
    now: "2026-08-11T12:01:00.000Z",
  })).toEqual({ kind: "rejected", code: "smc_abandon_terminal_conflict" });
  expect(db.query("SELECT receipt_kind FROM smc_terminal_receipts WHERE job_id = ?").get(prepared.manifest.job_id))
    .toEqual({ receipt_kind: "finalization" });
  expect(db.query("SELECT phase FROM session_memory_anchor_jobs WHERE job_id = ?").get(prepared.manifest.job_id))
    .toEqual({ phase: "finalizing" });
  expect(db.query("SELECT state FROM experience_event_tombstones WHERE original_event_id = 'evt-terminal-race'").get())
    .toEqual({ state: "claimed" });
});

function planEvidenceResultKind(jobId: string): string {
  const result = planSessionMaintenanceEvidence(db, {
    anchor_job_id: jobId,
    project_key: "demo",
    trigger_reason: "manual",
    governing_identities: defaultSMCGoverningIdentities({
      provider: "codex",
      model: "gpt-test",
      reasoning_effort: "medium",
    }),
    budgets: {
      max_items_per_batch: 10,
      max_encoded_bytes_per_batch: 100_000,
      max_encoded_bytes_per_item: 100_000,
    },
  });
  return result.kind;
}
