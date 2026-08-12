import { randomUUID } from "node:crypto";
import type { Database } from "bun:sqlite";
import {
  ProjectSessionMutationAuthorityError,
  readSessionMemoryMutationAuthorityMode,
  resolveProjectSessionWriteAdmissionIdentity,
  type ProjectSessionMutationAuthority,
} from "./project-session-mutation-fence.ts";
import {
  resolveSessionEmbeddingLifecycleWriteAdmissionIdentity,
  type SessionEmbeddingLifecycleAuthority,
} from "./session-embedding-lifecycle-fence.ts";

export const SESSION_MEMORY_WRITE_FIREWALL_DENIAL = "session_memory_legacy_write_denied";

export const SESSION_MEMORY_WRITE_OPERATIONS = [
  "compat_job_create",
  "compat_job_transition",
  "compat_event_lease",
  "compat_event_finalize",
  "compat_canonical_apply",
  "repair_session_memory",
  "register_session_embedding_contract",
  "session_embedding_lifecycle",
  "migrate_legacy_anchor",
  "anchor_prepare",
  "anchor_resume",
  "anchor_finalize",
  "anchor_abandon",
  "migration_16",
] as const;

export type SessionMemoryWriteOperation = (typeof SESSION_MEMORY_WRITE_OPERATIONS)[number];

type RuntimeAdmissionOperation = Exclude<SessionMemoryWriteOperation, "migration_16">;

type RuntimeAdmissionIdentity = {
  ownerId: string;
  ownerEpoch: number;
  phase: string;
};

const COMPATIBILITY_IDENTITY: RuntimeAdmissionIdentity = {
  ownerId: "current-runtime-compatibility",
  ownerEpoch: 1,
  phase: "compatibility",
};

export function withCompatibilityJobCreateAdmission<T>(
  db: Database,
  projectKey: string,
  callback: () => T,
): T {
  assertLegacyCompatibilityMode(db);
  return withRuntimeAdmission(db, "compat_job_create", projectKey, COMPATIBILITY_IDENTITY, callback);
}

export function withCompatibilityJobTransitionAdmission<T>(
  db: Database,
  projectKey: string,
  ownerJobId: string,
  callback: () => T,
): T {
  assertLegacyCompatibilityMode(db);
  assertLegacyJobOwnerNotDenied(db, ownerJobId);
  return withRuntimeAdmission(db, "compat_job_transition", projectKey, COMPATIBILITY_IDENTITY, callback);
}

export function withMigrateLegacyAnchorAdmission<T>(
  db: Database,
  input: { projectKey: string; targetJobId: string },
  callback: () => T,
): T {
  assertLegacyJobOwnerDenied(db, input.targetJobId, input.projectKey);
  return withRuntimeAdmission(db, "migrate_legacy_anchor", input.projectKey, {
    ownerId: "session-memory-authority-activation",
    ownerEpoch: 1,
    phase: "activating",
  }, callback, input.targetJobId);
}

export function withAnchorLifecycleAdmission<T>(
  db: Database,
  input: {
    operation: "anchor_resume" | "anchor_finalize" | "anchor_abandon";
    projectKey: string;
    ownerId: string;
    ownerEpoch: number;
    phase: string;
    targetId?: string;
  },
  callback: () => T,
): T {
  return withRuntimeAdmission(db, input.operation, input.projectKey, {
    ownerId: input.ownerId,
    ownerEpoch: input.ownerEpoch,
    phase: input.phase,
  }, callback, input.targetId);
}

export function withAnchorPrepareAdmission<T>(
  db: Database,
  input: { projectKey: string; ownerId: string; ownerEpoch: number; phase: "preparing" },
  callback: () => T,
): T {
  return withRuntimeAdmission(db, "anchor_prepare", input.projectKey, {
    ownerId: input.ownerId,
    ownerEpoch: input.ownerEpoch,
    phase: input.phase,
  }, callback);
}

export function withCompatibilityEventLeaseAdmission<T>(
  db: Database,
  projectKey: string,
  callback: () => T,
): T {
  assertLegacyCompatibilityMode(db);
  return withRuntimeAdmission(db, "compat_event_lease", projectKey, COMPATIBILITY_IDENTITY, callback);
}

