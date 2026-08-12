import { expect, test } from "bun:test";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { openMemoryDb } from "../../src/memory/db.ts";
import { EmbeddingContractLifecycleService } from "../../src/memory/embedding-contract-lifecycle-service.ts";
import {
  readActiveEmbeddingContract,
  readPreviousEmbeddingContract,
  registerInitialActiveEmbeddingContract,
  activateEmbeddingContract,
  rollbackEmbeddingContract,
  upsertStagingEmbeddingContract,
} from "../../src/memory/embedding-contract-store.ts";
import { stubEmbeddingFilename } from "../../src/memory/providers/stub-embedding-provider.ts";
import { createSessionMemory } from "../helpers/session-mutation-authority.ts";
import { markSessionMemoryEmbeddingIndexed } from "../../src/memory/session-memory-embeddings.ts";
import { normalizeSessionMemoryForEmbedding } from "../../src/memory/session-memory-text.ts";
import { acquireProjectSessionMutationFence } from "../../src/memory/project-session-mutation-fence.ts";
import {
  abandonSessionEmbeddingLifecycleFence,
  acquireSessionEmbeddingLifecycleFence,
  assertSessionEmbeddingLifecycleAuthority,
  inspectSessionEmbeddingLifecycleFence,
} from "../../src/memory/session-embedding-lifecycle-fence.ts";
import { withSessionEmbeddingLifecycleAdmission } from "../../src/memory/session-memory-write-firewall.ts";

const nomic = {
  provider: "ollama_nomic" as const,
  model: "nomic-embed-text:v1.5",
  dimensions: 768,
  formatVersion: 1,
};

