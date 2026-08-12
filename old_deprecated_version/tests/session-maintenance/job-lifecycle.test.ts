import { afterEach, beforeEach, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openMemoryDbAt, type MemoryDb } from "../../src/memory/db.ts";
import { withAnchorPrepareAdmission } from "../../src/memory/session-memory-write-firewall.ts";
import { AuthorityActivationService } from "../../src/session-maintenance/authority-activation-service.ts";
import {
  listSessionMemoryAnchorAttempts,
  transitionSessionMemoryAnchorJob,
} from "../../src/session-maintenance/job-lifecycle.ts";

let dir: string;
let db: MemoryDb;
const now = "2026-08-11T10:00:00.000Z";

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "myelin-anchor-lifecycle-"));
  db = openMemoryDbAt(join(dir, "memory.db"));
  new AuthorityActivationService({ now: () => new Date(now) }).activate(db);
});

afterEach(async () => {
  db.close();
  await rm(dir, { recursive: true, force: true });
});

test("needs_followup resume rotates epoch and appends a new attempt without rewriting history", () => {
  seedPreparingAnchor();
  expect(transition("preparing", 1, "running").kind).toBe("updated");
  expect(transition("running", 1, "needs_followup").kind).toBe("updated");

  const resumed = transitionSessionMemoryAnchorJob(db, {
    jobId: "anchor",
    projectKey: "demo",
    expectedPhase: "needs_followup",
    expectedOwnerEpoch: 2,
    nextPhase: "running",
    reasonCode: null,
    now: "2026-08-11T10:03:00.000Z",
    resumeAttempt: { id: "attempt_2", provider: "codex", processId: 9001 },
  });
  expect(resumed).toMatchObject({ kind: "updated", anchor: { phase: "running", owner_epoch: 3 } });
  expect(listSessionMemoryAnchorAttempts(db, "anchor")).toMatchObject([
    { id: "attempt_1", owner_epoch: 1, status: "needs_followup" },
    { id: "attempt_2", owner_epoch: 3, status: "running", process_id: 9001 },
  ]);
});

function seedPreparingAnchor(): void {
  db.transaction(() => {
    db.query(`INSERT INTO project_session_mutation_fences
      (project_key, owner_id, owner_kind, phase, owner_epoch, heartbeat_at, acquired_at, terminal_receipt_id)
      VALUES ('demo', 'anchor', 'anchor_job', 'preparing', 1, ?, ?, NULL)`).run(now, now);
    withAnchorPrepareAdmission(db, {
      projectKey: "demo",
      ownerId: "anchor",
      ownerEpoch: 1,
      phase: "preparing",
    }, () => db.query(`INSERT INTO ingest_jobs
      (id, project_key, status, provider, input_json, output_counts_json, created_at, updated_at)
      VALUES ('anchor', 'demo', 'starting', 'codex', '{}', '{}', ?, ?)`).run(now, now));
    db.query(`INSERT INTO session_memory_anchor_jobs
      (job_id, project_key, phase, owner_epoch, reason_code, heartbeat_at, created_at, updated_at)
      VALUES ('anchor', 'demo', 'preparing', 1, NULL, ?, ?, ?)`).run(now, now, now);
    db.query(`INSERT INTO session_memory_anchor_attempts
      (id, job_id, attempt_number, owner_epoch, attempt_kind, provider, status, details_json, created_at, updated_at)
      VALUES ('attempt_1', 'anchor', 1, 1, 'smc', 'codex', 'running', '{}', ?, ?)`).run(now, now);
  }).immediate();
}

function transition(
  expectedPhase: "preparing" | "running",
  expectedOwnerEpoch: number,
  nextPhase: "running" | "needs_followup",
) {
  return transitionSessionMemoryAnchorJob(db, {
    jobId: "anchor",
    projectKey: "demo",
    expectedPhase,
    expectedOwnerEpoch,
    nextPhase,
    now: expectedPhase === "preparing" ? "2026-08-11T10:01:00.000Z" : "2026-08-11T10:02:00.000Z",
  });
}