export function withCompatibilityEventFinalizeAdmission<T>(
  db: Database,
  projectKey: string,
  callback: () => T,
): T {
  assertLegacyCompatibilityMode(db);
  return withRuntimeAdmission(db, "compat_event_finalize", projectKey, COMPATIBILITY_IDENTITY, callback);
}

export function withCompatibilityCanonicalApplyAdmission<T>(
  db: Database,
  projectKey: string,
  callback: () => T,
): T {
  assertLegacyCompatibilityMode(db);
  return withRuntimeAdmission(db, "compat_canonical_apply", projectKey, COMPATIBILITY_IDENTITY, callback);
}

export function withProjectSessionCanonicalWriteAdmission<T>(
  db: Database,
  projectKey: string,
  authority: ProjectSessionMutationAuthority,
  callback: () => T,
): T {
  const identity = resolveProjectSessionWriteAdmissionIdentity(db, authority, projectKey);
  if (identity.authorityKind === "legacy_compatibility") {
    return withRuntimeAdmission(db, "compat_canonical_apply", projectKey, {
      ownerId: identity.ownerId,
      ownerEpoch: identity.ownerEpoch,
      phase: identity.phase,
    }, callback);
  }
  const operation = identity.ownerKind === "repair" ? "repair_session_memory" : "anchor_finalize";
  return withRuntimeAdmission(db, operation, projectKey, {
    ownerId: identity.ownerId,
    ownerEpoch: identity.ownerEpoch,
    phase: identity.phase,
  }, callback);
}

export function withRegisterSessionEmbeddingContractAdmission<T>(db: Database, callback: () => T): T {
  assertLegacyCompatibilityMode(db);
  return withRuntimeAdmission(
    db,
    "register_session_embedding_contract",
    "session_memory",
    COMPATIBILITY_IDENTITY,
    callback,
  );
}

export function withSessionEmbeddingLifecycleAdmission<T>(
  db: Database,
  authority: SessionEmbeddingLifecycleAuthority,
  callback: () => T,
): T {
  const identity = resolveSessionEmbeddingLifecycleWriteAdmissionIdentity(db, authority);
  return withRuntimeAdmission(db, "session_embedding_lifecycle", "session_memory", {
    ownerId: identity.operationId,
    ownerEpoch: identity.ownerEpoch,
    phase: identity.phase,
  }, callback);
}

export function withCompatibilitySessionEmbeddingLifecycleAdmission<T>(db: Database, callback: () => T): T {
  if (hasOpenAdmission(db, "session_embedding_lifecycle", "session_memory")) return callback();
  assertLegacyCompatibilityMode(db);
  return withRuntimeAdmission(
    db,
    "session_embedding_lifecycle",
    "session_memory",
    COMPATIBILITY_IDENTITY,
    callback,
  );
}

export function createSessionMemoryWriteFirewallSchema(db: Database): void {
  db.exec(`
    CREATE TABLE session_memory_legacy_write_firewall (
      singleton_id INTEGER PRIMARY KEY CHECK (singleton_id = 1),
      state        TEXT NOT NULL CHECK (state = 'closed'),
      closed_at    TEXT NOT NULL
    );

    CREATE TABLE session_memory_write_admission_commit_blocker (
      id INTEGER PRIMARY KEY
    );

    CREATE TABLE session_memory_write_admissions (
      token            TEXT PRIMARY KEY,
      operation        TEXT NOT NULL CHECK (operation IN (${SESSION_MEMORY_WRITE_OPERATIONS.map(sqlString).join(", ")})),
      project_or_scope TEXT NOT NULL CHECK (length(project_or_scope) > 0),
      owner_id         TEXT NOT NULL CHECK (length(owner_id) > 0),
      owner_epoch      INTEGER NOT NULL CHECK (owner_epoch > 0),
      phase            TEXT NOT NULL CHECK (length(phase) > 0),
      created_at       TEXT NOT NULL,
      commit_blocker   INTEGER NOT NULL DEFAULT 1
        REFERENCES session_memory_write_admission_commit_blocker(id)
        DEFERRABLE INITIALLY DEFERRED
    );

    INSERT INTO session_memory_legacy_write_firewall (singleton_id, state, closed_at)
    VALUES (1, 'closed', CURRENT_TIMESTAMP);
  `);
}

