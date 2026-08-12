import type { Database } from "bun:sqlite";
import type {
  ProjectSessionMutationFenceOwnerKind,
  ProjectSessionMutationFencePhase,
  ProjectSessionMutationFenceRow,
  SessionMemoryMutationAuthorityMode,
} from "./ingest-types.ts";
import type { SessionEmbeddingLifecycleFenceSafeOwner } from "./embedding-contract-lifecycle-types.ts";

declare const LEGACY_AUTHORITY_TYPE: unique symbol;
declare const FENCED_AUTHORITY_TYPE: unique symbol;

export type LegacySessionMutationAuthority = Readonly<{
  [LEGACY_AUTHORITY_TYPE]: "legacy_session_mutation_authority";
}>;

export type FencedSessionMutationAuthority = Readonly<{
  [FENCED_AUTHORITY_TYPE]: "fenced_session_mutation_authority";
}>;

export type ProjectSessionMutationAuthority =
  | LegacySessionMutationAuthority
  | FencedSessionMutationAuthority;

export type ProjectSessionWriteAdmissionIdentity = {
  authorityKind: "legacy_compatibility" | "project_fence";
  projectKey: string;
  ownerId: string;
  ownerEpoch: number;
  phase: string;
  ownerKind: ProjectSessionMutationFenceOwnerKind | null;
};

type LegacyAuthorityIdentity = {
  db: Database;
  projectKey: string;
  ownerJobId: string | null;
};

type FencedAuthorityIdentity = {
  db: Database;
  projectKey: string;
  ownerId: string;
  ownerEpoch: number;
};

const legacyAuthorityIdentities = new WeakMap<object, LegacyAuthorityIdentity>();
const fencedAuthorityIdentities = new WeakMap<object, FencedAuthorityIdentity>();

type AcquirableProjectSessionMutationFencePhase = Exclude<
  ProjectSessionMutationFencePhase,
  "completed" | "abandoned"
>;

export type ProjectSessionMutationFenceSafeOwner = Pick<
  ProjectSessionMutationFenceRow,
  "project_key" | "owner_id" | "owner_kind" | "phase" | "owner_epoch" | "heartbeat_at" | "acquired_at"
> & { stale: boolean | null };

export type ProjectSessionMutationFenceFailureCode =
  | "session_memory_authority_not_activated"
  | "session_memory_legacy_authority_rejected"
  | "session_memory_project_busy"
  | "session_embedding_lifecycle_busy"
  | "session_memory_project_fence_not_found"
  | "session_memory_project_fence_wrong_owner"
  | "session_memory_project_fence_stale_epoch"
  | "session_memory_project_fence_wrong_phase"
  | "session_memory_project_fence_not_terminal"
  | "session_memory_authority_transaction_required"
  | "session_memory_authority_database_mismatch"
  | "session_memory_authority_project_mismatch"
  | "session_memory_authority_invalid";

export class ProjectSessionMutationAuthorityError extends Error {
  constructor(
    readonly code: ProjectSessionMutationFenceFailureCode,
    message: string,
  ) {
    super(`${code}: ${message}`);
    this.name = "ProjectSessionMutationAuthorityError";
  }
}

export type ProjectSessionMutationFenceAcquireResult =
  | {
    kind: "acquired";
    authority: FencedSessionMutationAuthority;
    fence: ProjectSessionMutationFenceRow;
  }
  | {
    kind: "not_activated";
    code: "session_memory_authority_not_activated";
    authority_mode: "legacy_compatibility";
  }
  | {
    kind: "busy";
    code: "session_memory_project_busy";
    owner: ProjectSessionMutationFenceSafeOwner;
  }
  | {
    kind: "global_busy";
    code: "session_embedding_lifecycle_busy";
    owner: SessionEmbeddingLifecycleFenceSafeOwner;
  };

export type ProjectSessionMutationFenceCasFailure = {
  kind: "rejected";
  code: Exclude<
    ProjectSessionMutationFenceFailureCode,
    | "session_memory_project_busy"
    | "session_embedding_lifecycle_busy"
    | "session_memory_legacy_authority_rejected"
    | "session_memory_authority_transaction_required"
    | "session_memory_authority_database_mismatch"
    | "session_memory_authority_project_mismatch"
    | "session_memory_authority_invalid"
  >;
  fence: ProjectSessionMutationFenceRow | null;
};

