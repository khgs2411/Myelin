import { createHash } from "node:crypto";
import type { Database } from "bun:sqlite";
import type { ProjectSessionMutationFenceRow } from "./ingest-types.ts";
import {
  readSessionMemoryMutationAuthorityMode,
  type ProjectSessionMutationFenceSafeOwner,
} from "./project-session-mutation-fence.ts";
import type {
  SessionEmbeddingLifecycleFenceAcquireResult,
  SessionEmbeddingLifecycleFenceCasFailure,
  SessionEmbeddingLifecycleFenceCasResult,
  SessionEmbeddingLifecycleFenceFailureCode,
  SessionEmbeddingLifecycleFencePhase,
  SessionEmbeddingLifecycleFenceRow,
  SessionEmbeddingLifecycleFenceSafeOwner,
  SessionEmbeddingLifecycleOperationKind,
  SessionEmbeddingLifecycleReceipt,
  SessionEmbeddingLifecycleReceiptOutcome,
  SessionEmbeddingLifecycleTerminalResult,
} from "./embedding-contract-lifecycle-types.ts";

declare const SESSION_EMBEDDING_LIFECYCLE_AUTHORITY_TYPE: unique symbol;

export type SessionEmbeddingLifecycleAuthority = Readonly<{
  [SESSION_EMBEDDING_LIFECYCLE_AUTHORITY_TYPE]: "session_embedding_lifecycle_authority";
}>;

export type SessionEmbeddingLifecycleWriteAdmissionIdentity = {
  operationId: string;
  ownerEpoch: number;
  phase: SessionEmbeddingLifecycleFencePhase;
};

type AuthorityIdentity = {
  db: Database;
  operationId: string;
  generation: number;
  ownerEpoch: number;
  activeContractId: string | null;
  targetContractId: string | null;
  operationPlanDigest: string;
};

const authorityIdentities = new WeakMap<object, AuthorityIdentity>();

export class SessionEmbeddingLifecycleFenceError extends Error {
  constructor(
    readonly code: SessionEmbeddingLifecycleFenceFailureCode,
    message: string,
    readonly owner?: SessionEmbeddingLifecycleFenceSafeOwner | ProjectSessionMutationFenceSafeOwner,
  ) {
    super(`${code}: ${message}`);
    this.name = "SessionEmbeddingLifecycleFenceError";
  }
}

export function sessionEmbeddingLifecycleOperationId(input: {
  operationKind: SessionEmbeddingLifecycleOperationKind;
  operationPlanDigest: string;
  generation: number;
}): string {
  const digest = createHash("sha256")
    .update(JSON.stringify({
      operation_kind: input.operationKind,
      operation_plan_digest: input.operationPlanDigest,
      generation: input.generation,
    }))
    .digest("hex");
  return `session-embedding-${input.operationKind}-${digest}`;
}

export function sessionEmbeddingLifecycleReceiptId(input: {
  operationId: string;
  outcome: SessionEmbeddingLifecycleReceiptOutcome;
  resultDigest: string;
}): string {
  const digest = createHash("sha256")
    .update(`${input.operationId}\0${input.outcome}\0${input.resultDigest}`)
    .digest("hex");
  return `session-embedding-receipt-${digest}`;
}

export function acquireSessionEmbeddingLifecycleFence(
  db: Database,
  input: {
    operationKind: SessionEmbeddingLifecycleOperationKind;
    activeContractId: string | null;
    targetContractId: string | null;
    operationPlanJson: string;
    operationPlanDigest: string;
    now: string;
    staleBefore?: string;
    replayReceiptId?: string;
  },
): SessionEmbeddingLifecycleFenceAcquireResult<SessionEmbeddingLifecycleAuthority> {
  if (db.inTransaction) {
    throw new SessionEmbeddingLifecycleFenceError(
      "session_embedding_lifecycle_transaction_required",
      "acquireSessionEmbeddingLifecycleFence must own its BEGIN IMMEDIATE transaction",
    );
  }
  return db.transaction(() => acquireSessionEmbeddingLifecycleFenceInOpenTransaction(db, input)).immediate();
}