export function installSessionMemoryWriteFirewallGuards(
  db: Database,
  input: { sessionMemoryTable: string; sessionMemoryTriggerPrefix: string; includeSharedTables: boolean },
): void {
  const memoryTable = quotedIdentifier(input.sessionMemoryTable);
  const memoryPrefix = identifier(input.sessionMemoryTriggerPrefix);
  installCanonicalTableGuards(db, memoryTable, memoryPrefix, "NEW.project_key", "OLD.project_key");

  if (!input.includeSharedTables) return;
  installTableGuards(db, "ingest_jobs", "smwf_ingest_jobs", "NEW.project_key", "OLD.project_key", {
    insert: ["compat_job_create", "anchor_prepare", "migration_16"],
    update: ["compat_job_transition", "migrate_legacy_anchor", "anchor_resume", "anchor_finalize", "anchor_abandon", "migration_16"],
    delete: ["migration_16"],
  });
  installTableGuards(
    db,
    "experience_event_tombstones",
    "smwf_experience_event_tombstones",
    "NEW.project_key",
    "OLD.project_key",
    {
      insert: ["compat_event_lease", "anchor_prepare", "migration_16"],
      update: ["compat_event_lease", "migrate_legacy_anchor", "anchor_resume", "anchor_finalize", "anchor_abandon", "migration_16"],
      delete: ["migration_16"],
    },
  );
  installTableGuards(db, "experience_events", "smwf_experience_events", "NEW.project_key", "OLD.project_key", {
    update: ["migration_16"],
    delete: ["compat_event_finalize", "anchor_finalize", "migration_16"],
  });
  installCanonicalTableGuards(
    db,
    "session_memory_contexts",
    "smwf_session_memory_contexts",
    "NEW.project_key",
    "OLD.project_key",
  );
  installCanonicalTableGuards(
    db,
    "session_memory_links",
    "smwf_session_memory_links",
    "NEW.project_key",
    "OLD.project_key",
  );
  installEmbeddingContractGuards(db);
}

export function assertSessionMemoryWriteFirewallInstalled(db: Database, memoryTriggerPrefix = "smwf_session_memories"): void {
  const expected = [
    ["session_memories", `${memoryTriggerPrefix}_insert`],
    ["session_memories", `${memoryTriggerPrefix}_update`],
    ["session_memories", `${memoryTriggerPrefix}_delete`],
    ["ingest_jobs", "smwf_ingest_jobs_insert"],
    ["ingest_jobs", "smwf_ingest_jobs_update"],
    ["ingest_jobs", "smwf_ingest_jobs_delete"],
    ["experience_event_tombstones", "smwf_experience_event_tombstones_insert"],
    ["experience_event_tombstones", "smwf_experience_event_tombstones_update"],
    ["experience_event_tombstones", "smwf_experience_event_tombstones_delete"],
    ["experience_events", "smwf_experience_events_update"],
    ["experience_events", "smwf_experience_events_delete"],
    ["session_memory_contexts", "smwf_session_memory_contexts_insert"],
    ["session_memory_contexts", "smwf_session_memory_contexts_update"],
    ["session_memory_contexts", "smwf_session_memory_contexts_delete"],
    ["session_memory_links", "smwf_session_memory_links_insert"],
    ["session_memory_links", "smwf_session_memory_links_update"],
    ["session_memory_links", "smwf_session_memory_links_delete"],
    ["embedding_contracts", "smwf_embedding_contracts_insert_session"],
    ["embedding_contracts", "smwf_embedding_contracts_update_session"],
    ["embedding_contracts", "smwf_embedding_contracts_delete_session"],
  ] as const;
  const rows = db.query(
    `SELECT name FROM sqlite_master
     WHERE type = 'trigger' AND name LIKE 'smwf_%'
     ORDER BY name`,
  ).all() as Array<{ name: string }>;
  const actual = new Set(rows.map((row) => row.name));
  for (const [table, name] of expected) {
    if (!tableExists(db, table)) continue;
    if (!actual.has(name)) throw new Error(`Session Memory write firewall trigger is missing: ${name}`);
  }
  const state = db.query(
    "SELECT state FROM session_memory_legacy_write_firewall WHERE singleton_id = 1",
  ).get() as { state: string } | null;
  if (state?.state !== "closed") throw new Error("Session Memory legacy-write firewall is not closed");
}

