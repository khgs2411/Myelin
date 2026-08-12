import type { Database } from "bun:sqlite";
import {
  activateEmbeddingContract,
  readActiveEmbeddingContract,
  upsertStagingEmbeddingContract,
} from "../../src/memory/embedding-contract-store.ts";
import { documentContract, type EmbeddingContractIdentity } from "../../src/memory/embedding-contract-types.ts";
import { recordExperienceEvent } from "../../src/memory/experience.ts";
import {
  ensurePendingSessionMemoryEmbedding,
  markSessionMemoryEmbeddingIndexed,
} from "../../src/memory/session-memory-embeddings.ts";
import {
  normalizeSessionMemoryForEmbedding,
  sessionMemoryNormalizedTextHash,
} from "../../src/memory/session-memory-text.ts";
import { createSqliteVecAdapter, ensureSessionMemoryVectorTable, upsertSessionMemoryVector } from "../../src/memory/sqlite-vec.ts";
import { AuthorityActivationService } from "../../src/session-maintenance/authority-activation-service.ts";
import {
  defaultSMCGoverningIdentities,
  planSessionMaintenanceEvidence,
  type SMCEvidencePreparationPlan,
} from "../../src/session-maintenance/evidence-selection.ts";
import { prepareSessionMaintenanceAnchor } from "../../src/session-maintenance/preparation-service.ts";
import type { SMCWorkflowBudgets } from "../../src/session-maintenance/manifest.ts";
import { createSessionMemory } from "./session-mutation-authority.ts";

export const SMC_TEST_NOW = "2026-08-11T12:00:00.000Z";
export const SMC_TEST_CONTRACT: EmbeddingContractIdentity = {
  provider: "ollama_nomic",
  model: "smc-test-embedding",
  dimensions: 3,
  formatVersion: 1,
};

export const SMC_TEST_WORKFLOW_BUDGETS: SMCWorkflowBudgets = {
  max_affected_work_set_size: 1_000,
  max_cumulative_returned_result_bytes: 100_000,
  max_provider_envelope_bytes: 180_000,
  max_queries: 20,
  max_turns: 10,
  retrieval_page_item_limit: 100,
  semantic_distance_threshold_micros: 800_000,
  semantic_qualifying_result_ceiling: 1_000,
};

export function configureSMCTestContract(db: Database) {
  const staging = upsertStagingEmbeddingContract(db, {
    scope: "session_memory",
    contract: SMC_TEST_CONTRACT,
    now: SMC_TEST_NOW,
  });
  activateEmbeddingContract(db, {
    scope: "session_memory",
    contractId: staging.id,
    now: SMC_TEST_NOW,
  });
  const contract = readActiveEmbeddingContract(db, "session_memory")!;
  const vector = ensureSessionMemoryVectorTable(db, {
    dimensions: contract.dimensions,
    table: contract.vectorTable,
    adapter: createSqliteVecAdapter(),
  });
  if (!vector.available) throw new Error(vector.reason);
  return contract;
}

export function seedIndexedMemory(
  db: Database,
  input: {
    id: string;
    project_key?: string;
    summary?: string;
    created_at?: string;
    source_event_refs?: string[];
  },
): void {
  const projectKey = input.project_key ?? "demo";
  const contract = readActiveEmbeddingContract(db, "session_memory")!;
  const document = documentContract(contract);
  const row = createSessionMemory(db, {
    id: input.id,
    project_key: projectKey,
    source_event_refs: input.source_event_refs ?? [],
    memory_kind: "continuity",
    title: `Memory ${input.id}`,
    summary: input.summary ?? `Summary ${input.id}`,
    payload: { status: "active" },
    confidence: "high",
    risk: "low",
    now: input.created_at ?? SMC_TEST_NOW,
    embedding_contract: document,
  });
  const normalized = normalizeSessionMemoryForEmbedding(row);
  const embedding = ensurePendingSessionMemoryEmbedding(db, {
    session_memory_id: row.id,
    project_key: projectKey,
    contract: document,
    now: SMC_TEST_NOW,
  });
  upsertSessionMemoryVector(db, {
    memory_id: row.id,
    project_key: projectKey,
    embedding_model: contract.model,
    embedding_dimensions: contract.dimensions,
    embedding_purpose: "retrieval_document",
    format_version: contract.formatVersion,
    embedding: [0.1, 0.2, 0.3],
  }, contract.vectorTable);
  markSessionMemoryEmbeddingIndexed(db, {
    id: embedding.id,
    normalized_text_hash: sessionMemoryNormalizedTextHash(normalized),
    now: SMC_TEST_NOW,
  });
}

export function seedEvidence(db: Database, id: string, rawText = `Evidence ${id}`, projectKey = "demo"): void {
  recordExperienceEvent(db, {
    id,
    project_key: projectKey,
    occurred_at: SMC_TEST_NOW,
    hook_event_name: "UserPromptSubmit",
    event_kind: "user.prompt",
    provider: "codex",
    provider_session_id: "session-test",
    turn_id: id,
    raw_text: rawText,
    raw_payload_json: JSON.stringify({ id }),
    source: "test",
    status: "valid",
    repo_path: "/repo",
    git_branch: "feature/smc",
    git_commit: "abc123",
    git_worktree_id: "wt-1",
  }, new Date(SMC_TEST_NOW));
}

export function activateSMCAuthority(db: Database): void {
  const result = new AuthorityActivationService({ now: () => new Date(SMC_TEST_NOW) }).activate(db);
  if (result.kind !== "activated" && result.kind !== "already_active") {
    throw new Error(`SMC authority activation failed: ${JSON.stringify(result)}`);
  }
}

export function planEvidence(
  db: Database,
  jobId = "job-prepared",
  options: { includeAudit?: boolean; auditPartitionLimit?: number } = {},
): SMCEvidencePreparationPlan {
  const result = planSessionMaintenanceEvidence(db, {
    anchor_job_id: jobId,
    project_key: "demo",
    trigger_reason: "manual",
    governing_identities: defaultSMCGoverningIdentities({
      provider: "codex",
      model: "gpt-test",
      reasoning_effort: "medium",
    }),
    budgets: {
      max_items_per_batch: 10,
      max_encoded_bytes_per_batch: 100_000,
      max_encoded_bytes_per_item: 100_000,
    },
    include_audit: options.includeAudit,
    audit_partition_limit: options.includeAudit ? options.auditPartitionLimit ?? 10 : undefined,
  });
  if (result.kind !== "planned") throw new Error(`Expected planned evidence: ${JSON.stringify(result)}`);
  return result.plan;
}

export function prepare(db: Database, plan: SMCEvidencePreparationPlan, failure_injection?: Parameters<typeof prepareSessionMaintenanceAnchor>[1]["failure_injection"]) {
  return prepareWithWorkflowBudgets(db, plan, SMC_TEST_WORKFLOW_BUDGETS, failure_injection);
}

export function prepareWithWorkflowBudgets(
  db: Database,
  plan: SMCEvidencePreparationPlan,
  workflowBudgets: unknown,
  failure_injection?: Parameters<typeof prepareSessionMaintenanceAnchor>[1]["failure_injection"],
) {
  return prepareSessionMaintenanceAnchor(db, {
    plan,
    requested_by: "test",
    target_context: {
      repo_path: "/repo",
      git_branch: "feature/smc",
      git_commit: "abc123",
      git_worktree_id: "wt-1",
    },
    workflow_budgets: workflowBudgets as SMCWorkflowBudgets,
    now: SMC_TEST_NOW,
    failure_injection,
  });
}