export type ProjectSessionMutationFenceCasResult =
  | {
    kind: "updated";
    authority: FencedSessionMutationAuthority;
    fence: ProjectSessionMutationFenceRow;
  }
  | ProjectSessionMutationFenceCasFailure;

export function readSessionMemoryMutationAuthorityMode(db: Database): SessionMemoryMutationAuthorityMode {
  const row = db
    .query("SELECT mode FROM session_memory_mutation_authority WHERE singleton_id = 1")
    .get() as { mode: SessionMemoryMutationAuthorityMode } | null;
  if (!row) throw new Error("Session Memory mutation authority mode is missing");
  return row.mode;
}

export function withLegacySessionMutationAuthority<T>(
  db: Database,
  projectKey: string,
  callback: (authority: LegacySessionMutationAuthority) => T,
  ownerJobId: string | null = null,
): T {
  return inImmediateTransaction(db, () => {
    const mode = readSessionMemoryMutationAuthorityMode(db);
    if (mode !== "legacy_compatibility") {
      throw new ProjectSessionMutationAuthorityError(
        "session_memory_legacy_authority_rejected",
        `legacy Session Memory mutation authority is unavailable in ${mode} mode`,
      );
    }
    if (ownerJobId) assertLegacyJobOwnerNotDenied(db, ownerJobId);
    const authority = Object.freeze(Object.create(null)) as LegacySessionMutationAuthority;
    legacyAuthorityIdentities.set(authority, { db, projectKey, ownerJobId });
    try {
      return callback(authority);
    } finally {
      legacyAuthorityIdentities.delete(authority);
    }
  });
}

export function assertProjectSessionMutationAuthority(
  db: Database,
  authority: ProjectSessionMutationAuthority,
  projectKey: string,
): void {
  assertOpenTransaction(db);
  const authorityObject = authorityObjectOrThrow(authority);
  const legacyIdentity = legacyAuthorityIdentities.get(authorityObject);
  if (legacyIdentity) {
    assertAuthorityDatabase(legacyIdentity.db, db);
    assertAuthorityProject(legacyIdentity.projectKey, projectKey);
    const mode = readSessionMemoryMutationAuthorityMode(db);
    if (mode !== "legacy_compatibility") {
      throw new ProjectSessionMutationAuthorityError(
        "session_memory_legacy_authority_rejected",
        `legacy Session Memory mutation authority is unavailable in ${mode} mode`,
      );
    }
    if (legacyIdentity.ownerJobId) {
      assertLegacyJobOwnerNotDenied(db, legacyIdentity.ownerJobId);
    }
    return;
  }

  const identity = fencedAuthorityIdentities.get(authorityObject);
  if (!identity) throwInvalidAuthority();
  assertAuthorityDatabase(identity.db, db);
  assertAuthorityProject(identity.projectKey, projectKey);
  if (readSessionMemoryMutationAuthorityMode(db) !== "smc_v1") {
    throw new ProjectSessionMutationAuthorityError(
      "session_memory_authority_not_activated",
      "project-fenced Session Memory mutation authority is dormant",
    );
  }
  const fence = inspectProjectSessionMutationFence(db, projectKey);
  if (!fence) {
    throw new ProjectSessionMutationAuthorityError(
      "session_memory_project_fence_not_found",
      `no Session Memory mutation fence exists for ${projectKey}`,
    );
  }
  if (fence.owner_id !== identity.ownerId) {
    throw new ProjectSessionMutationAuthorityError(
      "session_memory_project_fence_wrong_owner",
      `the Session Memory mutation fence for ${projectKey} belongs to another owner`,
    );
  }
  if (fence.owner_epoch !== identity.ownerEpoch) {
    throw new ProjectSessionMutationAuthorityError(
      "session_memory_project_fence_stale_epoch",
      `Session Memory mutation authority epoch ${identity.ownerEpoch} is stale`,
    );
  }
  const writable = fence.owner_kind === "repair"
    ? fence.phase === "running"
    : fence.owner_kind === "anchor_job" && fence.phase === "finalizing";
  if (!writable) {
    throw new ProjectSessionMutationAuthorityError(
      "session_memory_project_fence_wrong_phase",
      `Session Memory mutation fence for ${projectKey} is not writable (${fence.phase})`,
    );
  }
}