export function installProjectAuthorityAdmissionValidation(db: Database): void {
  if (!tableExists(db, "session_memory_write_admissions")) return;
  db.exec(`
    DROP TRIGGER IF EXISTS smwf_admission_validate_legacy;
    DROP TRIGGER IF EXISTS smwf_admission_validate_project_fence;

    CREATE TRIGGER smwf_admission_validate_legacy
    BEFORE INSERT ON session_memory_write_admissions
    WHEN NEW.operation IN (
      'compat_job_create', 'compat_job_transition', 'compat_event_lease', 'compat_event_finalize',
      'compat_canonical_apply', 'register_session_embedding_contract'
    )
      AND NOT (
        NEW.owner_id = 'current-runtime-compatibility'
        AND NEW.owner_epoch = 1
        AND NEW.phase = 'compatibility'
        AND EXISTS (
          SELECT 1 FROM session_memory_mutation_authority
          WHERE singleton_id = 1 AND mode = 'legacy_compatibility'
        )
      )
    BEGIN
      SELECT RAISE(ABORT, '${SESSION_MEMORY_WRITE_FIREWALL_DENIAL}:authority_mismatch');
    END;

    CREATE TRIGGER smwf_admission_validate_project_fence
    BEFORE INSERT ON session_memory_write_admissions
    WHEN NEW.operation IN (
      'repair_session_memory', 'migrate_legacy_anchor', 'anchor_prepare', 'anchor_resume',
      'anchor_finalize', 'anchor_abandon'
    )
      AND NOT (
        (
          NEW.operation = 'migrate_legacy_anchor'
          AND NEW.owner_id = 'session-memory-authority-activation'
          AND NEW.owner_epoch = 1
          AND NEW.phase = 'activating'
          AND EXISTS (
            SELECT 1 FROM session_memory_mutation_authority
            WHERE singleton_id = 1 AND mode = 'legacy_compatibility'
          )
          AND EXISTS (
            SELECT 1 FROM legacy_session_job_deny_identities d
            WHERE d.project_key = NEW.project_or_scope AND d.job_id = NEW.target_id
          )
        )
        OR EXISTS (
          SELECT 1
          FROM project_session_mutation_fences f
          JOIN session_memory_mutation_authority m
            ON m.singleton_id = 1 AND m.mode = 'smc_v1'
          WHERE f.project_key = NEW.project_or_scope
            AND f.owner_id = NEW.owner_id
            AND f.owner_epoch = NEW.owner_epoch
            AND f.phase = NEW.phase
            AND NOT EXISTS (
              SELECT 1 FROM legacy_session_job_deny_identities d
              WHERE d.job_id = NEW.owner_id
            )
            AND (
              (
                NEW.operation = 'repair_session_memory'
                AND f.owner_kind = 'repair'
                AND f.phase = 'running'
              )
              OR (
                NEW.operation = 'anchor_finalize'
                AND f.owner_kind = 'anchor_job'
                AND f.phase = 'finalizing'
              )
              OR (
                NEW.operation NOT IN ('repair_session_memory', 'anchor_finalize', 'migrate_legacy_anchor')
                AND f.owner_kind = 'anchor_job'
                AND (
                  NEW.operation <> 'anchor_abandon'
                  OR (
                    NEW.target_id IS NOT NULL
                    AND NEW.owner_id GLOB 'smc-abandonment-service:*'
                    AND NEW.owner_id <> NEW.target_id
                    AND EXISTS (
                      SELECT 1 FROM session_memory_anchor_jobs target
                      WHERE target.job_id = NEW.target_id
                        AND target.project_key = NEW.project_or_scope
                        AND target.owner_epoch = NEW.owner_epoch
                        AND target.phase = NEW.phase
                    )
                  )
                )
              )
            )
        )
      )
    BEGIN
      SELECT RAISE(ABORT, '${SESSION_MEMORY_WRITE_FIREWALL_DENIAL}:authority_mismatch');
    END;

    DROP TRIGGER IF EXISTS smwf_anchor_abandon_ingest_exact_target;
    CREATE TRIGGER smwf_anchor_abandon_ingest_exact_target
    BEFORE UPDATE ON ingest_jobs
    WHEN EXISTS (
      SELECT 1 FROM session_memory_write_admissions a
      WHERE a.operation = 'anchor_abandon' AND a.project_or_scope = NEW.project_key
    )
      AND NOT EXISTS (
        SELECT 1 FROM session_memory_write_admissions a
        WHERE a.operation = 'anchor_abandon'
          AND a.project_or_scope = NEW.project_key
          AND a.target_id = NEW.id
      )
    BEGIN
      SELECT RAISE(ABORT, '${SESSION_MEMORY_WRITE_FIREWALL_DENIAL}:target_mismatch');
    END;

  `);
  if (tableExists(db, "experience_event_tombstones")) {
    db.exec(`
      DROP TRIGGER IF EXISTS smwf_anchor_abandon_tombstone_exact_target;
      CREATE TRIGGER smwf_anchor_abandon_tombstone_exact_target
      BEFORE UPDATE ON experience_event_tombstones
      WHEN EXISTS (
        SELECT 1 FROM session_memory_write_admissions a
        WHERE a.operation = 'anchor_abandon' AND a.project_or_scope = OLD.project_key
      )
        AND NOT EXISTS (
          SELECT 1 FROM session_memory_write_admissions a
          WHERE a.operation = 'anchor_abandon'
            AND a.project_or_scope = OLD.project_key
            AND a.target_id = OLD.ingest_job_id
        )
      BEGIN
        SELECT RAISE(ABORT, '${SESSION_MEMORY_WRITE_FIREWALL_DENIAL}:target_mismatch');
      END;
    `);
  }
}

