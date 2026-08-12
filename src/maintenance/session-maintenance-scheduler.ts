import { openMemoryDb } from "../memory/db.ts";
import { discoverIndexedEmbeddingContract, readActiveEmbeddingContract } from "../memory/embedding-contract-store.ts";
import { resolveEmbeddingRuntime } from "../memory/embedding-contract-resolver.ts";
import { countExperienceContentEvents, oldestExperienceContentInsertedAt } from "../memory/experience.ts";
import { SessionMemoryIndexService } from "../memory/session-memory-index-service.ts";
import type { StartIngestResult } from "../ingest/ingest-service-contracts.ts";
import { loadConfig, selectModelProfile, type SMCPlanConfig } from "../runtime/config.ts";
import { defaultSMCGoverningIdentities } from "../session-maintenance/evidence-selection.ts";
import { selectDueSessionMemoryAuditPartition } from "../session-maintenance/audit-selection.ts";
import type {
  AutoMemoryMaintenanceIndexResult,
  SessionMaintenanceSchedulerResult,
} from "./maintenance-contracts.ts";
import {
  evaluateSessionMaintenanceEligibility,
  type SessionMaintenanceEligibility,
  type SessionMaintenanceWakeKind,
} from "./session-maintenance-eligibility.ts";

export type StartEligibleSessionAnchor = (input: {
  projectKey: string;
  triggerReason: NonNullable<SessionMaintenanceEligibility["trigger_reason"]>;
  includeAudit: boolean;
  auditPartitionLimit: number;
  auditDueCount: number;
}) => Promise<StartIngestResult>;

export class DefaultSessionMaintenanceScheduler {
  constructor(
    private readonly root: string,
    private readonly deps: {
      now?: () => Date;
      startAnchor: StartEligibleSessionAnchor;
      planConfig?: SMCPlanConfig;
      indexPending?: (input: {
        projectKey: string; limit: number; batchSize: number; retryFailed: boolean;
      }) => Promise<AutoMemoryMaintenanceIndexResult>;
    },
  ) {}

  async evaluate(projectKey: string, wakeKind: SessionMaintenanceWakeKind): Promise<SessionMaintenanceEligibility> {
    const config = await loadConfig(this.root);
    const db = openMemoryDb(this.root);
    try {
      const profile = selectModelProfile(config, "ingest");
      const identities = defaultSMCGoverningIdentities({
        provider: profile.provider,
        model: profile.model ?? null,
        reasoning_effort: profile.reasoningEffort ?? null,
      });
      const planConfig = this.deps.planConfig ?? config.sessionMaintenance.planConfig;
      const dueAuditCount = planConfig
        ? selectDueSessionMemoryAuditPartition(db, {
          project_key: projectKey,
          governing_identities: identities,
          limit: planConfig.auditPartitionLimit,
        }).due_count
        : 0;
      return evaluateSessionMaintenanceEligibility({
        wake_kind: wakeKind,
        queued_content_count: countExperienceContentEvents(db, projectKey),
        oldest_content_inserted_at: oldestExperienceContentInsertedAt(db, projectKey),
        pending_index_count: countActivePendingSessionEmbeddings(db, projectKey),
        due_audit_count: dueAuditCount,
        min_content_count: config.autoMemoryMaintenance.minCapturedEvents,
        max_pending_age_ms: config.autoMemoryMaintenance.maxPendingAgeMs,
        now: (this.deps.now ?? (() => new Date()))(),
      });
    } finally {
      db.close();
    }
  }