export function acquireSessionEmbeddingLifecycleFenceInOpenTransaction(
  db: Database,
  input: {
    operationKind: SessionEmbeddingLifecycleOperationKind;
    activeContractId: string | null;
    targetContractId: string | null;
    operationPlanJson: string;
    operationPlanDigest: string;
    now: string;
    staleBefore?: string;
    replayReceiptId?: string;
  },
): SessionEmbeddingLifecycleFenceAcquireResult<SessionEmbeddingLifecycleAuthority> {
  assertOpenTransaction(db);
  if (readSessionMemoryMutationAuthorityMode(db) !== "smc_v1") {
    return {
      kind: "not_activated",
      code: "session_memory_authority_not_activated",
      authority_mode: "legacy_compatibility",
    };
  }
  const canonicalPlanDigest = `sha256:${createHash("sha256").update(input.operationPlanJson).digest("hex")}`;
  if (canonicalPlanDigest !== input.operationPlanDigest) {
    throw new SessionEmbeddingLifecycleFenceError(
      "session_embedding_lifecycle_identity_mismatch",
      "Session embedding lifecycle operation does not match its frozen plan",
    );
  }

  const generation = readLifecycleGeneration(db);
  const replayReceiptId = input.replayReceiptId ?? generation.last_receipt_id;
  if (replayReceiptId) {
    const receipt = readSessionEmbeddingLifecycleReceiptById(db, replayReceiptId);
    const strandedFence = inspectSessionEmbeddingLifecycleFence(db);
    if (input.replayReceiptId !== undefined && (!receipt || generation.last_receipt_id !== receipt.id)) {
      throw new SessionEmbeddingLifecycleFenceError(
        "session_embedding_lifecycle_identity_mismatch",
        `Session embedding lifecycle predecessor changed before replay ${input.replayReceiptId}`,
      );
    }
    if (
      receipt
      && generation.last_receipt_id === receipt.id
      && !strandedFence
      && (receipt.outcome === "completed" || input.replayReceiptId !== undefined)
      && receipt.operation_kind === input.operationKind
      && receipt.active_contract_id === input.activeContractId
      && receipt.target_contract_id === input.targetContractId
      && receipt.operation_plan_digest === input.operationPlanDigest
      && receipt.operation_plan_json === input.operationPlanJson
    ) {
      return { kind: "replayed", receipt };
    }
    if (
      input.replayReceiptId !== undefined
      && receipt
      && generation.last_receipt_id === receipt.id
      && (strandedFence
      || receipt.operation_kind !== input.operationKind
      || receipt.active_contract_id !== input.activeContractId
      || receipt.target_contract_id !== input.targetContractId
      || receipt.operation_plan_digest !== input.operationPlanDigest
      || receipt.operation_plan_json !== input.operationPlanJson)
    ) {
      throw new SessionEmbeddingLifecycleFenceError(
        "session_embedding_lifecycle_receipt_conflict",
        `terminal receipt conflicts with Session embedding lifecycle replay ${replayReceiptId}`,
      );
    }
  }

  const projectFence = inspectAnyProjectSessionMutationFence(db);
  if (projectFence) {
    return {
      kind: "project_busy",
      code: "session_memory_project_busy",
      owner: safeProjectOwner(projectFence, input.staleBefore),
    };
  }

  const occupied = inspectSessionEmbeddingLifecycleFence(db);
  if (occupied) {
    return {
      kind: "busy",
      code: "session_embedding_lifecycle_busy",
      owner: safeOwner(occupied),
    };
  }

  const nextGeneration = generation.last_generation + 1;
  const operationId = sessionEmbeddingLifecycleOperationId({
    operationKind: input.operationKind,
    operationPlanDigest: input.operationPlanDigest,
    generation: nextGeneration,
  });
  const advanced = db.query(
    `UPDATE session_embedding_lifecycle_generation
     SET last_generation = ?
     WHERE singleton_id = 1 AND last_generation = ? AND last_receipt_id IS ?`,
  ).run(nextGeneration, generation.last_generation, generation.last_receipt_id);
  if (advanced.changes !== 1) {
    throw new Error("Session embedding lifecycle generation allocation lost its transaction authority");
  }

  db.query(
    `INSERT INTO session_embedding_lifecycle_fence
      (singleton_id, operation_id, operation_kind, generation, predecessor_receipt_id,
       phase, owner_epoch, heartbeat_at, acquired_at,
       active_contract_id, target_contract_id, operation_plan_json, operation_plan_digest,
       terminal_receipt_id)
     VALUES (1, ?, ?, ?, ?, 'running', 1, ?, ?, ?, ?, ?, ?, NULL)`,
  ).run(
    operationId,
    input.operationKind,
    nextGeneration,
    generation.last_receipt_id,
    input.now,
    input.now,
    input.activeContractId,
    input.targetContractId,
    input.operationPlanJson,
    input.operationPlanDigest,
  );
  const fence = requireFence(db);
  return { kind: "acquired", authority: issueAuthority(db, fence), fence };
}

