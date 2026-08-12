import { afterEach, beforeEach, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHash } from "node:crypto";
import type { Database } from "bun:sqlite";
import { openMemoryDbAt } from "../../src/memory/db.ts";
import {
  acquireProjectSessionMutationFence,
  releaseProjectSessionMutationFence,
  transitionProjectSessionMutationFence,
} from "../../src/memory/project-session-mutation-fence.ts";
import {
  abandonSessionEmbeddingLifecycleFence,
  acquireSessionEmbeddingLifecycleFence,
  assertSessionEmbeddingLifecycleAuthority,
  completeSessionEmbeddingLifecycleFence,
  heartbeatSessionEmbeddingLifecycleFence,
  inspectSessionEmbeddingLifecycleFence,
  pauseSessionEmbeddingLifecycleFence,
  readSessionEmbeddingLifecycleReceipt,
  recoverSessionEmbeddingLifecycleFence,
  sessionEmbeddingLifecycleOperationId,
} from "../../src/memory/session-embedding-lifecycle-fence.ts";

let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "myelin-session-embedding-fence-"));
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

test("migration 18 keeps the global lifecycle fence dormant", () => {
  const db = openMemoryDbAt(join(dir, "memory.db"));
  try {
    expect(acquireSessionEmbeddingLifecycleFence(db, operation("migrate"))).toEqual({
      kind: "not_activated",
      code: "session_memory_authority_not_activated",
      authority_mode: "legacy_compatibility",
    });
    expect(inspectSessionEmbeddingLifecycleFence(db)).toBeNull();
    expect(db.query("SELECT count(*) AS count FROM session_embedding_lifecycle_receipts").get())
      .toEqual({ count: 0 });
  } finally {
    db.close();
  }
});

test("project and global admission are reciprocal across existing and unseen projects", () => {
  const path = join(dir, "memory.db");
  const first = openMemoryDbAt(path);
  const second = openMemoryDbAt(path);
  try {
    activate(first);
    const project = acquireProjectSessionMutationFence(first, {
      projectKey: "project-a",
      ownerId: "job-a",
      ownerKind: "anchor_job",
      phase: "running",
      now: "2026-08-11T10:00:00.000Z",
    });
    expect(project.kind).toBe("acquired");
    expect(acquireSessionEmbeddingLifecycleFence(second, operation("migrate"))).toMatchObject({
      kind: "project_busy",
      code: "session_memory_project_busy",
      owner: { project_key: "project-a", owner_id: "job-a" },
    });
    if (project.kind !== "acquired") throw new Error("fixture failed to acquire project fence");
    const terminal = transitionProjectSessionMutationFence(first, {
      authority: project.authority,
      expectedPhase: "running",
      nextPhase: "completed",
      terminalReceiptId: "project-receipt",
      now: "2026-08-11T10:01:00.000Z",
    });
    if (terminal.kind !== "updated") throw new Error("fixture failed to complete project fence");
    expect(releaseProjectSessionMutationFence(first, terminal.authority)).toEqual({ kind: "released" });

    const global = acquireSessionEmbeddingLifecycleFence(first, operation("migrate"));
    expect(global.kind).toBe("acquired");
    for (const projectKey of ["project-b", "previously-unseen-project"]) {
      expect(acquireProjectSessionMutationFence(second, {
        projectKey,
        ownerId: `job-${projectKey}`,
        ownerKind: "anchor_job",
        phase: "preparing",
        now: "2026-08-11T10:02:00.000Z",
      })).toMatchObject({
        kind: "global_busy",
        code: "session_embedding_lifecycle_busy",
        owner: { operation_id: operation("migrate").operationId, owner_epoch: 1 },
      });
    }
    expect(second.query("SELECT count(*) AS count FROM project_session_mutation_fences").get())
      .toEqual({ count: 0 });
  } finally {
    second.close();
    first.close();
  }
});

