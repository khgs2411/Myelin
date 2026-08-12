import { afterEach, beforeEach, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { openMemoryDbAt, type MemoryDb } from "../../src/memory/db.ts";
import { readSessionMemoryCuratorStatus } from "../../src/session-maintenance/status-service.ts";
import { transitionSessionMemoryAnchorJob } from "../../src/session-maintenance/job-lifecycle.ts";
import type { EmbeddingConfig, SMCPlanConfig } from "../../src/runtime/config.ts";
import { acquireProjectSessionMutationFence } from "../../src/memory/project-session-mutation-fence.ts";
import { acquireSessionEmbeddingLifecycleFence } from "../../src/memory/session-embedding-lifecycle-fence.ts";
import { createIngestJob } from "../../src/ingest/jobs.ts";
import {
  activateSMCAuthority,
  configureSMCTestContract,
  planEvidence,
  prepare,
  seedEvidence,
  seedIndexedMemory,
  SMC_TEST_NOW,
  SMC_TEST_WORKFLOW_BUDGETS,
} from "../helpers/smc-preparation.ts";

let db: MemoryDb;

beforeEach(() => {
  db = openMemoryDbAt(":memory:");
  configureSMCTestContract(db);
  seedIndexedMemory(db, { id: "memory-status" });
  seedEvidence(db, "event-status", "private evidence must not enter status");
  activateSMCAuthority(db);
});

afterEach(() => db.close());

test("separates incremental freshness, audit coverage, indexing health, and fence ownership", () => {
  const prepared = prepare(db, planEvidence(db, "job-status"));
  if (prepared.kind !== "prepared") throw new Error(JSON.stringify(prepared));
  db.query(
    `INSERT INTO session_memory_anchor_attempts
      (id, job_id, attempt_number, owner_epoch, attempt_kind, provider, process_id, status,
       details_json, created_at, updated_at)
     VALUES ('attempt-status', ?, 1, 1, 'smc', 'codex', 4321, 'running', '{}', ?, ?)`,
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

  const result = status({ is_process_alive: () => false });

  expect(result.contract_version).toBe("myelin.smc.status.v1");
  expect(result.queued_content).toMatchObject({ count: 1, oldest_age_ms: 0 });
  expect(result.freshness).toMatchObject({ state: "pending", queued_content_count: 1 });
  expect(result.audit_coverage).toEqual({ active_revision_count: 1, covered_revision_count: 0, due_revision_count: 1 });
  expect(result.indexing).toMatchObject({ state: "ready", active_memory_count: 1, indexed_count: 1 });
  expect(result.current_anchor).toMatchObject({
    job_id: "job-status",
    phase: "running",
    owner_epoch: 1,
    process: { authority: "diagnostic_only", process_id: 4321, liveness: "not_alive" },
  });
  expect(result.project_fence).toMatchObject({ owner_id: "job-status", phase: "running" });
  expect(result.reason_codes).toContain("smc_anchor_active");
  expect(JSON.stringify(result)).not.toContain("private evidence");
});

test("uses neutral current-process provider reachability without changing durable lifecycle facts", () => {
  const result = status({ provider_state: "unreachable" });

  expect(result.indexing).toMatchObject({ state: "unavailable", provider_state: "unreachable" });
  expect(result.reason_codes).toContain("smc_embedding_provider_unreachable");
  expect(result.freshness.state).toBe("pending");
});

test("distinguishes an unavailable embedding contract from an unreachable provider", () => {
  const result = status({ provider_state: "unavailable" });

  expect(result.indexing).toMatchObject({ state: "unavailable", provider_state: "unavailable" });
  expect(result.reason_codes).toContain("smc_embedding_provider_unavailable");
  expect(result.reason_codes).not.toContain("smc_embedding_provider_unreachable");
});

test("reports non-anchor project ownership as a freshness blocker without treating liveness as authority", () => {
  const acquired = acquireProjectSessionMutationFence(db, {
    projectKey: "demo",
    ownerId: "repair-owner",
    ownerKind: "repair",
    phase: "running",
    now: SMC_TEST_NOW,
  });
  if (acquired.kind !== "acquired") throw new Error(JSON.stringify(acquired));

  const result = status();

  expect(result.project_fence).toMatchObject({
    owner_id: "repair-owner",
    owner_kind: "repair",
    phase: "running",
    owner_epoch: 1,
  });
  expect(result.current_anchor).toBeNull();
  expect(result.freshness.state).toBe("blocked");
  expect(result.reason_codes).toContain("smc_project_fence_busy");
});

test("reports the scope-global embedding owner separately from audit and indexing facts", () => {
  const operationPlanJson = JSON.stringify({ version: 1, operation_kind: "migrate", ordered_scope_plans: [] });
  const operationPlanDigest = `sha256:${createHash("sha256").update(operationPlanJson).digest("hex")}`;
  const acquired = acquireSessionEmbeddingLifecycleFence(db, {
    operationKind: "migrate",
    activeContractId: null,
    targetContractId: null,
    operationPlanJson,
    operationPlanDigest,
    now: SMC_TEST_NOW,
  });
  if (acquired.kind !== "acquired") throw new Error(JSON.stringify(acquired));

  const result = status();

  expect(result.global_embedding_fence).toMatchObject({
    operation_id: acquired.fence.operation_id,
    operation_kind: "migrate",
    owner_epoch: 1,
  });
  expect(result.freshness.state).toBe("blocked");
  expect(result.audit_coverage.due_revision_count).toBe(1);
  expect(result.indexing.state).toBe("ready");
  expect(result.reason_codes).toContain("smc_global_embedding_fence_busy");
});

test("reports permanent legacy denial as immutable diagnostic state", () => {
  db.close();
  db = openMemoryDbAt(":memory:");
  configureSMCTestContract(db);
  seedIndexedMemory(db, { id: "memory-status-denied" });
  seedEvidence(db, "event-status-denied", "private evidence must not enter status");
  createIngestJob(db, {
    id: "legacy-denied-status",
    project_key: "demo",
    provider: "codex",
    input: {},
    now: SMC_TEST_NOW,
  });
  activateSMCAuthority(db);

  const result = status();

  expect(result.legacy.permanently_denied_job_count).toBe(1);
  expect(result.reason_codes).toContain("smc_legacy_identity_permanently_denied");
});

function status(overrides: Partial<Parameters<typeof readSessionMemoryCuratorStatus>[1]> = {}) {
  return readSessionMemoryCuratorStatus(db, {
    project_key: "demo",
    generated_at: SMC_TEST_NOW,
    embedding_config: embeddingConfig(),
    ingest_profile: { provider: "codex", model: "gpt-test", reasoningEffort: "medium" },
    plan_config: planConfig(),
    ...overrides,
  });
}

function planConfig(): SMCPlanConfig {
  return {
    auditPartitionLimit: 10,
    evidenceBudgets: {
      max_items_per_batch: 10,
      max_encoded_bytes_per_batch: 100_000,
      max_encoded_bytes_per_item: 100_000,
    },
    workflowBudgets: SMC_TEST_WORKFLOW_BUDGETS,
  };
}

function embeddingConfig(): EmbeddingConfig {
  return {
    provider: "ollama_nomic",
    providers: {
      ollama_nomic: { model: "smc-test-embedding", dimensions: 3 },
      ollama_qwen: { model: "unused", dimensions: 3 },
      gemini: { model: "unused", dimensions: 3 },
    },
    ollamaUrl: "http://127.0.0.1:11434",
    batchSize: 10,
  };
}