export function recoverSessionEmbeddingLifecycleFence(
  db: Database,
  input: {
    operationId: string;
    operationKind: SessionEmbeddingLifecycleOperationKind;
    expectedOwnerEpoch: number;
    expectedGeneration: number;
    expectedPhase: "running" | "needs_followup";
    activeContractId: string | null;
    targetContractId: string | null;
    operationPlanDigest: string;
    now: string;
    staleBefore?: string;
  },
): SessionEmbeddingLifecycleFenceCasResult<SessionEmbeddingLifecycleAuthority> {
  return inImmediateTransaction(db, () => {
    if (readSessionMemoryMutationAuthorityMode(db) !== "smc_v1") {
      return { kind: "rejected", code: "session_memory_authority_not_activated", fence: null };
    }
    const fence = inspectSessionEmbeddingLifecycleFence(db);
    if (!fence) return { kind: "rejected", code: "session_embedding_lifecycle_fence_not_found", fence: null };
    if (fence.operation_id !== input.operationId || fence.operation_kind !== input.operationKind) {
      return { kind: "rejected", code: "session_embedding_lifecycle_wrong_operation", fence };
    }
    if (fence.owner_epoch !== input.expectedOwnerEpoch) {
      return { kind: "rejected", code: "session_embedding_lifecycle_stale_epoch", fence };
    }
    if (fence.generation !== input.expectedGeneration) {
      return { kind: "rejected", code: "session_embedding_lifecycle_identity_mismatch", fence };
    }
    if (fence.phase !== input.expectedPhase) {
      return { kind: "rejected", code: "session_embedding_lifecycle_wrong_phase", fence };
    }
    if (!sameIdentities(fence, input)) {
      return { kind: "rejected", code: "session_embedding_lifecycle_identity_mismatch", fence };
    }
    if (
      input.expectedPhase === "running"
      && (input.staleBefore === undefined || fence.heartbeat_at >= input.staleBefore)
    ) {
      return { kind: "rejected", code: "session_embedding_lifecycle_heartbeat_not_stale", fence };
    }
    if (inspectAnyProjectSessionMutationFence(db)) {
      return { kind: "rejected", code: "session_memory_project_busy", fence };
    }
    const result = db.query(
      `UPDATE session_embedding_lifecycle_fence
       SET phase = 'running', owner_epoch = owner_epoch + 1, heartbeat_at = ?
       WHERE singleton_id = 1 AND operation_id = ? AND generation = ? AND owner_epoch = ? AND phase = ?
         AND active_contract_id IS ? AND target_contract_id IS ?`,
    ).run(
      input.now,
      input.operationId,
      input.expectedGeneration,
      input.expectedOwnerEpoch,
      input.expectedPhase,
      input.activeContractId,
      input.targetContractId,
    );
    if (result.changes !== 1) return diagnoseCasFailure(db, input.operationId, input.expectedOwnerEpoch, input.expectedPhase);
    const recovered = requireFence(db);
    return { kind: "updated", authority: issueAuthority(db, recovered), fence: recovered };
  });
}

