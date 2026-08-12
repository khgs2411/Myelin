import { afterEach, beforeEach, expect, test } from "bun:test";
import { mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";
import type { Database } from "bun:sqlite";
import { openMemoryDbAt, type MemoryDb } from "../../src/memory/db.ts";
import {
  acquireProjectSessionMutationFence,
  acquireProjectSessionMutationFenceInOpenTransaction,
  heartbeatProjectSessionMutationFence,
  inspectProjectSessionMutationFence,
  releaseProjectSessionMutationFence,
  transitionProjectSessionMutationFence,
  withLegacySessionMutationAuthority,
  type LegacySessionMutationAuthority,
  type ProjectSessionMutationAuthority,
} from "../../src/memory/project-session-mutation-fence.ts";
import { createSessionMemoryContexts } from "../../src/memory/session-memory-contexts.ts";
import { createSessionMemoryLink } from "../../src/memory/session-memory-links.ts";
import { createSessionMemory } from "../../src/memory/session-memories.ts";
import { SessionMemoryRepairService } from "../../src/memory/session-memory-repair-service.ts";

let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "myelin-project-mutation-fence-"));
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

test("migration 17 keeps project fences dormant while legacy authority remains transaction-bound", () => {
  const db = openMemoryDbAt(join(dir, "memory.db"));
  try {
    expect(db.query("SELECT mode FROM session_memory_mutation_authority WHERE singleton_id = 1").get())
      .toEqual({ mode: "legacy_compatibility" });
    expect(acquireProjectSessionMutationFence(db, {
      projectKey: "demo",
      ownerId: "job_1",
      ownerKind: "anchor_job",
      phase: "preparing",
      now: "2026-08-11T10:00:00.000Z",
    })).toEqual({
      kind: "not_activated",
      code: "session_memory_authority_not_activated",
      authority_mode: "legacy_compatibility",
    });
    expect(inspectProjectSessionMutationFence(db, "demo")).toBeNull();

    let leaked!: LegacySessionMutationAuthority;
    withLegacySessionMutationAuthority(db, "demo", (authority) => {
      leaked = authority;
      createMemory(db, "mem_legacy", "demo", authority);
    });
    expect(inspectProjectSessionMutationFence(db, "demo")).toBeNull();
    expect(() => createMemory(
      db,
      "mem_missing_authority",
      "demo",
      undefined as unknown as ProjectSessionMutationAuthority,
    )).toThrow("session_memory_authority_invalid");
    expect(() => createMemory(db, "mem_replayed", "demo", leaked))
      .toThrow("session_memory_authority_invalid");
    expect(db.query("SELECT id FROM session_memories ORDER BY id").all()).toEqual([{ id: "mem_legacy" }]);

    db.query(
      "UPDATE session_memory_mutation_authority SET mode = 'smc_v1', updated_at = ? WHERE singleton_id = 1",
    ).run("2026-08-11T10:01:00.000Z");
    expect(() => withLegacySessionMutationAuthority(db, "demo", () => undefined))
      .toThrow("session_memory_legacy_authority_rejected");
  } finally {
    db.close();
  }
});

test("legacy authorities are opaque, immutable, connection-bound, and uncloneable", () => {
  const path = join(dir, "memory.db");
  const first = openMemoryDbAt(path);
  const second = openMemoryDbAt(path);
  try {
    withLegacySessionMutationAuthority(first, "demo", (authority) => {
      expect(Object.isFrozen(authority)).toBeTrue();
      expect(Object.keys(authority)).toEqual([]);
      expect(Reflect.set(authority as object, "projectKey", "other")).toBeFalse();
      expect(() => createMemory(first, "mem_wrong_project", "other", authority))
        .toThrow("session_memory_authority_project_mismatch");
      expect(() => createMemory(second, "mem_cross_db", "demo", authority))
        .toThrow("session_memory_authority_database_mismatch");
      expect(() => createMemory(
        first,
        "mem_cloned",
        "demo",
        { ...authority } as ProjectSessionMutationAuthority,
      )).toThrow("session_memory_authority_invalid");
      createMemory(first, "mem_original", "demo", authority);
    });
    expect(first.query("SELECT id FROM session_memories").all()).toEqual([{ id: "mem_original" }]);
  } finally {
    second.close();
    first.close();
  }
});