  async run(projectKey: string, wakeKind: SessionMaintenanceWakeKind): Promise<SessionMaintenanceSchedulerResult> {
    const config = await loadConfig(this.root);
    const planConfig = this.deps.planConfig ?? config.sessionMaintenance.planConfig;
    let eligibility = await this.evaluate(projectKey, wakeKind);
    let indexing: AutoMemoryMaintenanceIndexResult = { indexed: 0, failed: 0, pending_remaining: 0 };
    if (eligibility.index.due) {
      try {
        indexing = await this.indexPending(projectKey, config);
      } catch (error) {
        return {
          kind: "blocked",
          code: "session_memory_indexing_incomplete",
          project_key: projectKey,
          eligibility,
          indexing,
          reason: `Session Memory indexing failed before anchor creation: ${message(error)}`,
        };
      }
      eligibility = await this.evaluate(projectKey, wakeKind);
      if (indexing.failed > 0 || indexing.pending_remaining > 0 || eligibility.index.due) {
        return {
          kind: "blocked",
          code: "session_memory_indexing_incomplete",
          project_key: projectKey,
          eligibility,
          indexing,
          reason: `Session Memory indexing incomplete: ${indexing.failed} failed, ${Math.max(indexing.pending_remaining, eligibility.index.pending_count)} pending`,
        };
      }
    }
    if (!eligibility.curation_due) {
      return indexing.indexed > 0
        ? { kind: "index_only", project_key: projectKey, eligibility, indexing }
        : { kind: "no_work", project_key: projectKey, eligibility };
    }
    if (!planConfig) {
      return {
        kind: "blocked",
        code: "session_memory_plan_config_unavailable",
        project_key: projectKey,
        eligibility,
        indexing,
        reason: "Session Memory plan config is unavailable",
      };
    }
    const result = await this.deps.startAnchor({
      projectKey,
      triggerReason: eligibility.trigger_reason!,
      includeAudit: eligibility.audit.due,
      auditPartitionLimit: planConfig.auditPartitionLimit,
      auditDueCount: eligibility.audit.due_count,
    });
    return { kind: "anchor", project_key: projectKey, eligibility, indexing, result };
  }

  private async indexPending(
    projectKey: string,
    config: Awaited<ReturnType<typeof loadConfig>>,
  ): Promise<AutoMemoryMaintenanceIndexResult> {
    if (this.deps.indexPending) {
      return this.deps.indexPending({
        projectKey,
        limit: config.autoMemoryMaintenance.indexLimit,
        batchSize: config.embedding.batchSize,
        retryFailed: false,
      });
    }
    const db = openMemoryDb(this.root);
    try {
      const selection = await resolveEmbeddingRuntime({ db, config, scope: "session_memory" });
      return await new SessionMemoryIndexService({
        db,
        contract: selection.runtime.contract,
        provider: selection.runtime.client,
        vectorTable: selection.active.vectorTable,
      }).indexPending({
        projectKey,
        limit: config.autoMemoryMaintenance.indexLimit,
        batchSize: config.embedding.batchSize,
        retryFailed: false,
      });
    } finally {
      db.close();
    }
  }
}

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function countActivePendingSessionEmbeddings(db: ReturnType<typeof openMemoryDb>, projectKey: string): number {
  const persisted = readActiveEmbeddingContract(db, "session_memory");
  const discovered = persisted ? null : discoverIndexedEmbeddingContract(db, "session_memory");
  const active = persisted ?? discovered?.contract;
  if (!active) return 0;
  const pending = (db.query(
    `SELECT count(*) AS count FROM session_memories sm
     WHERE sm.project_key = ? AND sm.status = 'active'
       AND NOT EXISTS (
         SELECT 1 FROM session_memory_embeddings e
         WHERE e.session_memory_id = sm.id
           AND e.embedding_provider = ? AND e.embedding_model = ? AND e.embedding_dimensions = ?
           AND e.embedding_purpose = 'retrieval_document' AND e.format_version = ?
           AND e.status = 'indexed'
       )`,
  ).get(projectKey, active.provider, active.model, active.dimensions, active.formatVersion) as { count: number }).count;
  const vectorTableExists = Boolean(db.query(
    "SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?",
  ).get(persisted?.vectorTable ?? discovered!.vectorTable));
  return pending + (vectorTableExists ? 0 : 1);
}