export function heartbeatSessionEmbeddingLifecycleFence(
  db: Database,
  input: {
    authority: SessionEmbeddingLifecycleAuthority;
    expectedPhase: "running" | "needs_followup";
    now: string;
  },
): SessionEmbeddingLifecycleFenceCasResult<SessionEmbeddingLifecycleAuthority> {
  return inImmediateTransaction(db, () => {
    if (readSessionMemoryMutationAuthorityMode(db) !== "smc_v1") {
      return { kind: "rejected", code: "session_memory_authority_not_activated", fence: null };
    }
    const identity = authorityIdentityOrThrow(db, input.authority);
    const result = db.query(
      `UPDATE session_embedding_lifecycle_fence
       SET heartbeat_at = ?
       WHERE singleton_id = 1 AND operation_id = ? AND owner_epoch = ? AND phase = ?`,
    ).run(input.now, identity.operationId, identity.ownerEpoch, input.expectedPhase);
    if (result.changes !== 1) {
      return diagnoseCasFailure(db, identity.operationId, identity.ownerEpoch, input.expectedPhase);
    }
    return { kind: "updated", authority: input.authority, fence: requireFence(db) };
  });
}

export function assertSessionEmbeddingLifecycleAuthority(
  db: Database,
  authority: SessionEmbeddingLifecycleAuthority,
  expectedPhase: "running" | "needs_followup" = "running",
): void {
  assertOpenTransaction(db);
  if (readSessionMemoryMutationAuthorityMode(db) !== "smc_v1") {
    throw new SessionEmbeddingLifecycleFenceError(
      "session_memory_authority_not_activated",
      "Session embedding lifecycle authority is dormant",
    );
  }
  const identity = authorityIdentityOrThrow(db, authority);
  const fence = inspectSessionEmbeddingLifecycleFence(db);
  if (!fence) {
    throw new SessionEmbeddingLifecycleFenceError(
      "session_embedding_lifecycle_fence_not_found",
      `no Session embedding lifecycle fence exists for ${identity.operationId}`,
    );
  }
  const failure = validateCurrentFence(fence, identity, expectedPhase);
  if (failure) {
    throw new SessionEmbeddingLifecycleFenceError(
      failure.code,
      `Session embedding lifecycle authority was rejected for ${identity.operationId}`,
    );
  }
}

export function resolveSessionEmbeddingLifecycleWriteAdmissionIdentity(
  db: Database,
  authority: SessionEmbeddingLifecycleAuthority,
): SessionEmbeddingLifecycleWriteAdmissionIdentity {
  assertSessionEmbeddingLifecycleAuthority(db, authority, "running");
  const identity = authorityIdentityOrThrow(db, authority);
  const fence = requireFence(db);
  return {
    operationId: identity.operationId,
    ownerEpoch: identity.ownerEpoch,
    phase: fence.phase,
  };
}

export function pauseSessionEmbeddingLifecycleFence(
  db: Database,
  input: { authority: SessionEmbeddingLifecycleAuthority; now: string },
): SessionEmbeddingLifecycleFenceCasResult<SessionEmbeddingLifecycleAuthority> {
  return inImmediateTransaction(db, () => {
    if (readSessionMemoryMutationAuthorityMode(db) !== "smc_v1") {
      return { kind: "rejected", code: "session_memory_authority_not_activated", fence: null };
    }
    const identity = authorityIdentityOrThrow(db, input.authority);
    const result = db.query(
      `UPDATE session_embedding_lifecycle_fence
       SET phase = 'needs_followup', owner_epoch = owner_epoch + 1, heartbeat_at = ?
       WHERE singleton_id = 1 AND operation_id = ? AND owner_epoch = ? AND phase = 'running'`,
    ).run(input.now, identity.operationId, identity.ownerEpoch);
    if (result.changes !== 1) {
      return diagnoseCasFailure(db, identity.operationId, identity.ownerEpoch, "running");
    }
    const fence = requireFence(db);
    return { kind: "updated", authority: issueAuthority(db, fence), fence };
  });
}

export function completeSessionEmbeddingLifecycleFence(
  db: Database,
  input: {
    authority: SessionEmbeddingLifecycleAuthority;
    resultDigest: string;
    now: string;
  },
): SessionEmbeddingLifecycleTerminalResult {
  return finishSessionEmbeddingLifecycleFence(db, { ...input, outcome: "completed" });
}