test("competing starts return safe owner metadata and stale heartbeat never transfers ownership", () => {
  const path = join(dir, "memory.db");
  const first = openMemoryDbAt(path);
  const second = openMemoryDbAt(path);
  try {
    activate(first);
    const acquired = acquireProjectSessionMutationFence(first, {
      projectKey: "demo",
      ownerId: "job_first",
      ownerKind: "anchor_job",
      phase: "preparing",
      now: "2026-08-11T10:00:00.000Z",
    });
    expect(acquired.kind).toBe("acquired");
    const competing = acquireProjectSessionMutationFence(second, {
      projectKey: "demo",
      ownerId: "job_second",
      ownerKind: "anchor_job",
      phase: "preparing",
      now: "2026-08-11T11:00:00.000Z",
      staleBefore: "2026-08-11T10:30:00.000Z",
    });
    expect(competing).toMatchObject({
      kind: "busy",
      code: "session_memory_project_busy",
      owner: {
        project_key: "demo",
        owner_id: "job_first",
        owner_kind: "anchor_job",
        phase: "preparing",
        owner_epoch: 1,
        stale: true,
      },
    });
    expect(inspectProjectSessionMutationFence(second, "demo")?.owner_id).toBe("job_first");
  } finally {
    second.close();
    first.close();
  }
});

test("heartbeat and phase changes are CAS guarded and delayed epochs cannot write", () => {
  const db = activeDb();
  try {
    const acquired = acquire(db, "demo", "job_1", "running");
    expect(heartbeatProjectSessionMutationFence(db, {
      authority: acquired,
      expectedPhase: "preparing",
      now: "2026-08-11T10:01:00.000Z",
    })).toMatchObject({ kind: "rejected", code: "session_memory_project_fence_wrong_phase" });
    expect(heartbeatProjectSessionMutationFence(db, {
      authority: acquired,
      expectedPhase: "running",
      now: "2026-08-11T10:02:00.000Z",
    })).toMatchObject({ kind: "updated", fence: { heartbeat_at: "2026-08-11T10:02:00.000Z" } });

    expect(() => createMemory(db, "mem_running", "demo", acquired))
      .toThrow("session_memory_project_fence_wrong_phase");
    const paused = transitionProjectSessionMutationFence(db, {
      authority: acquired,
      expectedPhase: "running",
      nextPhase: "needs_followup",
      now: "2026-08-11T10:03:00.000Z",
    });
    expect(paused).toMatchObject({ kind: "updated", fence: { phase: "needs_followup", owner_epoch: 2 } });
    expect(heartbeatProjectSessionMutationFence(db, {
      authority: acquired,
      expectedPhase: "needs_followup",
      now: "2026-08-11T10:04:00.000Z",
    })).toMatchObject({ kind: "rejected", code: "session_memory_project_fence_stale_epoch" });
    expect(() => createMemory(db, "mem_stale", "demo", acquired))
      .toThrow("session_memory_project_fence_stale_epoch");

    if (paused.kind !== "updated") throw new Error("fixture failed to pause");
    expect(() => createMemory(db, "mem_paused", "demo", paused.authority))
      .toThrow("session_memory_project_fence_wrong_phase");
    expect(releaseProjectSessionMutationFence(db, paused.authority))
      .toMatchObject({ kind: "rejected", code: "session_memory_project_fence_not_terminal" });
    const resumed = transitionProjectSessionMutationFence(db, {
      authority: paused.authority,
      expectedPhase: "needs_followup",
      nextPhase: "running",
      now: "2026-08-11T10:05:00.000Z",
    });
    expect(resumed).toMatchObject({ kind: "updated", fence: { phase: "running", owner_epoch: 3 } });
    if (resumed.kind !== "updated") throw new Error("fixture failed to resume");
    expect(() => createMemory(db, "mem_pre_resume", "demo", paused.authority))
      .toThrow("session_memory_project_fence_stale_epoch");
    expect(() => createMemory(db, "mem_resumed", "demo", resumed.authority))
      .toThrow("session_memory_project_fence_wrong_phase");
    const finalizing = transitionProjectSessionMutationFence(db, {
      authority: resumed.authority,
      expectedPhase: "running",
      nextPhase: "finalizing",
      now: "2026-08-11T10:06:00.000Z",
    });
    if (finalizing.kind !== "updated") throw new Error("fixture failed to finalize");
    createMemory(db, "mem_finalizing", "demo", finalizing.authority);
    expect(db.query("SELECT id FROM session_memories ORDER BY id").all())
      .toEqual([{ id: "mem_finalizing" }]);
  } finally {
    db.close();
  }
});

