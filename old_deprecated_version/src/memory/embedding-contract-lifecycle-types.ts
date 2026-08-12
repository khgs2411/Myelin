import type { EmbeddingContractStatus } from "../status/contracts.ts";
import type { EmbeddingScope } from "./embedding-contract-types.ts";
import type { EmbeddingProviderFailureCode } from "./embedding-provider-errors.ts";
import type { ProjectSessionMutationFenceSafeOwner } from "./project-session-mutation-fence.ts";

export const SESSION_EMBEDDING_LIFECYCLE_OPERATION_KINDS = ["migrate", "rollback", "prune"] as const;
export type SessionEmbeddingLifecycleOperationKind =
  (typeof SESSION_EMBEDDING_LIFECYCLE_OPERATION_KINDS)[number];

export const SESSION_EMBEDDING_LIFECYCLE_FENCE_PHASES = [
  "running",
  "needs_followup",
  "completed",
  "abandoned",
] as const;
export type SessionEmbeddingLifecycleFencePhase =
  (typeof SESSION_EMBEDDING_LIFECYCLE_FENCE_PHASES)[number];

export type SessionEmbeddingLifecycleFenceRow = {
  singleton_id: 1;
  operation_id: string;
  operation_kind: SessionEmbeddingLifecycleOperationKind;
  generation: number;
  predecessor_receipt_id: string | null;
  phase: SessionEmbeddingLifecycleFencePhase;
  owner_epoch: number;
  heartbeat_at: string;
  acquired_at: string;
  active_contract_id: string | null;
  target_contract_id: string | null;
  operation_plan_json: string;
  operation_plan_digest: string;
  terminal_receipt_id: string | null;
};

export type SessionEmbeddingLifecycleFenceSafeOwner = Pick<
  SessionEmbeddingLifecycleFenceRow,
  | "operation_id"
  | "operation_kind"
  | "generation"
  | "predecessor_receipt_id"
  | "phase"
  | "owner_epoch"
  | "heartbeat_at"
  | "acquired_at"
  | "active_contract_id"
  | "target_contract_id"
  | "operation_plan_digest"
>;

export type SessionEmbeddingLifecycleReceiptOutcome = "completed" | "abandoned";

export type SessionEmbeddingLifecycleReceipt = {
  id: string;
  operation_id: string;
  operation_kind: SessionEmbeddingLifecycleOperationKind;
  generation: number;
  predecessor_receipt_id: string | null;
  outcome: SessionEmbeddingLifecycleReceiptOutcome;
  owner_epoch: number;
  active_contract_id: string | null;
  target_contract_id: string | null;
  operation_plan_json: string;
  operation_plan_digest: string;
  result_digest: string;
  created_at: string;
};

export type SessionEmbeddingLifecycleFenceFailureCode =
  | "session_memory_authority_not_activated"
  | "session_embedding_lifecycle_busy"
  | "session_memory_project_busy"
  | "session_embedding_lifecycle_fence_not_found"
  | "session_embedding_lifecycle_wrong_operation"
  | "session_embedding_lifecycle_stale_epoch"
  | "session_embedding_lifecycle_wrong_phase"
  | "session_embedding_lifecycle_identity_mismatch"
  | "session_embedding_lifecycle_heartbeat_not_stale"
  | "session_embedding_lifecycle_not_terminal"
  | "session_embedding_lifecycle_receipt_conflict"
  | "session_embedding_lifecycle_authority_invalid"
  | "session_embedding_lifecycle_authority_database_mismatch"
  | "session_embedding_lifecycle_transaction_required";

export type SessionEmbeddingLifecycleFenceAcquireResult<Authority> =
  | {
    kind: "acquired";
    authority: Authority;
    fence: SessionEmbeddingLifecycleFenceRow;
  }
  | {
    kind: "replayed";
    receipt: SessionEmbeddingLifecycleReceipt;
  }
  | {
    kind: "not_activated";
    code: "session_memory_authority_not_activated";
    authority_mode: "legacy_compatibility";
  }
  | {
    kind: "busy";
    code: "session_embedding_lifecycle_busy";
    owner: SessionEmbeddingLifecycleFenceSafeOwner;
  }
  | {
    kind: "project_busy";
    code: "session_memory_project_busy";
    owner: ProjectSessionMutationFenceSafeOwner;
  };

export type SessionEmbeddingLifecycleFenceCasFailure = {
  kind: "rejected";
  code: Exclude<
    SessionEmbeddingLifecycleFenceFailureCode,
    | "session_embedding_lifecycle_busy"
    | "session_embedding_lifecycle_authority_invalid"
    | "session_embedding_lifecycle_authority_database_mismatch"
    | "session_embedding_lifecycle_transaction_required"
  >;
  fence: SessionEmbeddingLifecycleFenceRow | null;
};

export type SessionEmbeddingLifecycleFenceCasResult<Authority> =
  | {
    kind: "updated";
    authority: Authority;
    fence: SessionEmbeddingLifecycleFenceRow;
  }
  | SessionEmbeddingLifecycleFenceCasFailure;

export type SessionEmbeddingLifecycleTerminalResult =
  | { kind: "completed"; receipt: SessionEmbeddingLifecycleReceipt }
  | { kind: "abandoned"; receipt: SessionEmbeddingLifecycleReceipt }
  | SessionEmbeddingLifecycleFenceCasFailure;

export type SessionEmbeddingLifecycleOperationStatus = {
  operation_id: string;
  generation: number;
  owner_epoch: number;
  phase: SessionEmbeddingLifecycleFencePhase;
  receipt: SessionEmbeddingLifecycleReceipt | null;
};

export type EmbeddingMigrationScopePlan = {
  scope: EmbeddingScope;
  active_contract: EmbeddingContractStatus | null;
  desired_contract: EmbeddingContractStatus | null;
  action: "initialize" | "migrate" | "none";
  indexed: number;
  failed: number;
  pending_remaining: number;
  activated: boolean;
  error?: string;
  failure_code?: EmbeddingProviderFailureCode | "embedding_migration_failed";
};

export type EmbeddingMigrationResult = {
  mode: "preview" | "apply";
  scopes: EmbeddingMigrationScopePlan[];
  session_lifecycle?: SessionEmbeddingLifecycleOperationStatus;
};

export type EmbeddingRollbackScopePlan = {
  scope: EmbeddingScope;
  active_contract: EmbeddingContractStatus | null;
  previous_contract: EmbeddingContractStatus | null;
  action: "rollback" | "none";
  rolled_back: boolean;
};

export type EmbeddingRollbackResult = {
  mode: "preview" | "apply";
  scopes: EmbeddingRollbackScopePlan[];
  session_lifecycle?: SessionEmbeddingLifecycleOperationStatus;
};

export type EmbeddingPruneCandidate = {
  scope: EmbeddingScope;
  contract: EmbeddingContractStatus & { provider: string };
  metadata_rows: number;
  query_cache_rows: number;
  lifecycle: string;
  vector_table: string | null;
};

export type EmbeddingPruneResult = {
  mode: "preview" | "apply";
  candidates: EmbeddingPruneCandidate[];
  removed_metadata_rows: number;
  removed_query_cache_rows: number;
  removed_vector_rows: number;
  removed_vector_tables: string[];
  session_lifecycle?: SessionEmbeddingLifecycleOperationStatus;
};

export type SessionEmbeddingLifecycleFrozenPlan = {
  version: 1;
  operation_kind: SessionEmbeddingLifecycleOperationKind;
  ordered_scope_plans: Array<EmbeddingMigrationScopePlan | EmbeddingRollbackScopePlan | EmbeddingPruneCandidate>;
};
