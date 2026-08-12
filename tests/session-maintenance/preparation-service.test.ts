import { afterEach, beforeEach, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createIngestJob } from "../../src/ingest/jobs.ts";
import { openMemoryDbAt, type MemoryDb } from "../../src/memory/db.ts";
import { withAnchorPrepareAdmission } from "../../src/memory/session-memory-write-firewall.ts";
import { acquireSessionEmbeddingLifecycleFence } from "../../src/memory/session-embedding-lifecycle-fence.ts";
import {
  activateSMCAuthority,
  configureSMCTestContract,
  planEvidence,
  prepare,
  prepareWithWorkflowBudgets,
  seedEvidence,
  seedIndexedMemory,
  SMC_TEST_WORKFLOW_BUDGETS,
} from "../helpers/smc-preparation.ts";
import {
  SMC_WORKFLOW_BUDGET_KEYS,
  type SMCWorkflowBudgets,
} from "../../src/session-maintenance/manifest.ts";

let db: MemoryDb;

beforeEach(() => {
  db = openMemoryDbAt(":memory:");
  configureSMCTestContract(db);
});

afterEach(() => db.close());

test("commits fence, handle, leases, snapshots, and complete manifest in one immediate transaction", () => {
  seedIndexedMemory(db, { id: "memory-1" });
  seedEvidence(db, "evt-1");
  activateSMCAuthority(db);
  const plan = planEvidence(db);

  const result = prepare(db, plan);

  expect(result.kind).toBe("prepared");
  expect(db.query("SELECT status FROM ingest_jobs WHERE id = ?").get(plan.anchor_job_id)).toEqual({ status: "starting" });
  expect(db.query("SELECT phase, owner_epoch FROM session_memory_anchor_jobs WHERE job_id = ?").get(plan.anchor_job_id))
    .toEqual({ phase: "preparing", owner_epoch: 1 });
  expect(db.query("SELECT owner_id, phase FROM project_session_mutation_fences WHERE project_key = 'demo'").get())
    .toEqual({ owner_id: plan.anchor_job_id, phase: "preparing" });
  expect(db.query("SELECT count(*) AS n FROM smc_manifests").get()).toEqual({ n: 1 });
  expect(db.query("SELECT count(*) AS n FROM session_memory_write_admissions").get()).toEqual({ n: 0 });

  seedEvidence(db, "evt-2");
  const secondPlan = planEvidence(db, "job-second");
  expect(prepare(db, secondPlan)).toMatchObject({ kind: "blocked", code: "session_memory_project_busy" });
  expect(db.query("SELECT id FROM ingest_jobs WHERE id = 'job-second'").get()).toBeNull();
});

test("schema rejects cross-kind work batch membership", () => {
  seedIndexedMemory(db, { id: "memory-audit" });
  seedEvidence(db, "evt-1");
  activateSMCAuthority(db);
  const plan = planEvidence(db, "job-cross-kind", { includeAudit: true });
  const result = prepare(db, plan);
  if (result.kind !== "prepared") throw new Error(JSON.stringify(result));
  const evidenceBatch = plan.batches.find((batch) => batch.work_kind === "evidence")!;
  const auditBatch = plan.batches.find((batch) => batch.work_kind === "audit")!;

  expect(() => db.query(
    "UPDATE smc_audit_batch_members SET batch_id = ? WHERE job_id = ?",
  ).run(evidenceBatch.id, plan.anchor_job_id)).toThrow();
  expect(() => db.query(
    `INSERT INTO smc_evidence_batch_members
      (job_id, batch_id, work_kind, source_id, ordinal, content_hash)
     VALUES (?, ?, 'evidence', ?, 0, ?)`,
  ).run(plan.anchor_job_id, auditBatch.id, plan.evidence[0]!.source_id, plan.evidence[0]!.content_hash)).toThrow();
  expect(db.query(
    "SELECT batch_id FROM smc_audit_batch_members WHERE job_id = ?",
  ).get(plan.anchor_job_id)).toEqual({ batch_id: auditBatch.id });
});