test("embedding migration stages and activates explicit desired contracts without data loss", async () => {
  const root = await mkdtemp(join(tmpdir(), "myelin-embedding-migrate-"));
  const stubDir = join(root, "stubs");
  await mkdir(stubDir, { recursive: true });
  await writeFile(
    join(root, "myelin.config"),
    `EMBEDDING_PROVIDER=ollama_qwen\nEMBEDDING_STUB_RESPONSES_DIR=${stubDir}\n`,
  );
  const db = openMemoryDb(root);
  registerInitialActiveEmbeddingContract(db, { scope: "session_memory", contract: nomic });
  registerInitialActiveEmbeddingContract(db, { scope: "project_memory", contract: nomic });
  createSessionMemory(db, {
    id: "memory-migrate",
    project_key: "demo",
    source_event_refs: [],
    memory_kind: "continuity",
    summary: "The staged embedding query must work before activation.",
    payload: {},
    confidence: "high",
    risk: "low",
    now: "2026-07-13T00:00:00.000Z",
    embedding_contract: { ...nomic, purpose: "retrieval_document" },
  });
  activateAuthority(db);
  db.exec(`
    CREATE TRIGGER session_contract_activation_requires_global_fence
    BEFORE UPDATE OF lifecycle ON embedding_contracts
    WHEN OLD.scope = 'session_memory' AND NEW.lifecycle <> OLD.lifecycle
    BEGIN
      SELECT CASE WHEN NOT EXISTS (
        SELECT 1 FROM session_embedding_lifecycle_fence WHERE singleton_id = 1 AND phase = 'running'
      ) THEN RAISE(ABORT, 'session lifecycle mutation escaped global fence') END;
    END;
  `);
  db.close();
  const text = normalizeSessionMemoryForEmbedding({
    title: null,
    summary: "The staged embedding query must work before activation.",
    memory_kind: "continuity",
    payload_json: "{}",
  });
  await writeFile(join(stubDir, stubEmbeddingFilename({
    contract: {
      provider: "ollama_qwen",
      model: "qwen3-embedding:4b",
      dimensions: 768,
      purpose: "retrieval_document",
      formatVersion: 1,
    },
    text,
  })), JSON.stringify({ embedding: Array(768).fill(0.25) }));

  const service = new EmbeddingContractLifecycleService(root);
  const preview = await service.migrate({ apply: false });
  expect(preview.scopes.map((scope) => scope.action)).toEqual(["migrate", "migrate"]);

  const applied = await service.migrate({ apply: true });
  expect(applied.scopes.every((scope) => scope.activated)).toBe(true);
  expect(applied.session_lifecycle).toMatchObject({ phase: "completed", receipt: { outcome: "completed" } });
  expect(applied.scopes[0]?.indexed).toBe(1);
  const check = openMemoryDb(root);
  try {
    expect(readActiveEmbeddingContract(check, "session_memory")?.provider).toBe("ollama_qwen");
    expect(readActiveEmbeddingContract(check, "project_memory")?.provider).toBe("ollama_qwen");
    expect(readPreviousEmbeddingContract(check, "session_memory")?.provider).toBe("ollama_nomic");
    expect(readPreviousEmbeddingContract(check, "project_memory")?.provider).toBe("ollama_nomic");
  } finally {
    check.close();
  }

  const rolledBack = await service.rollback({ apply: true });
  expect(rolledBack.scopes.every((scope) => scope.rolled_back)).toBe(true);
  expect(rolledBack.session_lifecycle).toMatchObject({ phase: "completed", receipt: { outcome: "completed" } });
  const rollbackCheck = openMemoryDb(root);
  try {
    expect(readActiveEmbeddingContract(rollbackCheck, "session_memory")?.provider).toBe("ollama_nomic");
    expect(readPreviousEmbeddingContract(rollbackCheck, "session_memory")?.provider).toBe("ollama_qwen");
  } finally {
    rollbackCheck.close();
  }

  const migratedAgain = await service.migrate({ apply: true });
  expect(migratedAgain.scopes.every((scope) => scope.activated)).toBe(true);
  expect(migratedAgain.session_lifecycle).toMatchObject({ generation: 3, phase: "completed" });
  const generationCheck = openMemoryDb(root);
  try {
    const receipts = generationCheck.query(
      `SELECT operation_id, operation_kind, generation, predecessor_receipt_id, operation_plan_digest
       FROM session_embedding_lifecycle_receipts
       ORDER BY generation`,
    ).all() as Array<{
      operation_id: string;
      operation_kind: string;
      generation: number;
      predecessor_receipt_id: string | null;
      operation_plan_digest: string;
    }>;
    expect(receipts.map((receipt) => [receipt.operation_kind, receipt.generation])).toEqual([
      ["migrate", 1],
      ["rollback", 2],
      ["migrate", 3],
    ]);
    expect(receipts[2]?.operation_plan_digest).toBe(receipts[0]?.operation_plan_digest);
    expect(receipts[2]?.operation_id).not.toBe(receipts[0]?.operation_id);
    const generationTwo = generationCheck.query(
      "SELECT id FROM session_embedding_lifecycle_receipts WHERE generation = 2",
    ).get() as { id: string } | null;
    if (!generationTwo) throw new Error("generation-two receipt is missing");
    expect(receipts[2]?.predecessor_receipt_id).toBe(generationTwo.id);
    expect(readActiveEmbeddingContract(generationCheck, "session_memory")?.provider).toBe("ollama_qwen");
    expect(readActiveEmbeddingContract(generationCheck, "project_memory")?.provider).toBe("ollama_qwen");
  } finally {
    generationCheck.close();
  }
});