test("fenced authorities are opaque, immutable, connection-bound, and uncloneable", () => {
  const path = join(dir, "memory.db");
  const first = openMemoryDbAt(path);
  const second = openMemoryDbAt(path);
  try {
    activate(first);
    const authority = acquire(first, "demo", "job_1", "finalizing");
    expect(Object.isFrozen(authority)).toBeTrue();
    expect(Object.keys(authority)).toEqual([]);
    expect(Reflect.set(authority as object, "ownerEpoch", 999)).toBeFalse();
    expect(() => createMemory(second, "mem_cross_db", "demo", authority))
      .toThrow("session_memory_authority_database_mismatch");
    expect(() => createMemory(
      first,
      "mem_cloned",
      "demo",
      { ...authority } as ProjectSessionMutationAuthority,
    )).toThrow("session_memory_authority_invalid");
    createMemory(first, "mem_original", "demo", authority);
    expect(first.query("SELECT id FROM session_memories").all()).toEqual([{ id: "mem_original" }]);
  } finally {
    second.close();
    first.close();
  }
});

test("canonical writers verify authority for every project and linked endpoint", () => {
  const db = activeDb();
  try {
    const demo = acquire(db, "demo", "job_demo", "finalizing");
    const other = acquire(db, "other", "job_other", "finalizing");
    createMemory(db, "mem_demo", "demo", demo);
    createMemory(db, "mem_other", "other", other);

    expect(() => createMemory(db, "mem_wrong", "other", demo))
      .toThrow("session_memory_authority_project_mismatch");
    expect(() => createSessionMemoryContexts(db, [{
      session_memory_id: "mem_other",
      project_key: "demo",
      source_event_ref: "tomb_1",
    }], demo)).toThrow("Session Memory context project mismatch");
    expect(() => createSessionMemoryLink(db, {
      source_memory_id: "mem_demo",
      target_memory_id: "mem_other",
      project_key: "demo",
      relationship: "refines",
      reason: "cross-project fixture",
      source_event_refs: ["tomb_1"],
      created_at: "2026-08-11T10:00:00.000Z",
    }, demo)).toThrow("Session Memory link project mismatch");
  } finally {
    db.close();
  }
});

test("repair authority is writable only in its bounded running phase", () => {
  const db = activeDb();
  try {
    const result = acquireProjectSessionMutationFence(db, {
      projectKey: "demo",
      ownerId: "repair_1",
      ownerKind: "repair",
      phase: "finalizing",
      now: "2026-08-11T10:00:00.000Z",
    });
    if (result.kind !== "acquired") throw new Error("fixture failed to acquire repair authority");
    expect(() => createMemory(db, "mem_repair_finalizing", "demo", result.authority))
      .toThrow("session_memory_project_fence_wrong_phase");
  } finally {
    db.close();
  }
});

test("public fence acquisition rejects nesting instead of reusing a caller transaction", () => {
  const db = activeDb();
  try {
    expect(() => db.transaction(() => {
      acquireProjectSessionMutationFence(db, {
        projectKey: "demo",
        ownerId: "job_rollback",
        ownerKind: "anchor_job",
        phase: "preparing",
        now: "2026-08-11T10:00:00.000Z",
      });
    })()).toThrow("must own its BEGIN IMMEDIATE transaction");
    expect(inspectProjectSessionMutationFence(db, "demo")).toBeNull();
  } finally {
    db.close();
  }
});