test("failure immediately before commit leaves zero preparation state", () => {
  seedIndexedMemory(db, { id: "memory-1" });
  seedEvidence(db, "evt-1");
  activateSMCAuthority(db);
  const plan = planEvidence(db);

  expect(() => prepare(db, plan, { beforeCommit: () => { throw new Error("kill-before-commit"); } }))
    .toThrow("kill-before-commit");
  for (const table of [
    "ingest_jobs",
    "session_memory_anchor_jobs",
    "project_session_mutation_fences",
    "experience_event_tombstones",
    "smc_memory_snapshot",
    "smc_manifests",
  ]) {
    expect(db.query(`SELECT count(*) AS n FROM ${table}`).get(), table).toEqual({ n: 0 });
  }
  expect(db.query("SELECT id FROM experience_events").get()).toEqual({ id: "evt-1" });
});

test("lost response after commit leaves the same complete preparing anchor recoverable", () => {
  seedIndexedMemory(db, { id: "memory-1" });
  seedEvidence(db, "evt-1");
  activateSMCAuthority(db);
  const plan = planEvidence(db);

  expect(() => prepare(db, plan, { afterCommitBeforeReturn: () => { throw new Error("lost-response"); } }))
    .toThrow("lost-response");
  expect(db.query("SELECT job_id FROM smc_manifests WHERE job_id = ?").get(plan.anchor_job_id))
    .toEqual({ job_id: plan.anchor_job_id });
  expect(db.query("SELECT phase FROM session_memory_anchor_jobs WHERE job_id = ?").get(plan.anchor_job_id))
    .toEqual({ phase: "preparing" });
  expect(db.query("SELECT state FROM experience_event_tombstones").get()).toEqual({ state: "claimed" });
});

test("permanently denied and stale owner identities cannot prepare or mint admission", () => {
  seedEvidence(db, "evt-1");
  createIngestJob(db, {
    id: "job-denied",
    project_key: "demo",
    provider: "codex",
    input: {},
    now: "2026-08-11T11:59:00.000Z",
  });
  activateSMCAuthority(db);
  expect(prepare(db, planEvidence(db, "job-denied"))).toMatchObject({
    kind: "blocked",
    code: "session_memory_anchor_legacy_denied",
  });

  // Release is deliberately test-owned; Chunk08 owns real abandonment.
  db.query("DELETE FROM project_session_mutation_fences WHERE project_key = 'demo'").run();
  const freshPlan = planEvidence(db, "job-fresh");
  const fresh = prepare(db, freshPlan);
  if (fresh.kind !== "prepared") throw new Error(JSON.stringify(fresh));
  expect(() => withAnchorPrepareAdmission(db, {
    projectKey: "demo",
    ownerId: "job-fresh",
    ownerEpoch: 2,
    phase: "preparing",
  }, () => undefined)).toThrow("session_memory_legacy_write_denied:authority_mismatch");
});

test("an active global embedding lifecycle owner excludes preparation", () => {
  seedEvidence(db, "evt-1");
  activateSMCAuthority(db);
  const operationPlanJson = JSON.stringify({ version: 1, operation_kind: "migrate", ordered_scope_plans: [] });
  const operationPlanDigest = `sha256:${createHash("sha256").update(operationPlanJson).digest("hex")}`;
  const global = acquireSessionEmbeddingLifecycleFence(db, {
    operationKind: "migrate",
    activeContractId: null,
    targetContractId: null,
    operationPlanJson,
    operationPlanDigest,
    now: "2026-08-11T12:00:00.000Z",
  });
  if (global.kind !== "acquired") throw new Error(JSON.stringify(global));

  expect(prepare(db, planEvidence(db, "job-global-busy"))).toMatchObject({
    kind: "blocked",
    code: "session_embedding_lifecycle_busy",
    owner: { operation_id: global.fence.operation_id, owner_epoch: 1 },
  });
  expect(db.query("SELECT id FROM ingest_jobs WHERE id = 'job-global-busy'").get()).toBeNull();
});