test("embedding prune removes historical metadata but protects active contracts", async () => {
  const root = await mkdtemp(join(tmpdir(), "myelin-embedding-prune-"));
  const db = openMemoryDb(root);
  registerInitialActiveEmbeddingContract(db, { scope: "session_memory", contract: nomic });
  registerInitialActiveEmbeddingContract(db, { scope: "project_memory", contract: nomic });
  createSessionMemory(db, {
    id: "memory-1",
    project_key: "demo",
    source_event_refs: [],
    memory_kind: "continuity",
    summary: "summary",
    payload: {},
    confidence: "high",
    risk: "low",
    now: "2026-07-13T00:00:00.000Z",
    embedding_contract: { ...nomic, purpose: "retrieval_document" },
  });
  const activeRow = db.query(
    "SELECT id FROM session_memory_embeddings WHERE session_memory_id = 'memory-1' AND embedding_provider = 'ollama_nomic'",
  ).get() as { id: string };
  markSessionMemoryEmbeddingIndexed(db, {
    id: activeRow.id,
    normalized_text_hash: "sha256:active",
    now: "2026-07-13T00:01:00.000Z",
  });
  db.query(
    `INSERT INTO project_memory_retrieval_embeddings
      (id, project_key, wiki_path, section_id, section_hash, hint_hash_key,
       embedding_provider, embedding_model, embedding_dimensions, embedding_purpose,
       format_version, status, retry_count, created_at, updated_at)
     VALUES ('gemini-project-row', 'demo', 'wiki/topic.md', 'topic', 'hash', '',
       'gemini', 'gemini-embedding-2', 768, 'retrieval_document',
       1, 'failed', 1, ?, ?)`,
  ).run("2026-07-13T00:00:00.000Z", "2026-07-13T00:00:00.000Z");
  db.query(
    `INSERT INTO session_memory_embeddings
      (id, session_memory_id, project_key, embedding_provider, embedding_model, embedding_dimensions,
       embedding_purpose, format_version, status, retry_count, created_at, updated_at)
     VALUES ('gemini-row', 'memory-1', 'demo', 'gemini', 'gemini-embedding-2', 768,
       'retrieval_document', 1, 'failed', 1, ?, ?)`,
  ).run("2026-07-13T00:00:00.000Z", "2026-07-13T00:00:00.000Z");
  activateAuthority(db);
  db.close();

  const service = new EmbeddingContractLifecycleService(root);
  const preview = await service.prune({ apply: false });
  expect(preview.candidates).toHaveLength(2);
  expect(preview.candidates[0]?.contract.provider).toBe("gemini");

  const applied = await service.prune({ apply: true });
  expect(applied.removed_metadata_rows).toBe(2);
  expect(applied.session_lifecycle).toMatchObject({ phase: "completed", receipt: { outcome: "completed" } });
  const check = openMemoryDb(root);
  try {
    expect(check.query("SELECT embedding_provider, status FROM session_memory_embeddings").all()).toEqual([
      { embedding_provider: "ollama_nomic", status: "indexed" },
    ]);
    expect(check.query("SELECT count(*) AS count FROM project_memory_retrieval_embeddings").get()).toEqual({ count: 0 });
    expect(readActiveEmbeddingContract(check, "session_memory")?.provider).toBe("ollama_nomic");
  } finally {
    check.close();
  }
});

