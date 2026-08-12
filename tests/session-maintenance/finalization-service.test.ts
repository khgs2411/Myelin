import { afterEach, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openMemoryDbAt, type MemoryDb } from "../../src/memory/db.ts";
import {
  finalizeSessionMaintenance,
  SessionMaintenanceFinalizationError,
} from "../../src/session-maintenance/finalization-service.ts";
import { createAcceptedFinalizationContext } from "../helpers/smc-finalization.ts";
import { SMC_TEST_NOW } from "../helpers/smc-preparation.ts";
import { abandonSessionMaintenanceAnchor } from "../../src/session-maintenance/abandonment-service.ts";

const databases: MemoryDb[] = [];
afterEach(() => { while (databases.length > 0) databases.pop()!.close(); });

test("finalizer atomically promotes the accepted projection and terminalizes the anchor", async () => {
  const db = memoryDb();
  const context = await createAcceptedFinalizationContext(db, { jobId: "job-finalize-success" });
  const indexRequests: string[] = [];

  const result = await finalizeSessionMaintenance(db, {
    jobId: context.job_id,
    ownerEpoch: context.owner_epoch,
    acceptedProjectionDigest: context.accepted.projection_digest,
    now: fixedNow,
    requestIndexing: (projectKey) => { indexRequests.push(projectKey); },
  });

  expect(result.kind).toBe("finalized");
  expect(indexRequests).toEqual(["demo"]);
  expect(db.query("SELECT id, status FROM session_memories ORDER BY id").all()).toEqual([
    { id: "memory-0", status: "active" },
    { id: "memory-new", status: "active" },
  ]);
  expect(db.query("SELECT id FROM experience_events WHERE id = 'evt-0'").get()).toBeNull();
  expect(db.query("SELECT source_event_ref, repo_path FROM session_memory_contexts WHERE session_memory_id = 'memory-new'").get())
    .toEqual({ source_event_ref: "evt-0", repo_path: "/repo" });
  expect(db.query("SELECT state, terminal_decision FROM experience_event_tombstones").get()).toEqual({
    state: "output",
    terminal_decision: "used",
  });
  expect(db.query("SELECT phase FROM session_memory_anchor_jobs WHERE job_id = ?")
    .get(context.job_id)).toEqual({ phase: "completed" });
  expect(db.query("SELECT id FROM smc_terminal_receipts WHERE job_id = ?").get(context.job_id))
    .toEqual({ id: result.receipt.id });
  expect(db.query("SELECT project_key FROM project_session_mutation_fences WHERE project_key = 'demo'").get()).toBeNull();
  expect(db.query("SELECT json_extract(followup_state_json, '$.session_maintenance_projection_result.state') AS state FROM ingest_jobs WHERE id = ?")
    .get(context.job_id)).toEqual({ state: "committed" });
  expect(db.query("SELECT status FROM session_memory_embeddings WHERE session_memory_id = 'memory-new'").get())
    .toEqual({ status: "pending" });
});

test("finalization receipt replays the same digest and rejects another digest", async () => {
  const db = memoryDb();
  const context = await createAcceptedFinalizationContext(db, { jobId: "job-finalize-replay" });
  const first = await finalizeSessionMaintenance(db, finalizationInput(context));
  const replay = await finalizeSessionMaintenance(db, finalizationInput(context));

  expect(replay.kind).toBe("replayed");
  expect(replay.receipt).toEqual(first.receipt);
  expect(db.query("SELECT count(*) AS n FROM smc_terminal_receipts WHERE job_id = ?").get(context.job_id))
    .toEqual({ n: 1 });
  await expect(finalizeSessionMaintenance(db, {
    ...finalizationInput(context),
    acceptedProjectionDigest: `sha256:${"0".repeat(64)}`,
  })).rejects.toMatchObject({ code: "finalization_projection_conflict" });
});