test("coordinator acquisition variant participates in its caller-owned immediate transaction", () => {
  const db = activeDb();
  try {
    expect(() => acquireProjectSessionMutationFenceInOpenTransaction(db, {
      projectKey: "demo",
      ownerId: "job_outside",
      ownerKind: "anchor_job",
      phase: "preparing",
      now: "2026-08-11T10:00:00.000Z",
    })).toThrow("session_memory_authority_transaction_required");

    expect(() => db.transaction(() => {
      const acquired = acquireProjectSessionMutationFenceInOpenTransaction(db, {
        projectKey: "demo",
        ownerId: "job_rollback",
        ownerKind: "anchor_job",
        phase: "preparing",
        now: "2026-08-11T10:00:00.000Z",
      });
      expect(acquired.kind).toBe("acquired");
      throw new Error("rollback fixture");
    }).immediate()).toThrow("rollback fixture");
    expect(inspectProjectSessionMutationFence(db, "demo")).toBeNull();
  } finally {
    db.close();
  }
});

test("repair cannot race an occupied active-mode project fence", async () => {
  const path = join(dir, "state", "memory", "memory.db");
  const db = openMemoryDbAt(path);
  try {
    activate(db);
    acquire(db, "demo", "job_ingest", "running");
  } finally {
    db.close();
  }

  const service = new SessionMemoryRepairService(dir, () => new Date("2026-08-11T10:05:00.000Z"));
  await expect(service.apply("demo")).rejects.toThrow("session_memory_project_busy");
});

test("active-mode repair owns and releases a bounded fence around its mutation transaction", async () => {
  const path = join(dir, "state", "memory", "memory.db");
  const db = openMemoryDbAt(path);
  activate(db);
  db.close();

  const service = new SessionMemoryRepairService(dir, () => new Date("2026-08-11T10:05:00.000Z"));
  const result = await service.apply("demo");
  expect(result).toMatchObject({ status: "completed", applied_retractions: 0 });

  const verified = openMemoryDbAt(path);
  try {
    expect(inspectProjectSessionMutationFence(verified, "demo")).toBeNull();
  } finally {
    verified.close();
  }
});