test("embedding prune refuses to remove rollback data before active coverage is complete", async () => {
  const root = await mkdtemp(join(tmpdir(), "myelin-embedding-prune-guard-"));
  const db = openMemoryDb(root);
  registerInitialActiveEmbeddingContract(db, { scope: "session_memory", contract: nomic });
  createSessionMemory(db, {
    id: "memory-unindexed",
    project_key: "legacy-project",
    source_event_refs: [],
    memory_kind: "continuity",
    summary: "Canonical memory still needs the active index.",
    payload: {},
    confidence: "high",
    risk: "low",
    now: "2026-07-13T00:00:00.000Z",
    embedding_contract: { ...nomic, purpose: "retrieval_document" },
  });
  db.query(
    `INSERT INTO session_memory_embeddings
      (id, session_memory_id, project_key, embedding_provider, embedding_model, embedding_dimensions,
       embedding_purpose, format_version, status, retry_count, created_at, updated_at)
     VALUES ('historical', 'memory-unindexed', 'legacy-project', 'gemini', 'gemini-embedding-2', 768,
       'retrieval_document', 1, 'indexed', 0, ?, ?)`,
  ).run("2026-07-13T00:00:00.000Z", "2026-07-13T00:00:00.000Z");
  activateAuthority(db);
  db.close();

  await expect(new EmbeddingContractLifecycleService(root).prune({ apply: true }))
    .rejects.toThrow("1 active memories lack the active contract index");
  const retained = openMemoryDb(root);
  let operationId = "";
  try {
    expect(inspectSessionEmbeddingLifecycleFence(retained)).toMatchObject({
      operation_kind: "prune",
      phase: "needs_followup",
      owner_epoch: 2,
    });
    operationId = inspectSessionEmbeddingLifecycleFence(retained)!.operation_id;
  } finally {
    retained.close();
  }
  await expect(new EmbeddingContractLifecycleService(root).prune({ apply: true }))
    .rejects.toThrow("1 active memories lack the active contract index");
  const recovered = openMemoryDb(root);
  try {
    expect(inspectSessionEmbeddingLifecycleFence(recovered)).toMatchObject({
      operation_id: operationId,
      operation_kind: "prune",
      phase: "needs_followup",
      owner_epoch: 4,
    });
  } finally {
    recovered.close();
  }
});

test("active combined lifecycle admission fails before mutating either scope", async () => {
  const root = await mkdtemp(join(tmpdir(), "myelin-embedding-global-busy-"));
  await writeFile(join(root, "myelin.config"), "EMBEDDING_PROVIDER=ollama_qwen\n");
  const db = openMemoryDb(root);
  registerInitialActiveEmbeddingContract(db, { scope: "session_memory", contract: nomic });
  registerInitialActiveEmbeddingContract(db, { scope: "project_memory", contract: nomic });
  activateAuthority(db);
  expect(acquireProjectSessionMutationFence(db, {
    projectKey: "project-a",
    ownerId: "job-a",
    ownerKind: "anchor_job",
    phase: "running",
    now: "2026-08-11T10:00:00.000Z",
  }).kind).toBe("acquired");
  const before = lifecycleState(db);
  db.close();

  await expect(new EmbeddingContractLifecycleService(root).migrate({ apply: true }))
    .rejects.toMatchObject({ code: "session_memory_project_busy" });

  const check = openMemoryDb(root);
  try {
    expect(lifecycleState(check)).toEqual(before);
    expect(inspectSessionEmbeddingLifecycleFence(check)).toBeNull();
  } finally {
    check.close();
  }
});