export function abandonSessionEmbeddingLifecycleFence(
  db: Database,
  input: {
    authority: SessionEmbeddingLifecycleAuthority;
    resultDigest: string;
    now: string;
  },
): SessionEmbeddingLifecycleTerminalResult {
  return finishSessionEmbeddingLifecycleFence(db, { ...input, outcome: "abandoned" });
}

export function inspectSessionEmbeddingLifecycleFence(db: Database): SessionEmbeddingLifecycleFenceRow | null {
  return (db.query("SELECT * FROM session_embedding_lifecycle_fence WHERE singleton_id = 1").get() as
    SessionEmbeddingLifecycleFenceRow | null) ?? null;
}

export function readSessionEmbeddingLifecycleReceipt(
  db: Database,
  operationId: string,
): SessionEmbeddingLifecycleReceipt | null {
  return (db.query("SELECT * FROM session_embedding_lifecycle_receipts WHERE operation_id = ?").get(operationId) as
    SessionEmbeddingLifecycleReceipt | null) ?? null;
}

export function readSessionEmbeddingLifecycleReceiptById(
  db: Database,
  receiptId: string,
): SessionEmbeddingLifecycleReceipt | null {
  return (db.query("SELECT * FROM session_embedding_lifecycle_receipts WHERE id = ?").get(receiptId) as
    SessionEmbeddingLifecycleReceipt | null) ?? null;
}

export function readLatestSessionEmbeddingLifecycleReceipt(
  db: Database,
  operationKind?: SessionEmbeddingLifecycleOperationKind,
): SessionEmbeddingLifecycleReceipt | null {
  const row = operationKind
    ? db.query(
      `SELECT * FROM session_embedding_lifecycle_receipts
       WHERE operation_kind = ?
       ORDER BY generation DESC
       LIMIT 1`,
    ).get(operationKind)
    : db.query(
      `SELECT * FROM session_embedding_lifecycle_receipts ORDER BY generation DESC LIMIT 1`,
    ).get();
  return (row as SessionEmbeddingLifecycleReceipt | null) ?? null;
}