test("a second connection cannot observe or reuse an uncommitted preparation admission", async () => {
  const directory = await mkdtemp(join(tmpdir(), "myelin-smc-admission-"));
  const path = join(directory, "memory.db");
  const first = openMemoryDbAt(path);
  const second = openMemoryDbAt(path);
  try {
    second.exec("PRAGMA busy_timeout = 0;");
    configureSMCTestContract(first);
    seedEvidence(first, "evt-1");
    activateSMCAuthority(first);
    const plan = planEvidence(first, "job-cross-connection");
    const result = prepare(first, plan);
    if (result.kind !== "prepared") throw new Error(JSON.stringify(result));

    expect(() => withAnchorPrepareAdmission(first, {
      projectKey: "demo",
      ownerId: plan.anchor_job_id,
      ownerEpoch: 1,
      phase: "preparing",
    }, () => {
      second.query(
        `INSERT INTO ingest_jobs
          (id, project_key, status, provider, input_json, output_counts_json, created_at, updated_at)
         VALUES ('cross-connection-job', 'demo', 'starting', 'codex', '{}', '{}', 'now', 'now')`,
      ).run();
    })).toThrow();
    expect(second.query("SELECT id FROM ingest_jobs WHERE id = 'cross-connection-job'").get()).toBeNull();
  } finally {
    second.close();
    first.close();
    await rm(directory, { recursive: true, force: true });
  }
});

test("empty workflow controls are rejected before any preparation state exists", () => {
  const plan = validPreparationPlan("job-empty-controls");

  expect(() => prepareWithWorkflowBudgets(db, plan, {})).toThrow("invalid_smc_workflow_budgets:");
  expectNoPreparationState();
});

for (const omittedField of SMC_WORKFLOW_BUDGET_KEYS) {
  test(`omitting ${omittedField} is rejected before any preparation state exists`, () => {
    const plan = validPreparationPlan(`job-omitted-${omittedField}`);
    const controls: Record<string, unknown> = { ...SMC_TEST_WORKFLOW_BUDGETS };
    delete controls[omittedField];

    expect(() => prepareWithWorkflowBudgets(db, plan, controls)).toThrow(`missing=[${omittedField}]`);
    expectNoPreparationState();
  });
}

test("unknown workflow controls are rejected before any preparation state exists", () => {
  const plan = validPreparationPlan("job-unknown-controls");

  expect(() => prepareWithWorkflowBudgets(db, plan, {
    ...SMC_TEST_WORKFLOW_BUDGETS,
    downstream_may_choose: 1,
  })).toThrow("unknown=[downstream_may_choose]");
  expectNoPreparationState();
});

test("infeasible workflow budgets return stable configured and required details with zero preparation state", () => {
  seedEvidence(db, "evt-1");
  seedEvidence(db, "evt-2");
  activateSMCAuthority(db);
  const plan = planEvidence(db, "job-infeasible");

  const result = prepareWithWorkflowBudgets(db, plan, {
    ...SMC_TEST_WORKFLOW_BUDGETS,
    max_turns: 2,
    max_queries: 1,
  });

  expect(result).toMatchObject({
    kind: "blocked",
    code: "smc_workflow_budget_infeasible",
    workflow_budget_feasibility: {
      configured: { max_turns: 2, max_queries: 1 },
      required: { min_turns: 3, min_queries: 2 },
      deficits: [
        "max_turns configured=2 required>=3",
        "max_queries configured=1 required>=2",
      ],
    },
  });
  expectNoPreparationState();
});