export function installEmbeddingLifecycleAdmissionValidation(db: Database): void {
  if (!tableExists(db, "session_memory_write_admissions")) return;
  db.exec(`
    CREATE TRIGGER smwf_admission_validate_session_embedding_lifecycle
    BEFORE INSERT ON session_memory_write_admissions
    WHEN NEW.operation = 'session_embedding_lifecycle'
      AND NOT (
        (
          NEW.owner_id = 'current-runtime-compatibility'
          AND NEW.owner_epoch = 1
          AND NEW.phase = 'compatibility'
          AND NEW.project_or_scope = 'session_memory'
          AND EXISTS (
            SELECT 1 FROM session_memory_mutation_authority
            WHERE singleton_id = 1 AND mode = 'legacy_compatibility'
          )
        )
        OR EXISTS (
          SELECT 1
          FROM session_embedding_lifecycle_fence f
          JOIN session_memory_mutation_authority m
            ON m.singleton_id = 1 AND m.mode = 'smc_v1'
          WHERE f.operation_id = NEW.owner_id
            AND f.owner_epoch = NEW.owner_epoch
            AND f.phase = NEW.phase
            AND NEW.project_or_scope = 'session_memory'
        )
      )
    BEGIN
      SELECT RAISE(ABORT, '${SESSION_MEMORY_WRITE_FIREWALL_DENIAL}:authority_mismatch');
    END;
  `);
}

function withRuntimeAdmission<T>(
  db: Database,
  operation: RuntimeAdmissionOperation,
  projectOrScope: string,
  identity: RuntimeAdmissionIdentity,
  callback: () => T,
  targetId?: string,
): T {
  if (!firewallExists(db)) return callback();
  const run = (): T => withAdmissionInOpenTransaction(db, {
    operation,
    projectOrScope,
    ownerId: identity.ownerId,
    ownerEpoch: identity.ownerEpoch,
    phase: identity.phase,
    targetId,
  }, callback);
  return db.inTransaction ? run() : db.transaction(run).immediate();
}

function withAdmissionInOpenTransaction<T>(
  db: Database,
  input: {
    operation: SessionMemoryWriteOperation;
    projectOrScope: string;
    ownerId: string;
    ownerEpoch: number;
    phase: string;
    targetId?: string;
  },
  callback: () => T,
): T {
  if (!db.inTransaction) throw new Error("Session Memory write admission requires an open transaction");
  const token = randomUUID();
  const hasTargetColumn = db.query("PRAGMA table_info(session_memory_write_admissions)").all()
    .some((row) => (row as { name: string }).name === "target_id");
  if (hasTargetColumn) {
    db.query(
      `INSERT INTO session_memory_write_admissions
        (token, operation, project_or_scope, owner_id, owner_epoch, phase, target_id, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)`,
    ).run(token, input.operation, input.projectOrScope, input.ownerId, input.ownerEpoch, input.phase, input.targetId ?? null);
  } else {
    db.query(
      `INSERT INTO session_memory_write_admissions
        (token, operation, project_or_scope, owner_id, owner_epoch, phase, created_at)
       VALUES (?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)`,
    ).run(token, input.operation, input.projectOrScope, input.ownerId, input.ownerEpoch, input.phase);
  }
  try {
    return callback();
  } finally {
    const result = db.query("DELETE FROM session_memory_write_admissions WHERE token = ?").run(token);
    if (result.changes !== 1) throw new Error("Session Memory write admission was not revoked");
  }
}