test("rollback resumes its frozen plan after mutation-before-receipt and ordinary retry replays it", async () => {
  const root = await mkdtemp(join(tmpdir(), "myelin-embedding-rollback-replay-"));
  const db = openMemoryDb(root);
  for (const scope of ["session_memory", "project_memory"] as const) {
    registerInitialActiveEmbeddingContract(db, { scope, contract: nomic });
    const staged = upsertStagingEmbeddingContract(db, {
      scope,
      contract: { provider: "ollama_qwen", model: "qwen3-embedding:4b", dimensions: 768, formatVersion: 1 },
    });
    activateEmbeddingContract(db, { scope, contractId: staged.id });
  }
  activateAuthority(db);
  const plans = (["session_memory", "project_memory"] as const).map((scope) => ({
    scope,
    active_contract: { provider: "ollama_qwen", model: "qwen3-embedding:4b", dimensions: 768, format_version: 1 },
    previous_contract: { provider: "ollama_nomic", model: nomic.model, dimensions: 768, format_version: 1 },
    action: "rollback" as const,
    rolled_back: false,
  }));
  const operationPlanJson = JSON.stringify({ version: 1, operation_kind: "rollback", ordered_scope_plans: plans });
  const operationPlanDigest = sha256(operationPlanJson);
  const acquired = acquireSessionEmbeddingLifecycleFence(db, {
    operationKind: "rollback",
    activeContractId: readActiveEmbeddingContract(db, "session_memory")!.id,
    targetContractId: operationPlanDigest,
    operationPlanJson,
    operationPlanDigest,
    now: "2026-08-11T10:00:00.000Z",
  });
  if (acquired.kind !== "acquired") throw new Error("fixture failed to acquire rollback fence");
  const operationId = acquired.fence.operation_id;
  for (const scope of ["session_memory", "project_memory"] as const) {
    db.transaction(() => {
      assertSessionEmbeddingLifecycleAuthority(db, acquired.authority);
      withSessionEmbeddingLifecycleAdmission(db, acquired.authority, () => {
        rollbackEmbeddingContract(db, scope, "2026-08-11T10:00:30.000Z");
      });
    }).immediate();
  }
  db.close(); // Simulates process loss after canonical mutation but before terminal receipt.

  const service = new EmbeddingContractLifecycleService(root);
  const recovered = await service.rollback({
    apply: true,
    staleBefore: "2026-08-11T10:00:01.000Z",
  });
  expect(recovered.scopes.every((scope) => scope.rolled_back)).toBeTrue();
  expect(recovered.session_lifecycle).toMatchObject({
    operation_id: operationId,
    phase: "completed",
    receipt: { operation_plan_digest: operationPlanDigest },
  });

  const retried = await service.rollback({ apply: true });
  expect(retried.session_lifecycle).toMatchObject({ operation_id: operationId, phase: "completed" });
  expect(retried.scopes.every((scope) => scope.rolled_back)).toBeTrue();
  const check = openMemoryDb(root);
  try {
    expect(readActiveEmbeddingContract(check, "session_memory")?.provider).toBe("ollama_nomic");
    expect(readActiveEmbeddingContract(check, "project_memory")?.provider).toBe("ollama_nomic");
    expect(check.query("SELECT count(*) AS count FROM session_embedding_lifecycle_receipts").get()).toEqual({ count: 1 });
  } finally {
    check.close();
  }
});

test("combined rollback attempts both scopes and retains the fence when one scope fails", async () => {
  const root = await mkdtemp(join(tmpdir(), "myelin-embedding-rollback-partial-"));
  const db = openMemoryDb(root);
  for (const scope of ["session_memory", "project_memory"] as const) {
    registerInitialActiveEmbeddingContract(db, { scope, contract: nomic });
    const staged = upsertStagingEmbeddingContract(db, {
      scope,
      contract: { provider: "ollama_qwen", model: "qwen3-embedding:4b", dimensions: 768, formatVersion: 1 },
    });
    activateEmbeddingContract(db, { scope, contractId: staged.id });
  }
  activateAuthority(db);
  db.exec(`
    CREATE TRIGGER reject_project_rollback
    BEFORE UPDATE OF lifecycle ON embedding_contracts
    WHEN OLD.scope = 'project_memory'
    BEGIN
      SELECT RAISE(ABORT, 'project rollback failed');
    END;
  `);
  db.close();

  await expect(new EmbeddingContractLifecycleService(root).rollback({ apply: true }))
    .rejects.toThrow("project rollback failed");
  const partial = openMemoryDb(root);
  try {
    expect(readActiveEmbeddingContract(partial, "session_memory")?.provider).toBe("ollama_nomic");
    expect(readActiveEmbeddingContract(partial, "project_memory")?.provider).toBe("ollama_qwen");
    expect(inspectSessionEmbeddingLifecycleFence(partial)).toMatchObject({
      operation_kind: "rollback",
      phase: "needs_followup",
      owner_epoch: 2,
    });
    partial.exec("DROP TRIGGER reject_project_rollback");
  } finally {
    partial.close();
  }

  const resumed = await new EmbeddingContractLifecycleService(root).rollback({ apply: true });
  expect(resumed.scopes.every((scope) => scope.rolled_back)).toBeTrue();
  expect(resumed.session_lifecycle).toMatchObject({ phase: "completed" });
});