test("each injected pre-commit finalization failure rolls every canonical effect back", async () => {
  const effects = [
    "finalizing_cas",
    "canonical_projection",
    "source_terminalization",
    "audit_receipts",
    "accepted_result",
    "terminal_receipt",
    "job_completion_and_fence_release",
  ];
  for (const effect of effects) {
    const db = memoryDb();
    const context = await createAcceptedFinalizationContext(db, {
      jobId: `job-finalize-rollback-${effect}`,
      workKind: "audit",
    });
    await expect(finalizeSessionMaintenance(db, {
      ...finalizationInput(context),
      failure_injection: {
        after_effect: (seen) => { if (seen === effect) throw new Error(`injected:${effect}`); },
      },
    })).rejects.toThrow(`injected:${effect}`);
    assertRecoverableUncommittedState(db, context.job_id);
  }

  const db = memoryDb();
  const context = await createAcceptedFinalizationContext(db, { jobId: "job-finalize-before-commit" });
  await expect(finalizeSessionMaintenance(db, {
    ...finalizationInput(context),
    failure_injection: { before_commit: () => { throw new Error("injected:before_commit"); } },
  })).rejects.toThrow("injected:before_commit");
  assertRecoverableUncommittedState(db, context.job_id);
});

test("lost acknowledgement after commit is recovered from the durable receipt", async () => {
  const db = memoryDb();
  const context = await createAcceptedFinalizationContext(db, { jobId: "job-finalize-lost-ack" });
  await expect(finalizeSessionMaintenance(db, {
    ...finalizationInput(context),
    failure_injection: { after_commit_before_response: () => { throw new Error("lost acknowledgement"); } },
  })).rejects.toThrow("lost acknowledgement");

  const replay = await finalizeSessionMaintenance(db, finalizationInput(context));
  expect(replay.kind).toBe("replayed");
  expect(db.query("SELECT phase FROM session_memory_anchor_jobs WHERE job_id = ?").get(context.job_id))
    .toEqual({ phase: "completed" });
  expect(db.query("SELECT count(*) AS n FROM session_memories WHERE id = 'memory-new'").get()).toEqual({ n: 1 });
});

test("final drift fails before canonical mutation and leaves the anchor recoverable", async () => {
  const db = memoryDb();
  const context = await createAcceptedFinalizationContext(db, { jobId: "job-finalize-drift" });
  db.query("DELETE FROM smc_coverage_receipts WHERE job_id = ? AND receipt_kind = 'query'").run(context.job_id);

  await expect(finalizeSessionMaintenance(db, finalizationInput(context))).rejects.toThrow();
  assertRecoverableUncommittedState(db, context.job_id);
});

test("finalizer rejects missing or extra frozen audit members before canonical mutation", async () => {
  for (const corruption of ["missing", "extra"] as const) {
    const db = memoryDb();
    const context = await createAcceptedFinalizationContext(db, {
      jobId: `job-finalize-audit-member-${corruption}`,
      workKind: "audit",
    });
    if (corruption === "missing") {
      db.query("DELETE FROM smc_audit_batch_members WHERE job_id = ?").run(context.job_id);
    } else {
      const member = db.query(
        `SELECT batch_id, revision, state_digest, selection_basis, prior_audit_at
         FROM smc_audit_batch_members WHERE job_id = ?`,
      ).get(context.job_id) as {
        batch_id: string; revision: number; state_digest: string;
        selection_basis: string; prior_audit_at: string | null;
      };
      db.query(
        `INSERT INTO smc_audit_batch_members
          (job_id, batch_id, work_kind, memory_id, ordinal, revision, state_digest,
           selection_basis, prior_audit_at, member_digest)
         VALUES (?, ?, 'audit', 'memory-extra', 1, ?, ?, ?, ?, ?)`,
      ).run(
        context.job_id,
        member.batch_id,
        member.revision,
        member.state_digest,
        member.selection_basis,
        member.prior_audit_at,
        `sha256:${"0".repeat(64)}`,
      );
    }

    await expect(finalizeSessionMaintenance(db, finalizationInput(context))).rejects.toMatchObject({
      code: "finalization_manifest_identity_mismatch",
    });
    expect(db.query("SELECT phase FROM session_memory_anchor_jobs WHERE job_id = ?").get(context.job_id))
      .toEqual({ phase: "running" });
    expect(db.query("SELECT status FROM session_memories WHERE id = 'memory-0'").get())
      .toEqual({ status: "active" });
  }
});