function finishSessionEmbeddingLifecycleFence(
  db: Database,
  input: {
    authority: SessionEmbeddingLifecycleAuthority;
    outcome: SessionEmbeddingLifecycleReceiptOutcome;
    resultDigest: string;
    now: string;
  },
): SessionEmbeddingLifecycleTerminalResult {
  return inImmediateTransaction(db, () => {
    if (readSessionMemoryMutationAuthorityMode(db) !== "smc_v1") {
      return { kind: "rejected", code: "session_memory_authority_not_activated", fence: null };
    }
    const identity = authorityIdentityOrThrow(db, input.authority);
    const existingReceipt = readSessionEmbeddingLifecycleReceipt(db, identity.operationId);
    if (existingReceipt) {
      const strandedFence = inspectSessionEmbeddingLifecycleFence(db);
      if (
        !strandedFence
        && existingReceipt.outcome === input.outcome
        && existingReceipt.result_digest === input.resultDigest
        && existingReceipt.operation_plan_digest === identity.operationPlanDigest
      ) {
        return { kind: input.outcome, receipt: existingReceipt };
      }
      return {
        kind: "rejected",
        code: "session_embedding_lifecycle_receipt_conflict",
        fence: inspectSessionEmbeddingLifecycleFence(db),
      };
    }

    const fence = inspectSessionEmbeddingLifecycleFence(db);
    if (!fence) return { kind: "rejected", code: "session_embedding_lifecycle_fence_not_found", fence: null };
    const expectedPhase: SessionEmbeddingLifecycleFencePhase = input.outcome === "completed"
      ? "running"
      : fence.phase;
    const failure = validateCurrentFence(fence, identity, expectedPhase);
    if (failure) return failure;
    if (input.outcome === "abandoned" && fence.phase !== "running" && fence.phase !== "needs_followup") {
      return { kind: "rejected", code: "session_embedding_lifecycle_not_terminal", fence };
    }

    const receiptId = sessionEmbeddingLifecycleReceiptId({
      operationId: identity.operationId,
      outcome: input.outcome,
      resultDigest: input.resultDigest,
    });
    db.query(
      `INSERT INTO session_embedding_lifecycle_receipts
        (id, operation_id, operation_kind, generation, predecessor_receipt_id,
         outcome, owner_epoch, active_contract_id,
         target_contract_id, operation_plan_json, operation_plan_digest, result_digest, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      receiptId,
      fence.operation_id,
      fence.operation_kind,
      fence.generation,
      fence.predecessor_receipt_id,
      input.outcome,
      fence.owner_epoch,
      fence.active_contract_id,
      fence.target_contract_id,
      fence.operation_plan_json,
      fence.operation_plan_digest,
      input.resultDigest,
      input.now,
    );
    const generation = readLifecycleGeneration(db);
    const advanced = db.query(
      `UPDATE session_embedding_lifecycle_generation
       SET last_receipt_id = ?
       WHERE singleton_id = 1 AND last_generation = ? AND last_receipt_id IS ?`,
    ).run(receiptId, fence.generation, fence.predecessor_receipt_id);
    if (advanced.changes !== 1 || generation.last_generation !== fence.generation) {
      throw new Error(`Session embedding lifecycle receipt ordering drifted for ${fence.operation_id}`);
    }
    db.query(
      `UPDATE session_embedding_lifecycle_fence
       SET phase = ?, terminal_receipt_id = ?, heartbeat_at = ?
       WHERE singleton_id = 1 AND operation_id = ? AND owner_epoch = ?`,
    ).run(input.outcome, receiptId, input.now, fence.operation_id, fence.owner_epoch);
    const released = db.query(
      `DELETE FROM session_embedding_lifecycle_fence
       WHERE singleton_id = 1 AND operation_id = ? AND owner_epoch = ? AND terminal_receipt_id = ?`,
    ).run(fence.operation_id, fence.owner_epoch, receiptId);
    if (released.changes !== 1) {
      throw new Error(`Session embedding lifecycle fence release failed for ${fence.operation_id}`);
    }
    const receipt = readSessionEmbeddingLifecycleReceipt(db, identity.operationId);
    if (!receipt) throw new Error(`Session embedding lifecycle receipt disappeared for ${identity.operationId}`);
    return { kind: input.outcome, receipt };
  });
}

function inspectAnyProjectSessionMutationFence(db: Database): ProjectSessionMutationFenceRow | null {
  return (db.query(
    "SELECT * FROM project_session_mutation_fences ORDER BY acquired_at, project_key LIMIT 1",
  ).get() as ProjectSessionMutationFenceRow | null) ?? null;
}

function validateCurrentFence(
  fence: SessionEmbeddingLifecycleFenceRow,
  identity: AuthorityIdentity,
  expectedPhase: SessionEmbeddingLifecycleFencePhase,
): SessionEmbeddingLifecycleFenceCasFailure | null {
  if (fence.operation_id !== identity.operationId) {
    return { kind: "rejected", code: "session_embedding_lifecycle_wrong_operation", fence };
  }
  if (fence.owner_epoch !== identity.ownerEpoch) {
    return { kind: "rejected", code: "session_embedding_lifecycle_stale_epoch", fence };
  }
  if (fence.generation !== identity.generation) {
    return { kind: "rejected", code: "session_embedding_lifecycle_identity_mismatch", fence };
  }
  if (fence.phase !== expectedPhase) {
    return { kind: "rejected", code: "session_embedding_lifecycle_wrong_phase", fence };
  }
  if (!sameIdentities(fence, identity)) {
    return { kind: "rejected", code: "session_embedding_lifecycle_identity_mismatch", fence };
  }
  return null;
}

function diagnoseCasFailure(
  db: Database,
  operationId: string,
  ownerEpoch: number,
  expectedPhase: SessionEmbeddingLifecycleFencePhase,
): SessionEmbeddingLifecycleFenceCasFailure {
  if (readSessionMemoryMutationAuthorityMode(db) !== "smc_v1") {
    return { kind: "rejected", code: "session_memory_authority_not_activated", fence: null };
  }
  const fence = inspectSessionEmbeddingLifecycleFence(db);
  if (!fence) return { kind: "rejected", code: "session_embedding_lifecycle_fence_not_found", fence: null };
  if (fence.operation_id !== operationId) {
    return { kind: "rejected", code: "session_embedding_lifecycle_wrong_operation", fence };
  }
  if (fence.owner_epoch !== ownerEpoch) {
    return { kind: "rejected", code: "session_embedding_lifecycle_stale_epoch", fence };
  }
  if (fence.phase !== expectedPhase) {
    return { kind: "rejected", code: "session_embedding_lifecycle_wrong_phase", fence };
  }
  return { kind: "rejected", code: "session_embedding_lifecycle_wrong_phase", fence };
}

function issueAuthority(db: Database, fence: SessionEmbeddingLifecycleFenceRow): SessionEmbeddingLifecycleAuthority {
  const authority = Object.freeze(Object.create(null)) as SessionEmbeddingLifecycleAuthority;
  authorityIdentities.set(authority, {
    db,
    operationId: fence.operation_id,
    generation: fence.generation,
    ownerEpoch: fence.owner_epoch,
    activeContractId: fence.active_contract_id,
    targetContractId: fence.target_contract_id,
    operationPlanDigest: fence.operation_plan_digest,
  });
  return authority;
}

function authorityIdentityOrThrow(
  db: Database,
  authority: SessionEmbeddingLifecycleAuthority,
): AuthorityIdentity {
  if ((typeof authority !== "object" && typeof authority !== "function") || authority === null) {
    throwInvalidAuthority();
  }
  const identity = authorityIdentities.get(authority as object);
  if (!identity) throwInvalidAuthority();
  if (identity.db !== db) {
    throw new SessionEmbeddingLifecycleFenceError(
      "session_embedding_lifecycle_authority_database_mismatch",
      "Session embedding lifecycle authority belongs to another Database connection",
    );
  }
  return identity;
}

function throwInvalidAuthority(): never {
  throw new SessionEmbeddingLifecycleFenceError(
    "session_embedding_lifecycle_authority_invalid",
    "Session embedding lifecycle mutation requires an issued authority capability",
  );
}

function requireFence(db: Database): SessionEmbeddingLifecycleFenceRow {
  const fence = inspectSessionEmbeddingLifecycleFence(db);
  if (!fence) throw new Error("Session embedding lifecycle fence disappeared");
  return fence;
}

function safeOwner(fence: SessionEmbeddingLifecycleFenceRow): SessionEmbeddingLifecycleFenceSafeOwner {
  return {
    operation_id: fence.operation_id,
    operation_kind: fence.operation_kind,
    generation: fence.generation,
    predecessor_receipt_id: fence.predecessor_receipt_id,
    phase: fence.phase,
    owner_epoch: fence.owner_epoch,
    heartbeat_at: fence.heartbeat_at,
    acquired_at: fence.acquired_at,
    active_contract_id: fence.active_contract_id,
    target_contract_id: fence.target_contract_id,
    operation_plan_digest: fence.operation_plan_digest,
  };
}

function safeProjectOwner(
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

function sameIdentities(
  fence: Pick<SessionEmbeddingLifecycleFenceRow, "active_contract_id" | "target_contract_id" | "operation_plan_digest">,
  input: { activeContractId: string | null; targetContractId: string | null; operationPlanDigest: string },
): boolean {
  return fence.active_contract_id === input.activeContractId
    && fence.target_contract_id === input.targetContractId
    && fence.operation_plan_digest === input.operationPlanDigest;
}

function readLifecycleGeneration(db: Database): { last_generation: number; last_receipt_id: string | null } {
  const row = db.query(
    `SELECT last_generation, last_receipt_id
     FROM session_embedding_lifecycle_generation
     WHERE singleton_id = 1`,
  ).get() as { last_generation: number; last_receipt_id: string | null } | null;
  if (!row) throw new Error("Session embedding lifecycle generation state is missing");
  return row;
}

function assertOpenTransaction(db: Database): void {
  if (!db.inTransaction) {
    throw new SessionEmbeddingLifecycleFenceError(
      "session_embedding_lifecycle_transaction_required",
      "Session embedding lifecycle fence operation requires an open transaction",
    );
  }
}

function inImmediateTransaction<T>(db: Database, callback: () => T): T {
  return db.inTransaction ? callback() : db.transaction(callback).immediate();
}