export function resolveProjectSessionWriteAdmissionIdentity(
  db: Database,
  authority: ProjectSessionMutationAuthority,
  projectKey: string,
): ProjectSessionWriteAdmissionIdentity {
  assertProjectSessionMutationAuthority(db, authority, projectKey);
  const authorityObject = authorityObjectOrThrow(authority);
  const legacyIdentity = legacyAuthorityIdentities.get(authorityObject);
  if (legacyIdentity) {
    return {
      authorityKind: "legacy_compatibility",
      projectKey,
      ownerId: "current-runtime-compatibility",
      ownerEpoch: 1,
      phase: "compatibility",
      ownerKind: null,
    };
  }
  const identity = fencedAuthorityIdentities.get(authorityObject);
  if (!identity) throwInvalidAuthority();
  const fence = inspectProjectSessionMutationFence(db, projectKey);
  if (!fence) {
    throw new ProjectSessionMutationAuthorityError(
      "session_memory_project_fence_not_found",
      `no Session Memory mutation fence exists for ${projectKey}`,
    );
  }
  return {
    authorityKind: "project_fence",
    projectKey,
    ownerId: fence.owner_id,
    ownerEpoch: fence.owner_epoch,
    phase: fence.phase,
    ownerKind: fence.owner_kind,
  };
}

export function acquireProjectSessionMutationFence(
  db: Database,
  input: {
    projectKey: string;
    ownerId: string;
    ownerKind: ProjectSessionMutationFenceOwnerKind;
    phase: AcquirableProjectSessionMutationFencePhase;
    now: string;
    staleBefore?: string;
  },
): ProjectSessionMutationFenceAcquireResult {
  if (db.inTransaction) {
    throw new ProjectSessionMutationAuthorityError(
      "session_memory_authority_transaction_required",
      "acquireProjectSessionMutationFence must own its BEGIN IMMEDIATE transaction; use the InOpenTransaction variant only from an immediate coordinator transaction",
    );
  }
  return db.transaction(() => acquireProjectSessionMutationFenceInOpenTransaction(db, input)).immediate();
}

/**
 * Acquires within a caller-owned BEGIN IMMEDIATE transaction. The caller must
 * establish that transaction before invoking this coordinator-only variant.
 */
export function acquireProjectSessionMutationFenceInOpenTransaction(
  db: Database,
  input: {
    projectKey: string;
    ownerId: string;
    ownerKind: ProjectSessionMutationFenceOwnerKind;
    phase: AcquirableProjectSessionMutationFencePhase;
    now: string;
    staleBefore?: string;
  },
): ProjectSessionMutationFenceAcquireResult {
  assertOpenTransaction(db);
  if (readSessionMemoryMutationAuthorityMode(db) !== "smc_v1") {
    return {
      kind: "not_activated",
      code: "session_memory_authority_not_activated",
      authority_mode: "legacy_compatibility",
    };
  }
  assertLegacyJobOwnerNotDenied(db, input.ownerId);
  const globalFence = inspectSessionEmbeddingLifecycleFenceForAdmission(db);
  if (globalFence) {
    return {
      kind: "global_busy",
      code: "session_embedding_lifecycle_busy",
      owner: globalFence,
    };
  }
  const occupied = inspectProjectSessionMutationFence(db, input.projectKey);
  if (occupied) {
    return {
      kind: "busy",
      code: "session_memory_project_busy",
      owner: safeOwner(occupied, input.staleBefore),
    };
  }
  db.query(
    `INSERT INTO project_session_mutation_fences
      (project_key, owner_id, owner_kind, phase, owner_epoch, heartbeat_at, acquired_at, terminal_receipt_id)
     VALUES (?, ?, ?, ?, 1, ?, ?, NULL)`,
  ).run(input.projectKey, input.ownerId, input.ownerKind, input.phase, input.now, input.now);
  const fence = requireFence(db, input.projectKey);
  return {
    kind: "acquired",
    authority: issueFencedAuthority(db, fence),
    fence,
  };
}