test("finalizer requires the durable audit receipt count to equal the frozen manifest", async () => {
  const db = memoryDb();
  const context = await createAcceptedFinalizationContext(db, {
    jobId: "job-finalize-extra-audit-receipt",
    workKind: "audit",
  });
  const member = db.query(
    "SELECT batch_id FROM smc_audit_batch_members WHERE job_id = ?",
  ).get(context.job_id) as { batch_id: string };
  const memory = db.query(
    "SELECT revision, state_digest FROM session_memories WHERE id = 'memory-0'",
  ).get() as { revision: number; state_digest: string };
  const embedding = db.query(
    "SELECT embedding_contract_id FROM smc_manifests WHERE job_id = ?",
  ).get(context.job_id) as { embedding_contract_id: string };
  db.query(
    `INSERT INTO session_memory_audit_receipts
      (id, project_key, memory_id, reviewed_revision, reviewed_state_digest, job_id,
       work_batch_id, manifest_digest, accepted_projection_digest,
       policy_version, policy_digest, output_contract_version, output_contract_digest,
       tool_protocol_version, tool_protocol_digest, embedding_contract_id, disposition,
       resulting_status, resulting_revision, resulting_state_digest, receipt_digest, created_at)
     VALUES ('extra-audit-receipt', 'demo', 'memory-0', 999, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?,
             'keep', 'active', ?, ?, ?, ?)`,
  ).run(
    `sha256:${"1".repeat(64)}`,
    context.job_id,
    member.batch_id,
    context.manifest_digest,
    context.accepted.projection_digest,
    context.accepted.projection.governing_identities.policy.version,
    context.accepted.projection.governing_identities.policy.digest,
    context.accepted.projection.governing_identities.output_contract.version,
    context.accepted.projection.governing_identities.output_contract.digest,
    context.accepted.projection.governing_identities.tool_protocol.version,
    context.accepted.projection.governing_identities.tool_protocol.digest,
    embedding.embedding_contract_id,
    memory.revision,
    memory.state_digest,
    `sha256:${"2".repeat(64)}`,
    SMC_TEST_NOW,
  );

  await expect(finalizeSessionMaintenance(db, finalizationInput(context))).rejects.toMatchObject({
    code: "finalization_audit_coverage_invalid",
  });
  expect(db.query("SELECT phase FROM session_memory_anchor_jobs WHERE job_id = ?").get(context.job_id))
    .toEqual({ phase: "running" });
  expect(db.query("SELECT count(*) AS count FROM session_memory_audit_receipts WHERE job_id = ?")
    .get(context.job_id)).toEqual({ count: 1 });
});

test("tampered frozen memory summary is rejected before finalization writes", async () => {
  const db = memoryDb();
  const context = await createAcceptedFinalizationContext(db, { jobId: "job-finalize-memory-tamper" });
  db.query("UPDATE smc_memory_snapshot SET summary = summary || ' tampered' WHERE job_id = ?")
    .run(context.job_id);

  await expect(finalizeSessionMaintenance(db, finalizationInput(context))).rejects.toMatchObject({
    code: "finalization_memory_snapshot_mismatch",
  });
  assertRecoverableUncommittedState(db, context.job_id);
});

test("tampered frozen vector bytes are rejected before finalization writes", async () => {
  const db = memoryDb();
  const context = await createAcceptedFinalizationContext(db, { jobId: "job-finalize-vector-tamper" });
  const row = db.query("SELECT memory_id, vector_bytes FROM smc_memory_snapshot_vectors WHERE job_id = ? LIMIT 1")
    .get(context.job_id) as { memory_id: string; vector_bytes: Uint8Array };
  const bytes = new Uint8Array(row.vector_bytes);
  bytes[0] ^= 0xff;
  db.query("UPDATE smc_memory_snapshot_vectors SET vector_bytes = ? WHERE job_id = ? AND memory_id = ?")
    .run(bytes, context.job_id, row.memory_id);

  await expect(finalizeSessionMaintenance(db, finalizationInput(context))).rejects.toMatchObject({
    code: "finalization_embedding_identity_mismatch",
  });
  assertRecoverableUncommittedState(db, context.job_id);
});