test("runtime canonical writer inventory remains inside the authority boundary", () => {
  const srcRoot = join(import.meta.dir, "..", "..", "src");
  const files = sourceFiles(srcRoot);
  const canonicalDml = /\b(?:INSERT\s+INTO|UPDATE|DELETE\s+FROM)\s+(?:session_memories|session_memory_contexts|session_memory_links)\b/i;
  const dmlOwners = files
    .filter((file) => !file.endsWith("/migrations.ts"))
    .filter((file) => canonicalDml.test(readFileSync(file, "utf8")))
    .map((file) => relative(join(import.meta.dir, "..", ".."), file))
    .sort();
  expect(dmlOwners).toEqual([
    "src/memory/session-memories.ts",
    "src/memory/session-memory-contexts.ts",
    "src/memory/session-memory-links.ts",
    "src/memory/session-memory-revisions.ts",
  ]);

  const canonicalDmlInventory: Record<string, Record<string, number>> = {
    "src/memory/session-memories.ts": {
      "INSERT INTO session_memories": 1,
      "UPDATE session_memories": 2,
    },
    "src/memory/session-memory-contexts.ts": {
      "INSERT INTO session_memory_contexts": 1,
    },
    "src/memory/session-memory-links.ts": {
      "INSERT INTO session_memory_links": 1,
    },
    "src/memory/session-memory-revisions.ts": {
      "UPDATE session_memories": 2,
    },
  };
  for (const [relativePath, expectedStatements] of Object.entries(canonicalDmlInventory)) {
    const source = readFileSync(join(import.meta.dir, "..", "..", relativePath), "utf8")
      .replace(/\s+/g, " ");
    for (const [statement, expectedCount] of Object.entries(expectedStatements)) {
      expect(source.split(statement).length - 1).toBe(expectedCount);
    }
    expect(source.match(new RegExp(canonicalDml.source, "gi"))?.length ?? 0)
      .toBe(Object.values(expectedStatements).reduce((sum, count) => sum + count, 0));
  }

  const callerInventory: Record<string, string[]> = {
    createSessionMemory: ["src/session-maintenance/commit.ts"],
    createSessionMemoryContexts: ["src/session-maintenance/commit.ts"],
    createSessionMemoryLink: ["src/session-maintenance/commit.ts"],
    supersedeSessionMemory: ["src/session-maintenance/commit.ts"],
    retractSessionMemory: [
      "src/memory/session-memory-repair-service.ts",
      "src/session-maintenance/commit.ts",
    ],
    advanceSessionMemoryRevisionInOpenTransaction: [
      "src/memory/session-memories.ts",
      "src/memory/session-memory-contexts.ts",
      "src/memory/session-memory-links.ts",
      "src/memory/session-memory-repair-service.ts",
      "src/session-maintenance/commit.ts",
    ],
  };
  for (const [symbol, expected] of Object.entries(callerInventory)) {
    const callers = files
      .filter((file) => !file.endsWith(`/${definitionFile(symbol)}`))
      .filter((file) => {
        const source = readFileSync(file, "utf8");
        const localNames = [symbol, ...importAliases(source, symbol)];
        return localNames.some((localName) => new RegExp(`\\b${localName}\\s*\\(`).test(source));
      })
      .map((file) => relative(join(import.meta.dir, "..", ".."), file))
      .sort();
    expect(callers).toEqual(expected);
  }
});

function activeDb(): MemoryDb {
  const db = openMemoryDbAt(join(dir, "memory.db"));
  activate(db);
  return db;
}

function importAliases(source: string, importedName: string): string[] {
  return [...source.matchAll(new RegExp(`\\b${importedName}\\s+as\\s+([A-Za-z_$][\\w$]*)`, "g"))]
    .map((match) => match[1]!);
}

function activate(db: Database): void {
  db.query(
    "UPDATE session_memory_mutation_authority SET mode = 'smc_v1', updated_at = ? WHERE singleton_id = 1",
  ).run("2026-08-11T09:59:00.000Z");
}

function acquire(
  db: Database,
  projectKey: string,
  ownerId: string,
  phase: "preparing" | "running" | "finalizing",
) {
  const result = acquireProjectSessionMutationFence(db, {
    projectKey,
    ownerId,
    ownerKind: "anchor_job",
    phase,
    now: "2026-08-11T10:00:00.000Z",
  });
  if (result.kind !== "acquired") throw new Error(`fixture failed to acquire ${projectKey}`);
  return result.authority;
}

function createMemory(
  db: Database,
  id: string,
  projectKey: string,
  authority: ProjectSessionMutationAuthority,
): void {
  createSessionMemory(db, {
    id,
    project_key: projectKey,
    source_event_refs: [],
    memory_kind: "continuity",
    summary: `Memory ${id}`,
    payload: {},
    confidence: "high",
    risk: "low",
    now: "2026-08-11T10:00:00.000Z",
    embedding_contract: null,
  }, authority);
}

function sourceFiles(root: string): string[] {
  return readdirSync(root, { withFileTypes: true }).flatMap((entry) => {
    const path = join(root, entry.name);
    return entry.isDirectory() ? sourceFiles(path) : path.endsWith(".ts") ? [path] : [];
  });
}

function definitionFile(symbol: string): string {
  if (symbol === "createSessionMemoryContexts") return "session-memory-contexts.ts";
  if (symbol === "createSessionMemoryLink") return "session-memory-links.ts";
  if (symbol === "advanceSessionMemoryRevisionInOpenTransaction") return "session-memory-revisions.ts";
  return "session-memories.ts";
}