function inspectSessionEmbeddingLifecycleFenceForAdmission(
  db: Database,
): SessionEmbeddingLifecycleFenceSafeOwner | null {
  return (db.query(
    `SELECT operation_id, operation_kind, phase, owner_epoch, heartbeat_at, acquired_at,
            active_contract_id, target_contract_id
     FROM session_embedding_lifecycle_fence
     WHERE singleton_id = 1`,
  ).get() as SessionEmbeddingLifecycleFenceSafeOwner | null) ?? null;
}

export function heartbeatProjectSessionMutationFence(
  db: Database,
  input: {
    authority: FencedSessionMutationAuthority;
    expectedPhase: ProjectSessionMutationFencePhase;
    now: string;
  },
): ProjectSessionMutationFenceCasResult {
  return inImmediateTransaction(db, () => {
    const identity = fencedIdentityOrThrow(db, input.authority);
    if (readSessionMemoryMutationAuthorityMode(db) !== "smc_v1") {
      return { kind: "rejected", code: "session_memory_authority_not_activated", fence: null };
    }
    const result = db.query(
      `UPDATE project_session_mutation_fences
       SET heartbeat_at = ?
       WHERE project_key = ? AND owner_id = ? AND owner_epoch = ? AND phase = ?`,
    ).run(input.now, identity.projectKey, identity.ownerId, identity.ownerEpoch, input.expectedPhase);
    if (result.changes !== 1) return diagnoseCasFailure(db, identity, input.expectedPhase);
    const fence = requireFence(db, identity.projectKey);
    return { kind: "updated", authority: input.authority, fence };
  });
}

export function transitionProjectSessionMutationFence(
  db: Database,
  input: {
    authority: FencedSessionMutationAuthority;
    expectedPhase: ProjectSessionMutationFencePhase;
    nextPhase: ProjectSessionMutationFencePhase;
    now: string;
    terminalReceiptId?: string | null;
  },
): ProjectSessionMutationFenceCasResult {
  return inImmediateTransaction(db, () => {
    const identity = fencedIdentityOrThrow(db, input.authority);
    if (readSessionMemoryMutationAuthorityMode(db) !== "smc_v1") {
      return { kind: "rejected", code: "session_memory_authority_not_activated", fence: null };
    }
    if (!isAllowedTransition(input.expectedPhase, input.nextPhase)) {
      return {
        kind: "rejected",
        code: "session_memory_project_fence_wrong_phase",
        fence: inspectProjectSessionMutationFence(db, identity.projectKey),
      };
    }
    if (!isTerminalPhase(input.nextPhase) && input.terminalReceiptId != null) {
      return {
        kind: "rejected",
        code: "session_memory_project_fence_wrong_phase",
        fence: inspectProjectSessionMutationFence(db, identity.projectKey),
      };
    }
    const rotateAuthority = input.nextPhase === "needs_followup"
      || (input.expectedPhase === "needs_followup" && input.nextPhase === "running");
    const nextEpoch = identity.ownerEpoch + (rotateAuthority ? 1 : 0);
    const result = db.query(
      `UPDATE project_session_mutation_fences
       SET phase = ?, owner_epoch = ?, heartbeat_at = ?, terminal_receipt_id = ?
       WHERE project_key = ? AND owner_id = ? AND owner_epoch = ? AND phase = ?`,
    ).run(
      input.nextPhase,
      nextEpoch,
      input.now,
      input.terminalReceiptId ?? null,
      identity.projectKey,
      identity.ownerId,
      identity.ownerEpoch,
      input.expectedPhase,
    );
    if (result.changes !== 1) return diagnoseCasFailure(db, identity, input.expectedPhase);
    const fence = requireFence(db, identity.projectKey);
    return { kind: "updated", authority: issueFencedAuthority(db, fence), fence };
  });
}