test("normal migrate retries allocate after abandonment and then replay the completed generation", async () => {
  const root = await mkdtemp(join(tmpdir(), "myelin-embedding-migrate-after-abandon-"));
  const stubDir = join(root, "stubs");
  await mkdir(stubDir, { recursive: true });
  await writeFile(
    join(root, "myelin.config"),
    `EMBEDDING_PROVIDER=ollama_qwen\nEMBEDDING_STUB_RESPONSES_DIR=${stubDir}\n`,
  );
  const db = openMemoryDb(root);
  registerInitialActiveEmbeddingContract(db, { scope: "session_memory", contract: nomic });
  registerInitialActiveEmbeddingContract(db, { scope: "project_memory", contract: nomic });
  activateAuthority(db);
  db.close();

  const service = new EmbeddingContractLifecycleService(root);
  const preview = await service.migrate({ apply: false });
  const operationPlanJson = JSON.stringify({
    version: 1,
    operation_kind: "migrate",
    ordered_scope_plans: preview.scopes,
  });
  const operationPlanDigest = sha256(operationPlanJson);
  const abandonDb = openMemoryDb(root);
  const acquired = acquireSessionEmbeddingLifecycleFence(abandonDb, {
    operationKind: "migrate",
    activeContractId: readActiveEmbeddingContract(abandonDb, "session_memory")!.id,
    targetContractId: operationPlanDigest,
    operationPlanJson,
    operationPlanDigest,
    now: "2026-08-11T10:00:00.000Z",
  });
  if (acquired.kind !== "acquired") throw new Error("fixture failed to acquire abandoned migration");
  const abandoned = abandonSessionEmbeddingLifecycleFence(abandonDb, {
    authority: acquired.authority,
    resultDigest: sha256("operator-abandoned-migration"),
    now: "2026-08-11T10:01:00.000Z",
  });
  if (abandoned.kind !== "abandoned") throw new Error("fixture failed to abandon migration");
  abandonDb.close();

  const applied = await service.migrate({ apply: true });
  expect(applied.session_lifecycle).toMatchObject({
    generation: 2,
    phase: "completed",
    receipt: { predecessor_receipt_id: abandoned.receipt.id },
  });
  expect(applied.scopes.every((scope) => scope.activated)).toBeTrue();

  const retried = await service.migrate({ apply: true });
  expect(retried.session_lifecycle).toMatchObject({ generation: 2, phase: "completed" });
  const check = openMemoryDb(root);
  try {
    expect(check.query("SELECT outcome, generation FROM session_embedding_lifecycle_receipts ORDER BY generation").all())
      .toEqual([
        { outcome: "abandoned", generation: 1 },
        { outcome: "completed", generation: 2 },
      ]);
  } finally {
    check.close();
  }
});

function activateAuthority(db: ReturnType<typeof openMemoryDb>): void {
  db.query(
    "UPDATE session_memory_mutation_authority SET mode = 'smc_v1', updated_at = ? WHERE singleton_id = 1",
  ).run("2026-08-11T09:59:00.000Z");
}

function sha256(value: string): string {
  return `sha256:${createHash("sha256").update(value).digest("hex")}`;
}

function lifecycleState(db: ReturnType<typeof openMemoryDb>): unknown {
  return {
    contracts: db.query("SELECT * FROM embedding_contracts ORDER BY scope, id").all(),
    session_embeddings: db.query("SELECT * FROM session_memory_embeddings ORDER BY id").all(),
    project_embeddings: db.query("SELECT * FROM project_memory_retrieval_embeddings ORDER BY id").all(),
    queue: db.query("SELECT * FROM retrieval_maintenance_queue ORDER BY id").all(),
    receipts: db.query("SELECT * FROM session_embedding_lifecycle_receipts ORDER BY id").all(),
  };
}
