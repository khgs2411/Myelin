import { afterEach, beforeEach, expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { launcherSha256, promoteLauncher, renderLauncher } from "../../src/install/launcher.ts";
import {
  INTERNAL_INVOCATION_KIND_ENV,
  INTERNAL_LAUNCHER_PATH_ENV,
  INTERNAL_LOCATOR_PATH_ENV,
} from "../../src/runtime/launch-context.ts";
import { createIngestJob, updateIngestJobStatus } from "../../src/ingest/jobs.ts";
import { openMemoryDbAt } from "../../src/memory/db.ts";
import {
  finalizeLeasedExperienceEventsInOpenTransaction,
  leaseExperienceEvents,
  recordExperienceEvent,
} from "../../src/memory/experience.ts";
import {
  registerInitialActiveEmbeddingContract,
  upsertStagingEmbeddingContract,
} from "../../src/memory/embedding-contract-store.ts";
import { createSessionMemoryContexts } from "../../src/memory/session-memory-contexts.ts";
import { createSessionMemoryLink } from "../../src/memory/session-memory-links.ts";
import { createSessionMemory } from "../../src/memory/session-memories.ts";
import {
  acquireProjectSessionMutationFence,
  transitionProjectSessionMutationFence,
  withLegacySessionMutationAuthority,
} from "../../src/memory/project-session-mutation-fence.ts";
import {
  SESSION_MEMORY_WRITE_FIREWALL_DENIAL,
  withCompatibilityJobTransitionAdmission,
} from "../../src/memory/session-memory-write-firewall.ts";
import {
  runFrozenPreFirewallLauncher,
  runFrozenPreFirewallPidNullChild,
  runFrozenPreFirewallProviderWorker,
} from "../fixtures/pre-firewall-session-runtime.ts";
import { AuthorityActivationService } from "../../src/session-maintenance/authority-activation-service.ts";

let dir: string;

beforeEach(async () => { dir = await mkdtemp(join(tmpdir(), "myelin-write-firewall-")); });
afterEach(async () => { await rm(dir, { recursive: true, force: true }); });

test("closed firewall enforces the exact compatibility matrix while capture remains append-only", () => {
  const db = openMemoryDbAt(join(dir, "memory.db"));
  try {
    const now = "2026-08-11T10:00:00.000Z";
    expect(recordExperienceEvent(db, event("evt_1"), new Date(now))?.id).toBe("evt_1");
    expect(() => db.query("UPDATE experience_events SET raw_text = 'changed' WHERE id = 'evt_1'").run())
      .toThrow(SESSION_MEMORY_WRITE_FIREWALL_DENIAL);
    expect(() => db.query("DELETE FROM experience_events WHERE id = 'evt_1'").run())
      .toThrow(SESSION_MEMORY_WRITE_FIREWALL_DENIAL);

    expect(() => directJobInsert(db, "old_job")).toThrow(SESSION_MEMORY_WRITE_FIREWALL_DENIAL);
    createIngestJob(db, {
      id: "job_1",
      project_key: "demo",
      provider: "codex",
      input: {},
      now,
    });
    expect(() => db.query("UPDATE ingest_jobs SET status = 'running' WHERE id = 'job_1'").run())
      .toThrow(SESSION_MEMORY_WRITE_FIREWALL_DENIAL);
    expect(() => db.query("DELETE FROM ingest_jobs WHERE id = 'job_1'").run())
      .toThrow(SESSION_MEMORY_WRITE_FIREWALL_DENIAL);
    expect(updateIngestJobStatus(db, {
      id: "job_1",
      status: "running",
      started_at: now,
      updated_at: now,
    }).status).toBe("running");

    expect(() => db.query(
      `INSERT INTO experience_event_tombstones
        (id, original_event_id, project_key, ingest_job_id, claimed_at, state,
         source_metadata_json, retained_evidence_json, output_references_json)
       VALUES ('old_tomb', 'evt_1', 'demo', 'job_1', ?, 'claimed', '{}', '{}', '[]')`,
    ).run(now)).toThrow(SESSION_MEMORY_WRITE_FIREWALL_DENIAL);
    const leases = leaseExperienceEvents(db, {
      ingest_job_id: "job_1",
      project_key: "demo",
      limit: 1,
      claimed_at: now,
      tombstone_id_for: () => "tomb_1",
    });
    expect(leases).toHaveLength(1);
    expect(() => db.query(
      "UPDATE experience_event_tombstones SET terminal_decision = 'old' WHERE id = 'tomb_1'",
    ).run()).toThrow(SESSION_MEMORY_WRITE_FIREWALL_DENIAL);
    expect(() => withCompatibilityJobTransitionAdmission(db, "demo", "job_1", () => db.query(
      "UPDATE experience_event_tombstones SET terminal_decision = 'wrong-operation' WHERE id = 'tomb_1'",
    ).run())).toThrow(SESSION_MEMORY_WRITE_FIREWALL_DENIAL);
    expect(() => db.query("DELETE FROM experience_event_tombstones WHERE id = 'tomb_1'").run())
      .toThrow(SESSION_MEMORY_WRITE_FIREWALL_DENIAL);

    expect(() => db.query(
      `INSERT INTO session_memories
        (id, project_key, source_event_refs_json, memory_kind, summary, payload_json, confidence, risk,
         status, revision, state_digest, created_at, updated_at)
       VALUES ('old_mem', 'demo', '[]', 'continuity', 'old', '{}', 'high', 'low', 'active', 1,
         'sha256:0000000000000000000000000000000000000000000000000000000000000000', ?, ?)`,
    ).run(now, now)).toThrow(SESSION_MEMORY_WRITE_FIREWALL_DENIAL);

    withLegacySessionMutationAuthority(db, "demo", (authority) => {
      createSessionMemory(db, memory("mem_1", now), authority);
      createSessionMemory(db, memory("mem_2", now), authority);
      createSessionMemoryContexts(db, [{
        session_memory_id: "mem_1",
        project_key: "demo",
        repo_path: "/repo",
        source_event_ref: "tomb_1",
      }], authority);
      createSessionMemoryLink(db, {
        source_memory_id: "mem_1",
        target_memory_id: "mem_2",
        project_key: "demo",
        relationship: "refines",
        reason: "test",
        source_event_refs: ["tomb_1"],
        created_at: now,
      }, authority);
    });
    expect(() => db.query(
      `INSERT INTO session_memory_contexts
        (session_memory_id, project_key, source_event_ref)
       VALUES ('mem_1', 'demo', 'old_tomb')`,
    ).run()).toThrow(SESSION_MEMORY_WRITE_FIREWALL_DENIAL);
    expect(() => db.query(
      `INSERT INTO session_memory_links
        (source_memory_id, target_memory_id, project_key, relationship, reason, source_event_refs_json, created_at)
       VALUES ('mem_1', 'mem_2', 'demo', 'refines', 'old', '[]', ?)`,
    ).run(now)).toThrow(SESSION_MEMORY_WRITE_FIREWALL_DENIAL);
    for (const statement of [
      "UPDATE session_memories SET summary = 'old' WHERE id = 'mem_1'",
      "DELETE FROM session_memories WHERE id = 'mem_1'",
      "UPDATE session_memory_contexts SET repo_path = '/old' WHERE session_memory_id = 'mem_1'",
      "DELETE FROM session_memory_contexts WHERE session_memory_id = 'mem_1'",
      "UPDATE session_memory_links SET reason = 'old' WHERE source_memory_id = 'mem_1'",
      "DELETE FROM session_memory_links WHERE source_memory_id = 'mem_1'",
    ]) {
      expect(() => db.query(statement).run()).toThrow(SESSION_MEMORY_WRITE_FIREWALL_DENIAL);
    }

    expect(() => db.query(
      "INSERT INTO embedding_contracts (id, scope) VALUES ('old_session', 'session_memory')",
    ).run()).toThrow(SESSION_MEMORY_WRITE_FIREWALL_DENIAL);
    db.query(
      `INSERT INTO embedding_contracts
        (id, scope, embedding_provider, embedding_model, embedding_dimensions, format_version,
         lifecycle, vector_table, created_at, updated_at)
       VALUES ('project_direct', 'project_memory', 'ollama_nomic', 'nomic', 768, 1,
         'staging', 'project_vec', ?, ?)`,
    ).run(now, now);
    db.query("DELETE FROM embedding_contracts WHERE id = 'project_direct'").run();
    expect(upsertStagingEmbeddingContract(db, {
      scope: "session_memory",
      contract: { provider: "ollama_nomic", model: "firewall-test", dimensions: 768, formatVersion: 1 },
      now,
    }).scope).toBe("session_memory");
    expect(() => db.query(
      "UPDATE embedding_contracts SET updated_at = 'old' WHERE scope = 'session_memory'",
    ).run()).toThrow(SESSION_MEMORY_WRITE_FIREWALL_DENIAL);
    expect(() => db.query("DELETE FROM embedding_contracts WHERE scope = 'session_memory'").run())
      .toThrow(SESSION_MEMORY_WRITE_FIREWALL_DENIAL);

    db.transaction(() => finalizeLeasedExperienceEventsInOpenTransaction(db, {
      ingest_job_id: "job_1",
      tombstone_ids: ["tomb_1"],
      finalized_at: now,
      state: "output",
      terminal_decision: "used",
      output_references: ["session_memories/mem_1"],
    }))();
    expect(db.query("SELECT state FROM experience_event_tombstones WHERE id = 'tomb_1'").get())
      .toEqual({ state: "output" });
    expect(db.query("SELECT id FROM experience_events WHERE id = 'evt_1'").get()).toBeNull();
  } finally {
    db.close();
  }
});

test("admissions are invisible cross-connection and cannot survive commit", () => {
  const path = join(dir, "memory.db");
  const first = openMemoryDbAt(path);
  const second = openMemoryDbAt(path);
  try {
    createIngestJob(first, {
      id: "job_1",
      project_key: "demo",
      provider: "codex",
      input: {},
      now: "2026-08-11T10:00:00.000Z",
    });
    first.transaction(() => withCompatibilityJobTransitionAdmission(first, "demo", "job_1", () => {
      expect(second.query("SELECT count(*) AS count FROM session_memory_write_admissions").get())
        .toEqual({ count: 0 });
      first.query("UPDATE ingest_jobs SET status = 'running' WHERE id = 'job_1'").run();
    }))();
    expect(first.query("SELECT count(*) AS count FROM session_memory_write_admissions").get())
      .toEqual({ count: 0 });
    expect(() => second.query("UPDATE ingest_jobs SET status = 'failed' WHERE id = 'job_1'").run())
      .toThrow(SESSION_MEMORY_WRITE_FIREWALL_DENIAL);
    expect(() => withCompatibilityJobTransitionAdmission(first, "*", "job_1", () => first.query(
      "UPDATE ingest_jobs SET status = 'failed' WHERE id = 'job_1'",
    ).run())).toThrow(SESSION_MEMORY_WRITE_FIREWALL_DENIAL);

    expect(() => first.transaction(() => {
      first.query(
        `INSERT INTO session_memory_write_admissions
          (token, operation, project_or_scope, owner_id, owner_epoch, phase, created_at)
         VALUES ('committed', 'compat_job_transition', 'demo',
           'current-runtime-compatibility', 1, 'compatibility', CURRENT_TIMESTAMP)`,
      ).run();
    })()).toThrow("FOREIGN KEY constraint failed");
    expect(first.query("SELECT token FROM session_memory_write_admissions WHERE token = 'committed'").get()).toBeNull();
  } finally {
    second.close();
    first.close();
  }
});

test("active-mode admissions are bound to durable project and global authority", () => {
  const db = openMemoryDbAt(join(dir, "semantic-authority.db"));
  try {
    const now = "2026-08-11T10:00:00.000Z";
    db.query(
      "UPDATE session_memory_mutation_authority SET mode = 'smc_v1', updated_at = ? WHERE singleton_id = 1",
    ).run(now);
    const acquired = acquireProjectSessionMutationFence(db, {
      projectKey: "demo",
      ownerId: "anchor_job_1",
      ownerKind: "anchor_job",
      phase: "running",
      now,
    });
    if (acquired.kind !== "acquired") throw new Error("fixture failed to acquire project authority");
    const repair = acquireProjectSessionMutationFence(db, {
      projectKey: "repair-demo",
      ownerId: "repair_1",
      ownerKind: "repair",
      phase: "finalizing",
      now,
    });
    if (repair.kind !== "acquired") throw new Error("fixture failed to acquire repair authority");

    expect(() => db.transaction(() => db.query(
      `INSERT INTO session_memory_write_admissions
        (token, operation, project_or_scope, owner_id, owner_epoch, phase, created_at)
       VALUES ('legacy-clone', 'compat_canonical_apply', 'demo',
         'current-runtime-compatibility', 1, 'compatibility', CURRENT_TIMESTAMP)`,
    ).run())()).toThrow(`${SESSION_MEMORY_WRITE_FIREWALL_DENIAL}:authority_mismatch`);
    expect(() => db.transaction(() => db.query(
      `INSERT INTO session_memory_write_admissions
        (token, operation, project_or_scope, owner_id, owner_epoch, phase, created_at)
       VALUES ('repair-finalizing', 'repair_session_memory', 'repair-demo', 'repair_1', 1, 'finalizing', CURRENT_TIMESTAMP)`,
    ).run())()).toThrow(`${SESSION_MEMORY_WRITE_FIREWALL_DENIAL}:authority_mismatch`);
    expect(() => db.transaction(() => db.query(
      `INSERT INTO session_memory_write_admissions
        (token, operation, project_or_scope, owner_id, owner_epoch, phase, created_at)
       VALUES ('wrong-owner', 'anchor_finalize', 'demo', 'other-job', 1, 'running', CURRENT_TIMESTAMP)`,
    ).run())()).toThrow(`${SESSION_MEMORY_WRITE_FIREWALL_DENIAL}:authority_mismatch`);
    expect(() => withCompatibilityJobTransitionAdmission(db, "demo", "job_1", () => undefined))
      .toThrow("session_memory_legacy_authority_rejected");
    expect(() => registerInitialActiveEmbeddingContract(db, {
      scope: "session_memory",
      contract: {
        provider: "ollama_nomic",
        model: "active-mode-registration-must-use-lifecycle",
        dimensions: 768,
        formatVersion: 1,
      },
      now,
    })).toThrow("session_memory_legacy_authority_rejected");
    expect(() => db.transaction(() => db.query(
      `INSERT INTO session_memory_write_admissions
        (token, operation, project_or_scope, owner_id, owner_epoch, phase, created_at)
       VALUES ('running-anchor', 'anchor_finalize', 'demo', 'anchor_job_1', 1, 'running', CURRENT_TIMESTAMP)`,
    ).run())()).toThrow(`${SESSION_MEMORY_WRITE_FIREWALL_DENIAL}:authority_mismatch`);
    expect(() => db.transaction(() => db.query(
      `INSERT INTO session_memory_write_admissions
        (token, operation, project_or_scope, owner_id, owner_epoch, phase, created_at)
       VALUES ('legacy-lifecycle', 'session_embedding_lifecycle', 'session_memory',
         'current-runtime-compatibility', 1, 'compatibility', CURRENT_TIMESTAMP)`,
    ).run())()).toThrow(`${SESSION_MEMORY_WRITE_FIREWALL_DENIAL}:authority_mismatch`);

    expect(() => createSessionMemory(
      db,
      { ...memory("running_anchor_mem", now), ingest_job_id: null },
      acquired.authority,
    )).toThrow("session_memory_project_fence_wrong_phase");
    const transitioned = transitionProjectSessionMutationFence(db, {
      authority: acquired.authority,
      expectedPhase: "running",
      nextPhase: "finalizing",
      now: "2026-08-11T10:01:00.000Z",
    });
    if (transitioned.kind !== "updated") throw new Error("fixture failed to enter finalizing phase");

    createSessionMemory(db, { ...memory("fenced_mem", now), ingest_job_id: null }, transitioned.authority);
    createSessionMemory(db, { ...memory("fenced_target", now), ingest_job_id: null }, transitioned.authority);
    createSessionMemoryContexts(db, [{
      session_memory_id: "fenced_mem",
      project_key: "demo",
      source_event_ref: "finalizing",
    }], transitioned.authority);
    createSessionMemoryLink(db, {
      source_memory_id: "fenced_mem",
      target_memory_id: "fenced_target",
      project_key: "demo",
      relationship: "refines",
      reason: "finalizing",
      source_event_refs: [],
      created_at: now,
    }, transitioned.authority);
    expect(db.query("SELECT id FROM session_memories WHERE id = 'fenced_mem'").get())
      .toEqual({ id: "fenced_mem" });
    expect(db.query("SELECT count(*) AS count FROM session_memory_write_admissions").get())
      .toEqual({ count: 0 });
  } finally {
    db.close();
  }
});

test("frozen pre-firewall runtime is denied at exact launcher, child, and provider-return barriers", async () => {
  const now = "2026-08-11T10:00:00.000Z";

  const preSpawnPath = join(dir, "pre-spawn.db");
  const preSpawn = version15Runtime(preSpawnPath, ["job_pre_spawn"]);
  let preSpawnCalls = 0;
  expect(() => runFrozenPreFirewallLauncher({
    db: preSpawn,
    jobId: "job_pre_spawn",
    now,
    beforeSpawn: () => migrateHeldOpenRuntime(preSpawnPath),
    spawn: () => {
      preSpawnCalls += 1;
      return { pid: 101, logPath: "/tmp/pre-spawn.log" };
    },
  })).toThrow(SESSION_MEMORY_WRITE_FIREWALL_DENIAL);
  expect(preSpawnCalls).toBe(1);
  expect(preSpawn.query(
    "SELECT status, followup_state_json FROM ingest_jobs WHERE id = 'job_pre_spawn'",
  ).get()).toEqual({ status: "starting", followup_state_json: null });
  preSpawn.close();

  const postSpawnPath = join(dir, "post-spawn.db");
  const postSpawn = version15Runtime(postSpawnPath, ["job_post_spawn"]);
  let postSpawnCalls = 0;
  expect(() => runFrozenPreFirewallLauncher({
    db: postSpawn,
    jobId: "job_post_spawn",
    now,
    spawn: () => {
      postSpawnCalls += 1;
      return { pid: 202, logPath: "/tmp/post-spawn.log" };
    },
    afterSpawnBeforePidPersist: () => migrateHeldOpenRuntime(postSpawnPath),
  })).toThrow(SESSION_MEMORY_WRITE_FIREWALL_DENIAL);
  expect(postSpawnCalls).toBe(1);
  expect(postSpawn.query(
    "SELECT status, followup_state_json FROM ingest_jobs WHERE id = 'job_post_spawn'",
  ).get()).toEqual({ status: "starting", followup_state_json: null });
  postSpawn.close();

  const pidNullPath = join(dir, "pid-null-child.db");
  const pidNull = version15Runtime(pidNullPath, ["job_pid_null_child"]);
  expect(() => runFrozenPreFirewallPidNullChild({
    db: pidNull,
    jobId: "job_pid_null_child",
    now,
    onChildStartBeforeRunningPersist: () => migrateHeldOpenRuntime(pidNullPath),
  })).toThrow(SESSION_MEMORY_WRITE_FIREWALL_DENIAL);
  expect(pidNull.query(
    "SELECT status, followup_state_json FROM ingest_jobs WHERE id = 'job_pid_null_child'",
  ).get()).toEqual({ status: "starting", followup_state_json: null });
  pidNull.close();

  const providerPath = join(dir, "provider-return.db");
  const provider = version15Runtime(providerPath, ["job_provider_return"], "evt_provider");
  let providerCalls = 0;
  await expect(runFrozenPreFirewallProviderWorker({
    db: provider,
    projectKey: "demo",
    jobId: "job_provider_return",
    eventId: "evt_provider",
    tombstoneId: "tomb_provider",
    candidateId: "candidate_provider",
    now,
    provider: async () => { providerCalls += 1; },
    afterProviderReturnBeforeApply: () => {
      const current = openMemoryDbAt(providerPath);
      try {
        const activation = new AuthorityActivationService({
          now: () => new Date("2026-08-11T10:01:00.000Z"),
        }).activate(current);
        expect(activation).toEqual({
          kind: "activated",
          authority_mode: "smc_v1",
          quarantined_job_ids: ["job_provider_return"],
        });
        expect(current.query(
          "SELECT mode FROM session_memory_mutation_authority WHERE singleton_id = 1",
        ).get()).toEqual({ mode: "smc_v1" });
        expect(current.query(
          "SELECT job_id FROM legacy_session_job_deny_identities WHERE job_id = 'job_provider_return'",
        ).get()).toEqual({ job_id: "job_provider_return" });
        expect(current.query(
          "SELECT phase, reason_code FROM session_memory_anchor_jobs WHERE job_id = 'job_provider_return'",
        ).get()).toEqual({
          phase: "needs_followup",
          reason_code: "legacy_state_missing_smc_manifest",
        });
        expect(current.query(
          "SELECT owner_id, phase FROM project_session_mutation_fences WHERE project_key = 'demo'",
        ).get()).toEqual({ owner_id: "job_provider_return", phase: "needs_followup" });
      } finally {
        current.close();
      }
    },
  })).rejects.toThrow(SESSION_MEMORY_WRITE_FIREWALL_DENIAL);
  expect(providerCalls).toBe(1);
  expect(provider.query("SELECT id FROM memory_candidates WHERE id = 'candidate_provider'").get()).toBeNull();
  expect(provider.query("SELECT state FROM experience_event_tombstones WHERE id = 'tomb_provider'").get())
    .toEqual({ state: "claimed" });
  expect(provider.query("SELECT id FROM experience_events WHERE id = 'evt_provider'").get())
    .toEqual({ id: "evt_provider" });
  expect(provider.query(
    "SELECT status FROM ingest_jobs WHERE id = 'job_provider_return'",
  ).get()).toEqual({ status: "needs_followup" });
  expect(recordExperienceEvent(provider, event("evt_after_migration"), new Date())?.id)
    .toBe("evt_after_migration");
  provider.close();
});

test.each(["direct-source", "installed-locator"] as const)(
  "frozen runtime is denied through the %s entrypoint route",
  async (route) => {
    const path = join(dir, `${route}.db`);
    version15Runtime(path, [`job_${route}`]).close();
    const readyPath = join(dir, `${route}.ready`);
    const releasePath = join(dir, `${route}.release`);
    const runtimeRoot = join(import.meta.dir, "..", "fixtures", "pre-firewall-runtime-root");
    const args = [
      "post-spawn-pre-pid",
      path,
      `job_${route}`,
      readyPath,
      releasePath,
      route,
    ];
    const env = { ...process.env };
    delete env[INTERNAL_INVOCATION_KIND_ENV];
    delete env[INTERNAL_LAUNCHER_PATH_ENV];
    delete env[INTERNAL_LOCATOR_PATH_ENV];
    delete env.MYELIN_ROOT;

    const command = route === "direct-source"
      ? [process.execPath, join(runtimeRoot, "src", "cli.ts"), ...args]
      : [await installedFixtureLauncher(runtimeRoot), ...args];
    const child = Bun.spawn(command, { cwd: runtimeRoot, env, stdout: "pipe", stderr: "pipe" });
    await waitForBarrier(readyPath);
    expect(JSON.parse(await readFile(readyPath, "utf8"))).toEqual({
      route,
      job_id: `job_${route}`,
    });

    migrateHeldOpenRuntime(path);
    await writeFile(releasePath, "release", "utf8");

    expect(await child.exited).not.toBe(0);
    expect(await new Response(child.stderr).text()).toContain(SESSION_MEMORY_WRITE_FIREWALL_DENIAL);
    const inspected = new Database(path);
    try {
      expect(inspected.query(
        "SELECT status, followup_state_json FROM ingest_jobs WHERE id = ?",
      ).get(`job_${route}`)).toEqual({ status: "starting", followup_state_json: null });
    } finally {
      inspected.close();
    }
  },
);

function event(id: string) {
  return {
    id,
    project_key: "demo",
    occurred_at: "2026-08-11T09:00:00.000Z",
    event_kind: "user.prompt",
    provider: "codex",
    raw_text: "remember this",
    raw_payload_json: "{}",
    source: "test",
    status: "valid" as const,
  };
}

function memory(id: string, now: string) {
  return {
    id,
    project_key: "demo",
    ingest_job_id: "job_1",
    source_event_refs: ["tomb_1"],
    memory_kind: "continuity" as const,
    summary: id,
    payload: {},
    confidence: "high",
    risk: "low",
    now,
    embedding_contract: null,
  };
}

function directJobInsert(db: Database, id: string): void {
  db.query(
    `INSERT INTO ingest_jobs
      (id, project_key, status, provider, input_json, output_counts_json, created_at, updated_at)
     VALUES (?, 'demo', 'starting', 'codex', '{}', '{}', 'now', 'now')`,
  ).run(id);
}

function downgradeToVersion15(db: Database): void {
  db.exec("PRAGMA foreign_keys = OFF;");
  const triggers = db.query("SELECT name FROM sqlite_master WHERE type = 'trigger' AND name LIKE 'smwf_%'").all() as Array<{ name: string }>;
  for (const { name } of triggers) db.exec(`DROP TRIGGER ${name};`);
  db.exec(`
    DROP TABLE IF EXISTS session_memory_audit_receipts;
    DROP TABLE IF EXISTS smc_terminal_receipts;
    DROP TABLE IF EXISTS smc_budget_grants;
    DROP TABLE IF EXISTS smc_coverage_receipts;
    DROP TABLE IF EXISTS smc_action_journal;
    DROP TABLE IF EXISTS smc_curator_action_charges;
    DROP TABLE IF EXISTS smc_curator_fetch_receipts;
    DROP TABLE IF EXISTS smc_curator_batch_channel_plans;
    DROP TABLE IF EXISTS smc_overlay_search_indexes;
    DROP TABLE IF EXISTS smc_overlay_records;
    DROP TABLE IF EXISTS smc_overlay_revisions;
    DROP TABLE IF EXISTS smc_overlay_state;
    DROP TABLE IF EXISTS smc_retrieval_snapshot_completeness;
    DROP TABLE IF EXISTS smc_memory_snapshot_vectors;
    DROP TABLE IF EXISTS smc_memory_snapshot_search_texts;
    DROP TABLE IF EXISTS smc_memory_snapshot_links;
    DROP TABLE IF EXISTS smc_memory_snapshot_contexts;
    DROP TABLE IF EXISTS smc_memory_snapshot;
    DROP TABLE IF EXISTS smc_no_agent_intents;
    DROP TABLE IF EXISTS smc_evidence_batch_members;
    DROP TABLE IF EXISTS smc_audit_batch_members;
    DROP TABLE IF EXISTS smc_work_batches;
    DROP TABLE IF EXISTS smc_evidence_snapshot;
    DROP TABLE IF EXISTS smc_manifests;
    DROP TABLE IF EXISTS session_memory_anchor_attempts;
    DROP TABLE IF EXISTS session_memory_anchor_jobs;
    DROP TABLE IF EXISTS legacy_session_job_deny_identities;
    DROP TABLE IF EXISTS session_embedding_lifecycle_receipts;
    DROP TABLE IF EXISTS session_embedding_lifecycle_fence;
    DROP TABLE IF EXISTS session_embedding_lifecycle_generation;
    DROP TABLE IF EXISTS project_session_mutation_fences;
    DROP TABLE IF EXISTS session_memory_mutation_authority;
    DROP TABLE IF EXISTS session_memory_write_admissions;
    DROP TABLE IF EXISTS session_memory_write_admission_commit_blocker;
    DROP TABLE IF EXISTS session_memory_legacy_write_firewall;
    DELETE FROM schema_migrations WHERE version >= 16;

    CREATE TABLE session_memories_v15 AS
      SELECT id, project_key, provider, provider_session_id, ingest_job_id, source_event_refs_json,
             memory_kind, title, summary, payload_json, confidence, risk, status, superseded_by,
             lifecycle_reason, superseded_at, retracted_at, created_at, updated_at
      FROM session_memories;
    DROP TABLE session_memories;
    ALTER TABLE session_memories_v15 RENAME TO session_memories;
  `);
  db.exec("PRAGMA foreign_keys = ON;");
}

function version15Runtime(path: string, jobIds: string[], eventId?: string): Database {
  const db = openMemoryDbAt(path);
  downgradeToVersion15(db);
  for (const jobId of jobIds) directJobInsertWithStatus(db, jobId, "starting");
  if (eventId) {
    db.query(
      `INSERT INTO experience_events
        (id, project_key, occurred_at, event_kind, provider, raw_text, raw_payload_json, source,
         status, inserted_at)
       VALUES (?, 'demo', 'now', 'user.prompt', 'codex', 'evidence', '{}', 'test', 'valid', 'now')`,
    ).run(eventId);
  }
  return db;
}

function migrateHeldOpenRuntime(path: string): void {
  const current = openMemoryDbAt(path);
  current.close();
}

async function installedFixtureLauncher(runtimeRoot: string): Promise<string> {
  const launcherPath = join(dir, "bin", "myelin");
  const locatorPath = join(dir, "home", ".myelin", "install.json");
  const content = renderLauncher(locatorPath);
  await promoteLauncher(launcherPath, content);
  await mkdir(join(dir, "home", ".myelin"), { recursive: true });
  await writeFile(locatorPath, JSON.stringify({
    schema_version: 1,
    myelin_root: runtimeRoot,
    launcher: { path: launcherPath, sha256: launcherSha256(content) },
    providers: {},
    installed_at: "2026-08-11T00:00:00.000Z",
    updated_at: "2026-08-11T00:00:00.000Z",
    source_revision: null,
  }), "utf8");
  return launcherPath;
}

async function waitForBarrier(path: string): Promise<void> {
  for (let attempt = 0; attempt < 1000; attempt += 1) {
    if (await Bun.file(path).exists()) return;
    await Bun.sleep(5);
  }
  throw new Error(`timed out waiting for frozen runtime barrier: ${path}`);
}

function directJobInsertWithStatus(db: Database, id: string, status: string): void {
  db.query(
    `INSERT INTO ingest_jobs
      (id, project_key, status, provider, input_json, output_counts_json, created_at, updated_at)
     VALUES (?, 'demo', ?, 'codex', '{}', '{}', 'now', 'now')`,
  ).run(id, status);
}