export function releaseProjectSessionMutationFence(
  db: Database,
  authority: FencedSessionMutationAuthority,
): { kind: "released" } | ProjectSessionMutationFenceCasFailure {
  return inImmediateTransaction(db, () => {
    const identity = fencedIdentityOrThrow(db, authority);
    if (readSessionMemoryMutationAuthorityMode(db) !== "smc_v1") {
      return { kind: "rejected", code: "session_memory_authority_not_activated", fence: null };
    }
    const fence = inspectProjectSessionMutationFence(db, identity.projectKey);
    if (!fence) return diagnoseCasFailure(db, identity, null);
    if (fence.owner_id !== identity.ownerId || fence.owner_epoch !== identity.ownerEpoch) {
      return diagnoseCasFailure(db, identity, null);
    }
    if (!isTerminalPhase(fence.phase)) {
      return {
        kind: "rejected",
        code: "session_memory_project_fence_not_terminal",
        fence,
      };
    }
    const result = db.query(
      `DELETE FROM project_session_mutation_fences
       WHERE project_key = ? AND owner_id = ? AND owner_epoch = ? AND phase = ?`,
    ).run(identity.projectKey, identity.ownerId, identity.ownerEpoch, fence.phase);
    if (result.changes !== 1) return diagnoseCasFailure(db, identity, fence.phase);
    return { kind: "released" };
  });
}

export function inspectProjectSessionMutationFence(
  db: Database,
  projectKey: string,
): ProjectSessionMutationFenceRow | null {
  return (db
    .query("SELECT * FROM project_session_mutation_fences WHERE project_key = ?")
    .get(projectKey) as ProjectSessionMutationFenceRow | null) ?? null;
}

/**
 * Issues the canonical-write capability only to the trusted finalizer after it
 * has already established the exact finalizing owner inside its transaction.
 */
export function issueFinalizingProjectSessionMutationAuthorityInOpenTransaction(
  db: Database,
  input: { projectKey: string; ownerId: string; ownerEpoch: number },
): FencedSessionMutationAuthority {
  assertOpenTransaction(db);
  const fence = requireFence(db, input.projectKey);
  if (
    fence.owner_kind !== "anchor_job"
    || fence.owner_id !== input.ownerId
    || fence.owner_epoch !== input.ownerEpoch
    || fence.phase !== "finalizing"
  ) {
    throw new ProjectSessionMutationAuthorityError(
      "session_memory_project_fence_wrong_owner",
      "finalization authority requires the exact current finalizing anchor owner",
    );
  }
  return issueFencedAuthority(db, fence);
}

function diagnoseCasFailure(
  db: Database,
  identity: FencedAuthorityIdentity,
  expectedPhase: ProjectSessionMutationFencePhase | null,
): ProjectSessionMutationFenceCasFailure {
  if (readSessionMemoryMutationAuthorityMode(db) !== "smc_v1") {
    return { kind: "rejected", code: "session_memory_authority_not_activated", fence: null };
  }
  const fence = inspectProjectSessionMutationFence(db, identity.projectKey);
  if (!fence) return { kind: "rejected", code: "session_memory_project_fence_not_found", fence: null };
  if (fence.owner_id !== identity.ownerId) {
    return { kind: "rejected", code: "session_memory_project_fence_wrong_owner", fence };
  }
  if (fence.owner_epoch !== identity.ownerEpoch) {
    return { kind: "rejected", code: "session_memory_project_fence_stale_epoch", fence };
  }
  if (expectedPhase !== null && fence.phase !== expectedPhase) {
    return { kind: "rejected", code: "session_memory_project_fence_wrong_phase", fence };
  }
  return { kind: "rejected", code: "session_memory_project_fence_wrong_phase", fence };
}