test("feasibility counts every audit fetch turn and exact plus one-hop reference materialization", () => {
  for (const id of ["memory-0", "memory-1", "memory-2"]) seedIndexedMemory(db, { id });
  seedEvidence(db, "evt-1", "Review session_memories/memory-0 and session_memories/memory-1");
  activateSMCAuthority(db);
  const plan = planEvidence(db, "job-query-feasibility", { includeAudit: true, auditPartitionLimit: 3 });

  const result = prepareWithWorkflowBudgets(db, plan, {
    ...SMC_TEST_WORKFLOW_BUDGETS,
    max_turns: 5,
    max_queries: 7,
  });

  expect(result).toMatchObject({
    kind: "blocked",
    code: "smc_workflow_budget_infeasible",
    workflow_budget_feasibility: {
      configured: { max_turns: 5, max_queries: 7 },
      required: { min_turns: 6, min_queries: 8 },
      deficits: [
        "max_turns configured=5 required>=6",
        "max_queries configured=7 required>=8",
      ],
    },
  });
  expectNoPreparationState();
});

const malformedWorkflowControls: Record<keyof SMCWorkflowBudgets, unknown> = {
  max_affected_work_set_size: 0,
  max_cumulative_returned_result_bytes: "100000",
  max_provider_envelope_bytes: -1,
  max_queries: 1.5,
  max_turns: Number.NaN,
  retrieval_page_item_limit: null,
  semantic_distance_threshold_micros: 2_000_001,
  semantic_qualifying_result_ceiling: Number.POSITIVE_INFINITY,
};

for (const malformedField of SMC_WORKFLOW_BUDGET_KEYS) {
  test(`malformed ${malformedField} is rejected before any preparation state exists`, () => {
    const plan = validPreparationPlan(`job-malformed-${malformedField}`);
    const controls: Record<string, unknown> = {
      ...SMC_TEST_WORKFLOW_BUDGETS,
      [malformedField]: malformedWorkflowControls[malformedField],
    };

    expect(() => prepareWithWorkflowBudgets(db, plan, controls)).toThrow(malformedField);
    expectNoPreparationState();
  });
}

test("freezes 3,219 active memories without constructing an all-memory provider envelope", () => {
  for (let index = 0; index < 3_219; index += 1) {
    seedIndexedMemory(db, { id: `memory-${String(index).padStart(4, "0")}` });
  }
  seedEvidence(db, "evt-1", "bounded evidence");
  activateSMCAuthority(db);
  const plan = planEvidence(db, "job-large");

  const result = prepare(db, plan);

  if (result.kind !== "prepared") throw new Error(JSON.stringify(result));
  expect(result.manifest.active_memory_count).toBe(3_219);
  expect(db.query("SELECT count(*) AS n FROM smc_memory_snapshot WHERE job_id = 'job-large'").get())
    .toEqual({ n: 3_219 });
  const job = db.query("SELECT input_json FROM ingest_jobs WHERE id = 'job-large'").get() as { input_json: string };
  expect(result.manifest.workflow_budgets.max_provider_envelope_bytes).toBe(
    SMC_TEST_WORKFLOW_BUDGETS.max_provider_envelope_bytes,
  );
  expect(new TextEncoder().encode(job.input_json).byteLength).toBeLessThanOrEqual(
    result.manifest.workflow_budgets.max_provider_envelope_bytes,
  );
  expect(job.input_json).not.toContain("memory-0000");
}, 30_000);

function validPreparationPlan(jobId: string) {
  seedEvidence(db, "evt-1");
  activateSMCAuthority(db);
  return planEvidence(db, jobId);
}

function expectNoPreparationState(): void {
  for (const table of [
    "ingest_jobs",
    "session_memory_anchor_jobs",
    "session_memory_anchor_attempts",
    "project_session_mutation_fences",
    "experience_event_tombstones",
    "session_memory_write_admissions",
    "smc_evidence_snapshot",
    "smc_work_batches",
    "smc_evidence_batch_members",
    "smc_no_agent_intents",
    "smc_memory_snapshot",
    "smc_memory_snapshot_contexts",
    "smc_memory_snapshot_links",
    "smc_memory_snapshot_search_texts",
    "smc_memory_snapshot_vectors",
    "smc_retrieval_snapshot_completeness",
    "smc_manifests",
  ]) {
    expect(db.query(`SELECT count(*) AS n FROM ${table}`).get(), table).toEqual({ n: 0 });
  }
  expect(db.query("SELECT id FROM experience_events").get()).toEqual({ id: "evt-1" });
}