function firewallExists(db: Database): boolean {
  return Boolean(db.query(
    "SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'session_memory_legacy_write_firewall'",
  ).get());
}

function hasOpenAdmission(db: Database, operation: SessionMemoryWriteOperation, projectOrScope: string): boolean {
  if (!db.inTransaction || !firewallExists(db)) return false;
  return Boolean(db.query(
    `SELECT 1 FROM session_memory_write_admissions
     WHERE operation = ? AND project_or_scope = ?
     LIMIT 1`,
  ).get(operation, projectOrScope));
}

function assertLegacyCompatibilityMode(db: Database): void {
  if (!firewallExists(db)) return;
  const hasAuthorityTable = Boolean(db.query(
    "SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'session_memory_mutation_authority'",
  ).get());
  if (!hasAuthorityTable) return;
  if (readSessionMemoryMutationAuthorityMode(db) !== "legacy_compatibility") {
    throw new ProjectSessionMutationAuthorityError(
      "session_memory_legacy_authority_rejected",
      "Session Memory compatibility write admission is unavailable after SMC authority activation",
    );
  }
}

export function isLegacySessionJobOwnerDenied(db: Database, jobId: string): boolean {
  if (!tableExists(db, "legacy_session_job_deny_identities")) return false;
  return Boolean(db.query(
    "SELECT 1 FROM legacy_session_job_deny_identities WHERE job_id = ?",
  ).get(jobId));
}

export function assertLegacySessionJobOwnerNotDenied(db: Database, jobId: string): void {
  assertLegacyJobOwnerNotDenied(db, jobId);
}

function assertLegacyJobOwnerNotDenied(db: Database, jobId: string): void {
  if (isLegacySessionJobOwnerDenied(db, jobId)) {
    throw new ProjectSessionMutationAuthorityError(
      "session_memory_legacy_authority_rejected",
      `legacy Session Memory job identity is permanently denied: ${jobId}`,
    );
  }
}

function assertLegacyJobOwnerDenied(db: Database, jobId: string, projectKey: string): void {
  const row = tableExists(db, "legacy_session_job_deny_identities")
    ? db.query(
      "SELECT project_key FROM legacy_session_job_deny_identities WHERE job_id = ?",
    ).get(jobId) as { project_key: string } | null
    : null;
  if (!row || row.project_key !== projectKey) {
    throw new ProjectSessionMutationAuthorityError(
      "session_memory_legacy_authority_rejected",
      `migration target is not a denied legacy Session Memory job: ${jobId}`,
    );
  }
}

function installCanonicalTableGuards(
  db: Database,
  table: string,
  prefix: string,
  insertScope: string,
  oldScope: string,
): void {
  installTableGuards(db, table, prefix, insertScope, oldScope, {
    insert: ["compat_canonical_apply", "repair_session_memory", "anchor_finalize", "migration_16"],
    update: ["compat_canonical_apply", "repair_session_memory", "anchor_finalize", "migration_16"],
    delete: ["compat_canonical_apply", "repair_session_memory", "anchor_finalize", "migration_16"],
  });
}

function installTableGuards(
  db: Database,
  table: string,
  prefix: string,
  newScope: string,
  oldScope: string,
  operations: {
    insert?: readonly SessionMemoryWriteOperation[];
    update?: readonly SessionMemoryWriteOperation[];
    delete?: readonly SessionMemoryWriteOperation[];
  },
): void {
  if (!tableExists(db, unquoteIdentifier(table))) return;
  if (operations.insert) installGuard(db, `${prefix}_insert`, "INSERT", table, newScope, operations.insert);
  if (operations.update) installGuard(db, `${prefix}_update`, "UPDATE", table, oldScope, operations.update, newScope);
  if (operations.delete) installGuard(db, `${prefix}_delete`, "DELETE", table, oldScope, operations.delete);
}