test("post-commit indexing failure reports degradation without rolling canonical state back", async () => {
  const db = memoryDb();
  const context = await createAcceptedFinalizationContext(db, { jobId: "job-finalize-index-degraded" });
  const result = await finalizeSessionMaintenance(db, {
    ...finalizationInput(context),
    requestIndexing: () => { throw new Error("scheduler unavailable"); },
  });

  expect(result.indexing).toMatchObject({
    kind: "degraded",
    code: "session_memory_index_request_failed",
  });
  expect(db.query("SELECT phase FROM session_memory_anchor_jobs WHERE job_id = ?").get(context.job_id))
    .toEqual({ phase: "completed" });
  expect(db.query("SELECT id FROM session_memories WHERE id = 'memory-new'").get()).toEqual({ id: "memory-new" });
});

test("finalization and explicit abandonment on separate connections permit one terminal outcome", async () => {
  const dir = await mkdtemp(join(tmpdir(), "smc-finalization-race-"));
  const path = join(dir, "memory.db");
  const finalizerDb = openMemoryDbAt(path);
  const context = await createAcceptedFinalizationContext(finalizerDb, { jobId: "job-finalize-race" });
  const abandonDb = openMemoryDbAt(path);
  try {
    const [finalization, abandonment] = await Promise.all([
      finalizeSessionMaintenance(finalizerDb, finalizationInput(context)),
      Promise.resolve().then(() => abandonSessionMaintenanceAnchor(abandonDb, {
        job_id: context.job_id,
        project_key: context.project_key,
        expected_owner_epoch: context.owner_epoch,
        receipt_id: "receipt-abandon-race",
        request_id: "request-abandon-race",
        operator_id: "operator-test",
        reason: "explicit test race",
        now: SMC_TEST_NOW,
      })),
    ]);
    expect(finalization.kind).toBe("finalized");
    expect(abandonment).toEqual({ kind: "rejected", code: "smc_abandon_terminal_conflict" });
    expect(finalizerDb.query("SELECT count(*) AS n FROM smc_terminal_receipts WHERE job_id = ?").get(context.job_id))
      .toEqual({ n: 1 });
    expect(finalizerDb.query("SELECT phase FROM session_memory_anchor_jobs WHERE job_id = ?").get(context.job_id))
      .toEqual({ phase: "completed" });
    expect(finalizerDb.query("SELECT project_key FROM project_session_mutation_fences WHERE project_key = 'demo'").get())
      .toBeNull();
  } finally {
    abandonDb.close();
    finalizerDb.close();
    await rm(dir, { recursive: true, force: true });
  }
});

function memoryDb(): MemoryDb {
  const db = openMemoryDbAt(":memory:");
  databases.push(db);
  return db;
}

function fixedNow(): Date { return new Date(SMC_TEST_NOW); }

function finalizationInput(context: Awaited<ReturnType<typeof createAcceptedFinalizationContext>>) {
  return {
    jobId: context.job_id,
    ownerEpoch: context.owner_epoch,
    acceptedProjectionDigest: context.accepted.projection_digest,
    now: fixedNow,
  };
}

function assertRecoverableUncommittedState(db: MemoryDb, jobId: string): void {
  expect(db.query("SELECT phase FROM session_memory_anchor_jobs WHERE job_id = ?").get(jobId)).toEqual({ phase: "running" });
  expect(db.query("SELECT project_key FROM project_session_mutation_fences WHERE project_key = 'demo'").get()).not.toBeNull();
  expect(db.query("SELECT id FROM session_memories WHERE id = 'memory-new'").get()).toBeNull();
  const event = db.query("SELECT id FROM experience_events WHERE id = 'evt-0'").get();
  const tombstone = db.query("SELECT state FROM experience_event_tombstones WHERE ingest_job_id = ?").get(jobId);
  if (event) {
    expect(event).toEqual({ id: "evt-0" });
    expect(tombstone).toEqual({ state: "claimed" });
  } else {
    expect(tombstone).toBeNull();
  }
  expect(db.query("SELECT id FROM smc_terminal_receipts WHERE job_id = ?").get(jobId)).toBeNull();
  expect(db.query("SELECT id FROM session_memory_audit_receipts WHERE job_id = ?").get(jobId)).toBeNull();
}