test("opaque authority, heartbeat, recovery, stale epochs, and completion receipt are CAS guarded", () => {
  const db = activeDb();
  try {
    const acquired = acquireSessionEmbeddingLifecycleFence(db, operation("rollback"));
    if (acquired.kind !== "acquired") throw new Error("fixture failed to acquire global fence");
    expect(Object.isFrozen(acquired.authority)).toBeTrue();
    expect(Object.keys(acquired.authority)).toEqual([]);
    expect(Reflect.set(acquired.authority as object, "ownerEpoch", 999)).toBeFalse();
    expect(heartbeatSessionEmbeddingLifecycleFence(db, {
      authority: acquired.authority,
      expectedPhase: "needs_followup",
      now: "2026-08-11T10:01:00.000Z",
    })).toMatchObject({ kind: "rejected", code: "session_embedding_lifecycle_wrong_phase" });

    const paused = pauseSessionEmbeddingLifecycleFence(db, {
      authority: acquired.authority,
      now: "2026-08-11T10:02:00.000Z",
    });
    expect(paused).toMatchObject({ kind: "updated", fence: { phase: "needs_followup", owner_epoch: 2 } });
    expect(completeSessionEmbeddingLifecycleFence(db, {
      authority: acquired.authority,
      resultDigest: digest("complete"),
      now: "2026-08-11T10:03:00.000Z",
    })).toMatchObject({ kind: "rejected", code: "session_embedding_lifecycle_stale_epoch" });

    const incompatible = recoverSessionEmbeddingLifecycleFence(db, {
      ...operation("rollback"),
      expectedOwnerEpoch: 2,
      expectedGeneration: acquired.fence.generation,
      expectedPhase: "needs_followup",
      targetContractId: "different-target",
      now: "2026-08-11T10:04:00.000Z",
    });
    expect(incompatible).toMatchObject({
      kind: "rejected",
      code: "session_embedding_lifecycle_identity_mismatch",
    });
    const recovered = recoverSessionEmbeddingLifecycleFence(db, {
      ...operation("rollback"),
      expectedOwnerEpoch: 2,
      expectedGeneration: acquired.fence.generation,
      expectedPhase: "needs_followup",
      now: "2026-08-11T10:05:00.000Z",
    });
    expect(recovered).toMatchObject({ kind: "updated", fence: { phase: "running", owner_epoch: 3 } });
    if (recovered.kind !== "updated") throw new Error("fixture failed to recover global fence");
    const contractsBeforeStaleMutation = db.query("SELECT * FROM embedding_contracts ORDER BY id").all();
    expect(() => db.transaction(() => {
      assertSessionEmbeddingLifecycleAuthority(db, paused.kind === "updated" ? paused.authority : acquired.authority);
      db.query("DELETE FROM embedding_contracts").run();
    }).immediate()).toThrow("session_embedding_lifecycle_stale_epoch");
    expect(db.query("SELECT * FROM embedding_contracts ORDER BY id").all()).toEqual(contractsBeforeStaleMutation);

    const completed = completeSessionEmbeddingLifecycleFence(db, {
      authority: recovered.authority,
      resultDigest: digest("complete"),
      now: "2026-08-11T10:06:00.000Z",
    });
    expect(completed).toMatchObject({
      kind: "completed",
      receipt: { operation_id: operation("rollback").operationId, owner_epoch: 3, outcome: "completed" },
    });
    expect(inspectSessionEmbeddingLifecycleFence(db)).toBeNull();
    expect(readSessionEmbeddingLifecycleReceipt(db, operation("rollback").operationId)).toEqual(
      completed.kind === "completed" ? completed.receipt : null,
    );
  } finally {
    db.close();
  }
});

test("explicit abandonment is idempotent and releases the global fence exactly once", () => {
  const db = activeDb();
  try {
    const acquired = acquireSessionEmbeddingLifecycleFence(db, operation("prune"));
    if (acquired.kind !== "acquired") throw new Error("fixture failed to acquire global fence");
    const abandoned = abandonSessionEmbeddingLifecycleFence(db, {
      authority: acquired.authority,
      resultDigest: digest("operator-abandon"),
      now: "2026-08-11T10:01:00.000Z",
    });
    expect(abandoned).toMatchObject({ kind: "abandoned", receipt: { outcome: "abandoned" } });
    expect(abandonSessionEmbeddingLifecycleFence(db, {
      authority: acquired.authority,
      resultDigest: digest("operator-abandon"),
      now: "2026-08-11T10:02:00.000Z",
    })).toEqual(abandoned);
    expect(inspectSessionEmbeddingLifecycleFence(db)).toBeNull();
    expect(db.query("SELECT count(*) AS count FROM session_embedding_lifecycle_receipts").get())
      .toEqual({ count: 1 });
  } finally {
    db.close();
  }
});