function safeOwner(
  fence: ProjectSessionMutationFenceRow,
  staleBefore: string | undefined,
): ProjectSessionMutationFenceSafeOwner {
  return {
    project_key: fence.project_key,
    owner_id: fence.owner_id,
    owner_kind: fence.owner_kind,
    phase: fence.phase,
    owner_epoch: fence.owner_epoch,
    heartbeat_at: fence.heartbeat_at,
    acquired_at: fence.acquired_at,
    stale: staleBefore === undefined ? null : fence.heartbeat_at < staleBefore,
  };
}

function issueFencedAuthority(
  db: Database,
  fence: ProjectSessionMutationFenceRow,
): FencedSessionMutationAuthority {
  const authority = Object.freeze(Object.create(null)) as FencedSessionMutationAuthority;
  fencedAuthorityIdentities.set(authority, {
    db,
    projectKey: fence.project_key,
    ownerId: fence.owner_id,
    ownerEpoch: fence.owner_epoch,
  });
  return authority;
}

function fencedIdentityOrThrow(
  db: Database,
  authority: FencedSessionMutationAuthority,
): FencedAuthorityIdentity {
  const identity = fencedAuthorityIdentities.get(authorityObjectOrThrow(authority));
  if (!identity) throwInvalidAuthority();
  assertAuthorityDatabase(identity.db, db);
  return identity;
}

function authorityObjectOrThrow(authority: ProjectSessionMutationAuthority): object {
  if ((typeof authority !== "object" && typeof authority !== "function") || authority === null) {
    throwInvalidAuthority();
  }
  return authority;
}

function throwInvalidAuthority(): never {
  throw new ProjectSessionMutationAuthorityError(
    "session_memory_authority_invalid",
    "canonical Session Memory mutation requires an issued authority capability",
  );
}

function assertAuthorityDatabase(expected: Database, actual: Database): void {
  if (expected !== actual) {
    throw new ProjectSessionMutationAuthorityError(
      "session_memory_authority_database_mismatch",
      "Session Memory mutation authority belongs to another Database connection",
    );
  }
}

function assertAuthorityProject(expected: string, actual: string): void {
  if (expected !== actual) {
    throw new ProjectSessionMutationAuthorityError(
      "session_memory_authority_project_mismatch",
      `authority for ${expected} cannot mutate ${actual}`,
    );
  }
}

function assertLegacyJobOwnerNotDenied(db: Database, jobId: string): void {
  const denyTableExists = Boolean(db.query(
    "SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'legacy_session_job_deny_identities'",
  ).get());
  if (!denyTableExists) return;
  if (db.query("SELECT 1 FROM legacy_session_job_deny_identities WHERE job_id = ?").get(jobId)) {
    throw new ProjectSessionMutationAuthorityError(
      "session_memory_legacy_authority_rejected",
      `legacy Session Memory job identity is permanently denied: ${jobId}`,
    );
  }
}

function requireFence(db: Database, projectKey: string): ProjectSessionMutationFenceRow {
  const fence = inspectProjectSessionMutationFence(db, projectKey);
  if (!fence) throw new Error(`Session Memory mutation fence disappeared for ${projectKey}`);
  return fence;
}

function assertOpenTransaction(db: Database): void {
  if (!db.inTransaction) {
    throw new ProjectSessionMutationAuthorityError(
      "session_memory_authority_transaction_required",
      "Session Memory mutation fence operation requires an open transaction",
    );
  }
}

function inImmediateTransaction<T>(db: Database, callback: () => T): T {
  return db.inTransaction ? callback() : db.transaction(callback).immediate();
}

function isTerminalPhase(phase: ProjectSessionMutationFencePhase): boolean {
  return phase === "completed" || phase === "abandoned";
}

function isAllowedTransition(
  current: ProjectSessionMutationFencePhase,
  next: ProjectSessionMutationFencePhase,
): boolean {
  const allowed: Record<ProjectSessionMutationFencePhase, readonly ProjectSessionMutationFencePhase[]> = {
    preparing: ["running", "needs_followup", "completed", "abandoned"],
    running: ["needs_followup", "finalizing", "completed", "abandoned"],
    needs_followup: ["running", "abandoned"],
    finalizing: ["needs_followup", "completed", "abandoned"],
    completed: [],
    abandoned: [],
  };
  return allowed[current].includes(next);
}