function installGuard(
  db: Database,
  name: string,
  verb: "INSERT" | "UPDATE" | "DELETE",
  table: string,
  scopeExpression: string,
  operations: readonly SessionMemoryWriteOperation[],
  secondScopeExpression?: string,
): void {
  const operationPredicate = operations.length === 0
    ? "0"
    : `a.operation IN (${operations.map(sqlString).join(", ")})`;
  const exactScopePredicate = secondScopeExpression
    ? `a.project_or_scope = ${scopeExpression} AND a.project_or_scope = ${secondScopeExpression}`
    : `a.project_or_scope = ${scopeExpression}`;
  const scopePredicate = `(a.operation = 'migration_16' OR (${exactScopePredicate}))`;
  db.exec(`
    CREATE TRIGGER ${identifier(name)}
    BEFORE ${verb} ON ${table}
    WHEN NOT EXISTS (
      SELECT 1
      FROM session_memory_legacy_write_firewall f
      JOIN session_memory_write_admissions a
        ON f.singleton_id = 1 AND f.state = 'closed'
      WHERE ${operationPredicate}
        AND ${scopePredicate}
        AND a.owner_epoch > 0
        AND length(a.owner_id) > 0
        AND length(a.phase) > 0
    )
    BEGIN
      SELECT RAISE(ABORT, '${SESSION_MEMORY_WRITE_FIREWALL_DENIAL}');
    END;
  `);
}

function installEmbeddingContractGuards(db: Database): void {
  if (!tableExists(db, "embedding_contracts")) return;
  db.exec(`
    CREATE TRIGGER smwf_embedding_contracts_insert_session
    BEFORE INSERT ON embedding_contracts
    WHEN NEW.scope = 'session_memory'
      AND NOT EXISTS (
        SELECT 1 FROM session_memory_write_admissions a
        WHERE a.operation IN ('register_session_embedding_contract', 'session_embedding_lifecycle', 'migration_16')
          AND a.project_or_scope = 'session_memory'
          AND a.owner_epoch > 0 AND length(a.owner_id) > 0 AND length(a.phase) > 0
      )
    BEGIN
      SELECT RAISE(ABORT, '${SESSION_MEMORY_WRITE_FIREWALL_DENIAL}');
    END;

    CREATE TRIGGER smwf_embedding_contracts_update_session
    BEFORE UPDATE ON embedding_contracts
    WHEN (OLD.scope = 'session_memory' OR NEW.scope = 'session_memory')
      AND NOT EXISTS (
        SELECT 1 FROM session_memory_write_admissions a
        WHERE a.operation IN ('session_embedding_lifecycle', 'migration_16')
          AND a.project_or_scope = 'session_memory'
          AND a.owner_epoch > 0 AND length(a.owner_id) > 0 AND length(a.phase) > 0
      )
    BEGIN
      SELECT RAISE(ABORT, '${SESSION_MEMORY_WRITE_FIREWALL_DENIAL}');
    END;

    CREATE TRIGGER smwf_embedding_contracts_delete_session
    BEFORE DELETE ON embedding_contracts
    WHEN OLD.scope = 'session_memory'
      AND NOT EXISTS (
        SELECT 1 FROM session_memory_write_admissions a
        WHERE a.operation IN ('session_embedding_lifecycle', 'migration_16')
          AND a.project_or_scope = 'session_memory'
          AND a.owner_epoch > 0 AND length(a.owner_id) > 0 AND length(a.phase) > 0
      )
    BEGIN
      SELECT RAISE(ABORT, '${SESSION_MEMORY_WRITE_FIREWALL_DENIAL}');
    END;
  `);
}

function tableExists(db: Database, table: string): boolean {
  return Boolean(db.query("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?").get(table));
}

function identifier(value: string): string {
  if (!/^[a-z_][a-z0-9_]*$/i.test(value)) throw new Error(`Unsafe SQLite identifier: ${value}`);
  return value;
}

function quotedIdentifier(value: string): string {
  return `"${identifier(value)}"`;
}

function unquoteIdentifier(value: string): string {
  return value.startsWith('"') && value.endsWith('"') ? value.slice(1, -1) : value;
}

function sqlString(value: string): string {
  return `'${value.replaceAll("'", "''")}'`;
}