test("normal acquire advances after abandonment while explicit abandoned-receipt replay remains available", () => {
  const db = activeDb();
  try {
    const first = acquireSessionEmbeddingLifecycleFence(db, operation("migrate"));
    if (first.kind !== "acquired") throw new Error("fixture failed to acquire abandoned generation");
    const abandoned = abandonSessionEmbeddingLifecycleFence(db, {
      authority: first.authority,
      resultDigest: digest("abandoned-generation"),
      now: "2026-08-11T10:01:00.000Z",
    });
    if (abandoned.kind !== "abandoned") throw new Error("fixture failed to abandon generation");

    expect(acquireSessionEmbeddingLifecycleFence(db, {
      ...operation("migrate"),
      replayReceiptId: abandoned.receipt.id,
    })).toEqual({ kind: "replayed", receipt: abandoned.receipt });

    const retried = acquireSessionEmbeddingLifecycleFence(db, operation("migrate"));
    expect(retried).toMatchObject({
      kind: "acquired",
      fence: {
        generation: 2,
        predecessor_receipt_id: abandoned.receipt.id,
        operation_plan_digest: first.fence.operation_plan_digest,
      },
    });
    if (retried.kind !== "acquired") throw new Error("fixture failed to allocate post-abandon generation");
    expect(retried.fence.operation_id).not.toBe(first.fence.operation_id);
  } finally {
    db.close();
  }
});

test("a hard-killed running operation recovers only the same frozen operation at a higher epoch", () => {
  const path = join(dir, "memory.db");
  const beforeKill = openMemoryDbAt(path);
  activate(beforeKill);
  const acquired = acquireSessionEmbeddingLifecycleFence(beforeKill, operation("migrate"));
  expect(acquired).toMatchObject({ kind: "acquired", fence: { owner_epoch: 1, phase: "running" } });
  beforeKill.close();

  const afterKill = openMemoryDbAt(path);
  try {
    expect(recoverSessionEmbeddingLifecycleFence(afterKill, {
      ...operation("migrate"),
      operationId: "different-operation",
      expectedOwnerEpoch: 1,
      expectedGeneration: 1,
      expectedPhase: "running",
      now: "2026-08-11T10:01:00.000Z",
    })).toMatchObject({ kind: "rejected", code: "session_embedding_lifecycle_wrong_operation" });
    const recovered = recoverSessionEmbeddingLifecycleFence(afterKill, {
      ...operation("migrate"),
      expectedOwnerEpoch: 1,
      expectedGeneration: 1,
      expectedPhase: "running",
      now: "2026-08-11T10:02:00.000Z",
      staleBefore: "2026-08-11T10:01:00.000Z",
    });
    expect(recovered).toMatchObject({ kind: "updated", fence: { owner_epoch: 2, phase: "running" } });
    if (recovered.kind !== "updated") throw new Error("fixture failed to recover hard-killed operation");
    expect(completeSessionEmbeddingLifecycleFence(afterKill, {
      authority: recovered.authority,
      resultDigest: digest("hard-kill-recovery"),
      now: "2026-08-11T10:03:00.000Z",
    })).toMatchObject({ kind: "completed", receipt: { owner_epoch: 2 } });
  } finally {
    afterKill.close();
  }
});

test("fresh running ownership cannot be taken over and a terminal receipt replays across connections", () => {
  const path = join(dir, "memory.db");
  const first = openMemoryDbAt(path);
  activate(first);
  const input = operation("prune");
  const acquired = acquireSessionEmbeddingLifecycleFence(first, input);
  if (acquired.kind !== "acquired") throw new Error("fixture failed to acquire global fence");
  expect(recoverSessionEmbeddingLifecycleFence(first, {
    ...input,
    expectedOwnerEpoch: 1,
    expectedGeneration: acquired.fence.generation,
    expectedPhase: "running",
    staleBefore: "2026-08-11T10:00:00.000Z",
    now: "2026-08-11T10:00:30.000Z",
  })).toMatchObject({ kind: "rejected", code: "session_embedding_lifecycle_heartbeat_not_stale" });
  const completed = completeSessionEmbeddingLifecycleFence(first, {
    authority: acquired.authority,
    resultDigest: digest("cross-process-replay"),
    now: "2026-08-11T10:01:00.000Z",
  });
  if (completed.kind !== "completed") throw new Error("fixture failed to complete global fence");
  first.close();

  const second = openMemoryDbAt(path);
  try {
    expect(acquireSessionEmbeddingLifecycleFence(second, input)).toEqual({
      kind: "replayed",
      receipt: completed.receipt,
    });
    expect(inspectSessionEmbeddingLifecycleFence(second)).toBeNull();
  } finally {
    second.close();
  }
});

test("terminal replay never reports success while another fence row remains", () => {
  const db = activeDb();
  try {
    const first = acquireSessionEmbeddingLifecycleFence(db, operation("prune"));
    if (first.kind !== "acquired") throw new Error("fixture failed to acquire first fence");
    const digestValue = digest("first-completion");
    expect(completeSessionEmbeddingLifecycleFence(db, {
      authority: first.authority,
      resultDigest: digestValue,
      now: "2026-08-11T10:01:00.000Z",
    }).kind).toBe("completed");
    expect(acquireSessionEmbeddingLifecycleFence(db, operation("migrate")).kind).toBe("acquired");
    expect(completeSessionEmbeddingLifecycleFence(db, {
      authority: first.authority,
      resultDigest: digestValue,
      now: "2026-08-11T10:02:00.000Z",
    })).toMatchObject({ kind: "rejected", code: "session_embedding_lifecycle_receipt_conflict" });
  } finally {
    db.close();
  }
});

test("an intervening lifecycle transition allocates a new generation for an identical prune plan", () => {
  const db = activeDb();
  try {
    const first = acquireSessionEmbeddingLifecycleFence(db, operation("prune"));
    if (first.kind !== "acquired") throw new Error("fixture failed to acquire first prune");
    const firstTerminal = completeSessionEmbeddingLifecycleFence(db, {
      authority: first.authority,
      resultDigest: digest("first-prune"),
      now: "2026-08-11T10:01:00.000Z",
    });
    if (firstTerminal.kind !== "completed") throw new Error("fixture failed to complete first prune");

    const intervening = acquireSessionEmbeddingLifecycleFence(db, operation("migrate"));
    if (intervening.kind !== "acquired") throw new Error("fixture failed to acquire intervening migration");
    const interveningTerminal = completeSessionEmbeddingLifecycleFence(db, {
      authority: intervening.authority,
      resultDigest: digest("intervening-migrate"),
      now: "2026-08-11T10:02:00.000Z",
    });
    if (interveningTerminal.kind !== "completed") throw new Error("fixture failed to complete intervening migration");

    const recurring = acquireSessionEmbeddingLifecycleFence(db, operation("prune"));
    expect(recurring).toMatchObject({
      kind: "acquired",
      fence: {
        generation: 3,
        predecessor_receipt_id: interveningTerminal.receipt.id,
        operation_plan_digest: first.fence.operation_plan_digest,
      },
    });
    if (recurring.kind !== "acquired") throw new Error("fixture failed to acquire recurring prune");
    expect(recurring.fence.operation_id).not.toBe(first.fence.operation_id);
  } finally {
    db.close();
  }
});

test("generation allocation and receipt predecessor history serialize across connections", () => {
  const path = join(dir, "memory.db");
  const first = openMemoryDbAt(path);
  const second = openMemoryDbAt(path);
  try {
    activate(first);
    const acquired = acquireSessionEmbeddingLifecycleFence(first, operation("prune"));
    if (acquired.kind !== "acquired") throw new Error("fixture failed to acquire first generation");
    expect(acquired.fence.generation).toBe(1);
    expect(acquireSessionEmbeddingLifecycleFence(second, operation("migrate"))).toMatchObject({
      kind: "busy",
      owner: { generation: 1, operation_id: acquired.fence.operation_id },
    });
    const terminal = completeSessionEmbeddingLifecycleFence(first, {
      authority: acquired.authority,
      resultDigest: digest("serialized-first"),
      now: "2026-08-11T10:01:00.000Z",
    });
    if (terminal.kind !== "completed") throw new Error("fixture failed to complete first generation");
    const next = acquireSessionEmbeddingLifecycleFence(second, operation("migrate"));
    expect(next).toMatchObject({
      kind: "acquired",
      fence: { generation: 2, predecessor_receipt_id: terminal.receipt.id },
    });
  } finally {
    second.close();
    first.close();
  }
});

function activeDb() {
  const db = openMemoryDbAt(join(dir, "memory.db"));
  activate(db);
  return db;
}

function activate(db: Database): void {
  db.query(
    "UPDATE session_memory_mutation_authority SET mode = 'smc_v1', updated_at = ? WHERE singleton_id = 1",
  ).run("2026-08-11T09:59:00.000Z");
}

function operation(operationKind: "migrate" | "rollback" | "prune") {
  const operationPlanJson = JSON.stringify({ version: 1, operation_kind: operationKind, ordered_scope_plans: [] });
  const operationPlanDigest = digest(operationPlanJson);
  return {
    operationId: sessionEmbeddingLifecycleOperationId({ operationKind, operationPlanDigest, generation: 1 }),
    operationKind,
    activeContractId: "session_memory:active",
    targetContractId: "session_memory:target",
    operationPlanJson,
    operationPlanDigest,
    now: "2026-08-11T10:00:00.000Z",
  };
}

function digest(value: string): string {
  return `sha256:${createHash("sha256").update(value).digest("hex")}`;
}
