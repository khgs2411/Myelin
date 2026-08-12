import type { Database } from "bun:sqlite";
import { createHash } from "node:crypto";
import { readdir } from "node:fs/promises";
import { join } from "node:path";
import { discoverProjects } from "../runtime/projects.ts";
import {
  EMBEDDING_FORMAT_VERSION,
  loadConfig,
  type MyelinConfig,
} from "../runtime/config.ts";
import type { EmbeddingContractStatus } from "../status/contracts.ts";
import { openMemoryDb } from "./db.ts";
import { planEmbeddingContract, resolveEmbeddingContract } from "./embedding-contract-resolver.ts";
import {
  activateEmbeddingContract,
  embeddingContractId,
  listEmbeddingContracts,
  markEmbeddingContractFailed,
  readActiveEmbeddingContract,
  readPreviousEmbeddingContract,
  removeEmbeddingContract,
  rollbackEmbeddingContract,
  upsertStagingEmbeddingContract,
} from "./embedding-contract-store.ts";
import {
  sameEmbeddingContract,
  type EmbeddingContractIdentity,
  type EmbeddingScope,
} from "./embedding-contract-types.ts";
import { EmbeddingProviderFactory } from "./embedding-provider-factory.ts";
import {
  embeddingProviderFailureCode,
  embeddingProviderFailureKind,
} from "./embedding-provider-errors.ts";
import type {
  EmbeddingMigrationResult,
  EmbeddingMigrationScopePlan,
  EmbeddingPruneCandidate,
  EmbeddingPruneResult,
  EmbeddingRollbackResult,
  EmbeddingRollbackScopePlan,
  SessionEmbeddingLifecycleFrozenPlan,
  SessionEmbeddingLifecycleOperationKind,
  SessionEmbeddingLifecycleOperationStatus,
  SessionEmbeddingLifecycleReceipt,
} from "./embedding-contract-lifecycle-types.ts";
import {
  acquireSessionEmbeddingLifecycleFence,
  assertSessionEmbeddingLifecycleAuthority,
  completeSessionEmbeddingLifecycleFence,
  pauseSessionEmbeddingLifecycleFence,
  inspectSessionEmbeddingLifecycleFence,
  readLatestSessionEmbeddingLifecycleReceipt,
  recoverSessionEmbeddingLifecycleFence,
  SessionEmbeddingLifecycleFenceError,
  type SessionEmbeddingLifecycleAuthority,
} from "./session-embedding-lifecycle-fence.ts";
import { readSessionMemoryMutationAuthorityMode } from "./project-session-mutation-fence.ts";
import { withSessionEmbeddingLifecycleAdmission } from "./session-memory-write-firewall.ts";
import { ProjectMemoryRetrievalIndexService } from "./project-memory-retrieval-index-service.ts";
import { SessionMemoryIndexService } from "./session-memory-index-service.ts";
import { extractProjectMemorySections } from "../project/project-memory-markdown-sections.ts";
import { requireSessionMemoryAuthorityActivation } from "../session-maintenance/authority-activation-service.ts";
import {
  deleteOwnedVectorRows,
  countOwnedIndexedVectorRows,
  dropOwnedVectorTable,
  ensureProjectMemoryRetrievalVectorTable,
  ensureSessionMemoryVectorTable,
  smokeOwnedVectorQuery,
} from "./sqlite-vec.ts";

export class EmbeddingContractLifecycleService {
  constructor(private readonly root: string) {}

  async migrate(input: { apply: boolean; staleBefore?: string }): Promise<EmbeddingMigrationResult> {
    const config = await loadConfig(this.root);
    const db = openMemoryDb(this.root);
    try {
      if (input.apply) requireSessionMemoryAuthorityActivation(db);
      const activeMode = readSessionMemoryMutationAuthorityMode(db) === "smc_v1";
      let scopes: EmbeddingMigrationScopePlan[] = await Promise.all([
        this.migrationPlan(db, config, "session_memory", activeMode),
        this.migrationPlan(db, config, "project_memory", activeMode),
      ]);
      if (!input.apply) return { mode: "preview", scopes };
      let frozen = freezeLifecyclePlan("migrate", scopes);
      if (activeMode) {
        const prior = reusableFrozenLifecyclePlan(db, "migrate");
        if (prior && (prior.source === "fence" || frozenPlanAtTarget(db, prior.plan))) {
          frozen = prior;
          scopes = cloneFrozenPlans<EmbeddingMigrationScopePlan>(prior.plan);
        }
      }
      const result: EmbeddingMigrationResult = { mode: "apply", scopes };
      const hasWork = scopes.some((plan) => plan.action !== "none");
      const ownership = activeMode && hasWork
        ? this.acquireSessionLifecycleOwnership(db, {
          operationKind: "migrate",
          activeContractId: frozen.source === "fresh"
            ? readActiveEmbeddingContract(db, "session_memory")?.id ?? null
            : frozen.activeContractId ?? null,
          targetContractId: frozen.digest,
          operationPlanJson: frozen.json,
          operationPlanDigest: frozen.digest,
          replayReceiptId: frozen.receiptId,
          staleBefore: input.staleBefore,
        })
        : null;
      if (ownership?.receipt) {
        for (const plan of scopes) plan.activated = plan.action !== "none" && migrationScopeAtTarget(db, plan);
        result.session_lifecycle = completedStatus(ownership.receipt);
        return result;
      }
      try {
        let failed = false;
        for (const plan of scopes) {
          if (ownership && migrationScopeAtTarget(db, plan)) {
            plan.activated = true;
            continue;
          }
          await this.applyMigrationPlan(db, config, plan, ownership, true);
          if (plan.error) {
            failed = true;
            continue;
          }
        }
        if (ownership) {
          if (failed) {
            result.session_lifecycle = this.pauseSessionLifecycleOwnership(db, ownership);
            return result;
          }
          const sessionPlan = scopes.find((plan) => plan.scope === "session_memory")!;
          const expectedSessionContractId = sessionPlan.action === "none"
            ? ownership.activeContractId
            : embeddingContractId("session_memory", identityFromStatus(sessionPlan.desired_contract!));
          this.assertActiveSessionContract(db, expectedSessionContractId);
          result.session_lifecycle = this.completeSessionLifecycleOwnership(db, ownership, result);
        }
      } catch (error) {
        if (ownership && !result.session_lifecycle) {
          result.session_lifecycle = this.pauseSessionLifecycleOwnership(db, ownership);
        }
        throw error;
      }
      return result;
    } finally {
      db.close();
    }
  }

  async rollback(input: { apply: boolean; staleBefore?: string }): Promise<EmbeddingRollbackResult> {
    const db = openMemoryDb(this.root);
    try {
      let scopes = (["session_memory", "project_memory"] as const).map((scope) => {
        const active = readActiveEmbeddingContract(db, scope);
        const previous = readPreviousEmbeddingContract(db, scope);
        return {
          scope,
          active_contract: active ? statusContract(active) : null,
          previous_contract: previous ? statusContract(previous) : null,
          action: previous ? "rollback" as const : "none" as const,
          rolled_back: false,
        };
      });
      const result: EmbeddingRollbackResult = { mode: input.apply ? "apply" : "preview", scopes };
      if (!input.apply) return result;
      const hasWork = scopes.some((plan) => plan.action === "rollback");
      if (hasWork) requireSessionMemoryAuthorityActivation(db);
      const activeMode = readSessionMemoryMutationAuthorityMode(db) === "smc_v1";
      let frozen = freezeLifecyclePlan("rollback", scopes);
      if (activeMode) {
        const prior = reusableFrozenLifecyclePlan(db, "rollback");
        if (prior && (prior.source === "fence" || frozenPlanAtTarget(db, prior.plan))) {
          frozen = prior;
          scopes = cloneFrozenPlans<EmbeddingRollbackScopePlan>(prior.plan);
          result.scopes = scopes;
        }
      }
      const ownership = activeMode && hasWork
        ? this.acquireSessionLifecycleOwnership(db, {
          operationKind: "rollback",
          activeContractId: frozen.source === "fresh"
            ? readActiveEmbeddingContract(db, "session_memory")?.id ?? null
            : frozen.activeContractId ?? null,
          targetContractId: frozen.digest,
          operationPlanJson: frozen.json,
          operationPlanDigest: frozen.digest,
          replayReceiptId: frozen.receiptId,
          staleBefore: input.staleBefore,
        })
        : null;
      if (ownership?.receipt) {
        for (const plan of scopes) plan.rolled_back = plan.action === "rollback" && rollbackScopeAtTarget(db, plan);
        result.session_lifecycle = completedStatus(ownership.receipt);
        return result;
      }
      try {
        const failures: unknown[] = [];
        for (const plan of scopes) {
          if (plan.action !== "rollback") continue;
          if (ownership && rollbackScopeAtTarget(db, plan)) {
            plan.rolled_back = true;
            continue;
          }
          try {
            this.withLifecycleMutation(db, ownership, () => rollbackEmbeddingContract(db, plan.scope));
            plan.rolled_back = true;
          } catch (error) {
            failures.push(error);
          }
        }
        if (failures.length > 0) {
          if (ownership) result.session_lifecycle = this.pauseSessionLifecycleOwnership(db, ownership);
          throw failures[0];
        }
        if (ownership) {
          const sessionPlan = scopes.find((plan) => plan.scope === "session_memory")!;
          const expectedSessionContractId = sessionPlan.action === "rollback"
            ? embeddingContractId("session_memory", identityFromStatus(sessionPlan.previous_contract!))
            : ownership.activeContractId;
          this.assertActiveSessionContract(db, expectedSessionContractId);
          result.session_lifecycle = this.completeSessionLifecycleOwnership(db, ownership, result);
        }
      } catch (error) {
        if (ownership && !result.session_lifecycle) {
          result.session_lifecycle = this.pauseSessionLifecycleOwnership(db, ownership);
        }
        throw error;
      }
      return result;
    } finally {
      db.close();
    }
  }

  async prune(input: { apply: boolean; staleBefore?: string }): Promise<EmbeddingPruneResult> {
    const db = openMemoryDb(this.root);
    try {
      let candidates = this.pruneCandidates(db);
      if (input.apply && candidates.length > 0) requireSessionMemoryAuthorityActivation(db);
      const activeMode = readSessionMemoryMutationAuthorityMode(db) === "smc_v1";
      let frozen = freezeLifecyclePlan("prune", candidates);
      if (input.apply && activeMode) {
        const prior = reusableFrozenLifecyclePlan(db, "prune");
        if (prior && (prior.source === "fence" || frozenPlanAtTarget(db, prior.plan))) {
          frozen = prior;
          candidates = cloneFrozenPlans<EmbeddingPruneCandidate>(prior.plan);
        }
      }
      const result: EmbeddingPruneResult = {
        mode: input.apply ? "apply" : "preview",
        candidates,
        removed_metadata_rows: 0,
        removed_query_cache_rows: 0,
        removed_vector_rows: 0,
        removed_vector_tables: [],
      };
      if (!input.apply) return result;
      const activeContractId = readActiveEmbeddingContract(db, "session_memory")?.id ?? null;
      const ownership = activeMode && candidates.length > 0
        ? this.acquireSessionLifecycleOwnership(db, {
          operationKind: "prune",
          activeContractId: frozen.source === "fresh" ? activeContractId : frozen.activeContractId ?? null,
          targetContractId: frozen.digest,
          operationPlanJson: frozen.json,
          operationPlanDigest: frozen.digest,
          replayReceiptId: frozen.receiptId,
          staleBefore: input.staleBefore,
        })
        : null;
      if (ownership?.receipt) {
        result.session_lifecycle = completedStatus(ownership.receipt);
        return result;
      }
      try {
        await this.assertPruneCoverage(db, candidates);
        const applyCandidates = () => {
          if (ownership) assertSessionEmbeddingLifecycleAuthority(db, requireLifecycleAuthority(ownership));
          for (const candidate of candidates) this.applyPruneCandidate(db, candidate, result);
        };
        if (ownership) db.transaction(applyCandidates).immediate();
        else db.transaction(applyCandidates)();
        if (ownership) {
          this.assertActiveSessionContract(db, ownership.activeContractId);
          result.session_lifecycle = this.completeSessionLifecycleOwnership(db, ownership, result);
        }
      } catch (error) {
        if (ownership) result.session_lifecycle = this.pauseSessionLifecycleOwnership(db, ownership);
        throw error;
      }
      return result;
    } finally {
      db.close();
    }
  }

  private async applyMigrationPlan(
    db: Database,
    config: MyelinConfig,
    plan: EmbeddingMigrationScopePlan,
    ownership: SessionLifecycleOwnership | null,
    activateAfterIndex: boolean,
  ): Promise<string | null> {
    if (plan.action === "none" || !plan.desired_contract) return null;
    try {
      return await this.applyScopeMigration(db, config, plan, ownership, activateAfterIndex);
    } catch (error) {
      plan.error = error instanceof Error ? error.message : String(error);
      plan.failure_code = embeddingProviderFailureCode(error) ?? "embedding_migration_failed";
      if (embeddingProviderFailureKind(error) === "provider") {
        this.withLifecycleMutation(db, ownership, () => markEmbeddingContractFailed(
          db,
          embeddingContractId(plan.scope, identityFromStatus(plan.desired_contract!)),
          plan.error!,
        ));
      }
      return null;
    }
  }

  private acquireSessionLifecycleOwnership(
    db: Database,
    input: {
      operationKind: SessionEmbeddingLifecycleOperationKind;
      activeContractId: string | null;
      targetContractId: string | null;
      operationPlanJson: string;
      operationPlanDigest: string;
      staleBefore?: string;
      replayReceiptId?: string;
    },
  ): SessionLifecycleOwnership | null {
    if (readSessionMemoryMutationAuthorityMode(db) === "legacy_compatibility") return null;
    const now = new Date().toISOString();
    const acquired = acquireSessionEmbeddingLifecycleFence(db, {
      operationKind: input.operationKind,
      activeContractId: input.activeContractId,
      targetContractId: input.targetContractId,
      operationPlanJson: input.operationPlanJson,
      operationPlanDigest: input.operationPlanDigest,
      now,
      staleBefore: input.staleBefore,
      replayReceiptId: input.replayReceiptId,
    });
    if (acquired.kind === "acquired") {
      return {
        ...input,
        operationId: acquired.fence.operation_id,
        generation: acquired.fence.generation,
        authority: acquired.authority,
        ownerEpoch: acquired.fence.owner_epoch,
        receipt: null,
      };
    }
    if (acquired.kind === "replayed") {
      return {
        ...input,
        operationId: acquired.receipt.operation_id,
        generation: acquired.receipt.generation,
        authority: null,
        ownerEpoch: acquired.receipt.owner_epoch,
        receipt: acquired.receipt,
      };
    }
    if (
      acquired.kind === "busy"
      && (acquired.owner.phase === "needs_followup" || acquired.owner.phase === "running")
      && acquired.owner.active_contract_id === input.activeContractId
      && acquired.owner.target_contract_id === input.targetContractId
      && acquired.owner.operation_plan_digest === input.operationPlanDigest
    ) {
      const operationId = acquired.owner.operation_id;
      const recovered = recoverSessionEmbeddingLifecycleFence(db, {
        operationId,
        operationKind: input.operationKind,
        expectedOwnerEpoch: acquired.owner.owner_epoch,
        expectedGeneration: acquired.owner.generation,
        expectedPhase: acquired.owner.phase,
        activeContractId: input.activeContractId,
        targetContractId: input.targetContractId,
        operationPlanDigest: input.operationPlanDigest,
        now,
        staleBefore: input.staleBefore,
      });
      if (recovered.kind === "updated") {
        return {
          ...input,
          operationId,
          generation: recovered.fence.generation,
          authority: recovered.authority,
          ownerEpoch: recovered.fence.owner_epoch,
          receipt: null,
        };
      }
      throw lifecycleCasError(recovered);
    }
    if (acquired.kind === "not_activated") return null;
    throw new SessionEmbeddingLifecycleFenceError(
      acquired.code,
      acquired.kind === "project_busy"
        ? `Session Memory project mutation is active for ${acquired.owner.project_key}`
        : `Session embedding lifecycle operation is active: ${acquired.owner.operation_id}`,
      acquired.owner,
    );
  }

  private pauseSessionLifecycleOwnership(
    db: Database,
    ownership: SessionLifecycleOwnership,
  ): SessionEmbeddingLifecycleOperationStatus {
    const paused = pauseSessionEmbeddingLifecycleFence(db, {
      authority: requireLifecycleAuthority(ownership),
      now: new Date().toISOString(),
    });
    if (paused.kind !== "updated") throw lifecycleCasError(paused);
    return {
      operation_id: ownership.operationId,
      generation: ownership.generation,
      owner_epoch: paused.fence.owner_epoch,
      phase: paused.fence.phase,
      receipt: null,
    };
  }

  private completeSessionLifecycleOwnership(
    db: Database,
    ownership: SessionLifecycleOwnership,
    result: EmbeddingMigrationResult | EmbeddingRollbackResult | EmbeddingPruneResult,
  ): SessionEmbeddingLifecycleOperationStatus {
    const completed = completeSessionEmbeddingLifecycleFence(db, {
      authority: requireLifecycleAuthority(ownership),
      resultDigest: lifecycleResultDigest(result),
      now: new Date().toISOString(),
    });
    if (completed.kind === "abandoned") {
      throw new SessionEmbeddingLifecycleFenceError(
        "session_embedding_lifecycle_receipt_conflict",
        `Session embedding lifecycle operation ${ownership.operationId} was already abandoned`,
      );
    }
    if (completed.kind !== "completed") throw lifecycleCasError(completed);
    return {
      operation_id: ownership.operationId,
      generation: completed.receipt.generation,
      owner_epoch: completed.receipt.owner_epoch,
      phase: "completed",
      receipt: completed.receipt,
    };
  }

  private assertActiveSessionContract(db: Database, expectedContractId: string | null): void {
    const actualContractId = readActiveEmbeddingContract(db, "session_memory")?.id ?? null;
    if (actualContractId !== expectedContractId) {
      throw new SessionEmbeddingLifecycleFenceError(
        "session_embedding_lifecycle_identity_mismatch",
        `active Session embedding contract drifted (expected ${expectedContractId ?? "none"}, found ${actualContractId ?? "none"})`,
      );
    }
  }

  private withLifecycleMutation<T>(
    db: Database,
    ownership: SessionLifecycleOwnership | null,
    callback: () => T,
  ): T {
    if (!ownership) return callback();
    const authority = requireLifecycleAuthority(ownership);
    return db.transaction(() => {
      assertSessionEmbeddingLifecycleAuthority(db, authority);
      return withSessionEmbeddingLifecycleAdmission(db, authority, callback);
    }).immediate();
  }

  private async assertPruneCoverage(db: Database, candidates: EmbeddingPruneCandidate[]): Promise<void> {
    const scopes = new Set(candidates.map((candidate) => candidate.scope));
    if (scopes.has("session_memory")) {
      const active = readActiveEmbeddingContract(db, "session_memory");
      if (!active) throw new Error("Cannot prune Session Memory embeddings without an active contract");
      const missing = (db.query(
        `SELECT count(*) AS count
         FROM session_memories sm
         WHERE sm.status = 'active'
           AND NOT EXISTS (
             SELECT 1 FROM session_memory_embeddings e
             WHERE e.session_memory_id = sm.id
               AND e.embedding_provider = ? AND e.embedding_model = ? AND e.embedding_dimensions = ?
               AND e.embedding_purpose = 'retrieval_document' AND e.format_version = ?
               AND e.status = 'indexed'
           )`,
      ).get(active.provider, active.model, active.dimensions, active.formatVersion) as { count: number }).count;
      if (missing > 0) {
        throw new Error(
          `Cannot prune historical Session Memory embeddings: ${missing} active memories lack the active contract index`,
        );
      }
    }
    if (scopes.has("project_memory")) {
      const active = readActiveEmbeddingContract(db, "project_memory");
      if (!active) throw new Error("Cannot prune Project Memory embeddings without an active contract");
      let missing = 0;
      for (const projectKey of await projectMemoryProjectKeys(this.root)) {
        const manifest = await extractProjectMemorySections(this.root, projectKey);
        const indexed = new Set((db.query(
          `SELECT wiki_path, section_id, section_hash
           FROM project_memory_retrieval_embeddings
           WHERE project_key = ?
             AND embedding_provider = ? AND embedding_model = ? AND embedding_dimensions = ?
             AND embedding_purpose = 'retrieval_document' AND format_version = ?
             AND status = 'indexed'`,
        ).all(projectKey, active.provider, active.model, active.dimensions, active.formatVersion) as Array<{
          wiki_path: string;
          section_id: string;
          section_hash: string;
        }>).map((row) => `${row.wiki_path}\0${row.section_id}\0${row.section_hash}`));
        missing += manifest.sections.filter((section) =>
          section.heading_level > 1
          && !indexed.has(`${section.wiki_path}\0${section.section_id}\0${section.section_hash}`)
        ).length;
      }
      if (missing > 0) {
        throw new Error(
          `Cannot prune historical Project Memory embeddings: ${missing} canonical sections lack the active contract index`,
        );
      }
    }
  }

  private async migrationPlan(
    db: Database,
    config: MyelinConfig,
    scope: EmbeddingScope,
    readOnly: boolean,
  ): Promise<EmbeddingMigrationScopePlan> {
    if (readOnly) {
      const planned = await planEmbeddingContract({ db, config, scope });
      return {
        scope,
        active_contract: planned.active ? statusContract(planned.active) : null,
        desired_contract: statusContract(planned.desired),
        action: planned.initializationRequired ? "initialize" : planned.migrationRequired ? "migrate" : "none",
        indexed: 0,
        failed: 0,
        pending_remaining: 0,
        activated: false,
      };
    }
    const resolved = await resolveEmbeddingContract({ db, config, scope });
    return {
      scope,
      active_contract: statusContract(resolved.active),
      desired_contract: statusContract(resolved.desired),
      action: resolved.migrationRequired ? "migrate" : "none",
      indexed: 0,
      failed: 0,
      pending_remaining: 0,
      activated: false,
    };
  }

  private async applyScopeMigration(
    db: Database,
    config: MyelinConfig,
    plan: EmbeddingMigrationScopePlan,
    ownership: SessionLifecycleOwnership | null,
    activateAfterIndex: boolean,
  ): Promise<string> {
    const desired = identityFromStatus(plan.desired_contract!);
    const runtime = await new EmbeddingProviderFactory(config).initializeContract({
      ...desired,
      purpose: "retrieval_document",
    });
    const staging = this.withLifecycleMutation(
      db,
      ownership,
      () => upsertStagingEmbeddingContract(db, { scope: plan.scope, contract: desired }),
    );
    if (plan.scope === "session_memory") {
      const table = ensureSessionMemoryVectorTable(db, {
        dimensions: runtime.contract.dimensions,
        table: staging.vectorTable,
      });
      if (!table.available) throw new Error(table.reason);
      for (const projectKey of sessionProjectKeys(db)) {
        const result = await indexSessionProject(db, {
          projectKey,
          contract: runtime.contract,
          provider: runtime.client,
          vectorTable: staging.vectorTable,
          batchSize: config.embedding.batchSize,
        });
        plan.indexed += result.indexed;
        plan.failed += result.failed;
        plan.pending_remaining += result.pending_remaining;
      }
    } else {
      const table = ensureProjectMemoryRetrievalVectorTable(db, {
        dimensions: runtime.contract.dimensions,
        table: staging.vectorTable,
      });
      if (!table.available) throw new Error(table.reason);
      for (const projectKey of await projectMemoryProjectKeys(this.root)) {
        const result = await indexProjectMemory(db, {
          root: this.root,
          projectKey,
          contract: runtime.contract,
          provider: runtime.client,
          vectorTable: staging.vectorTable,
          batchSize: config.embedding.batchSize,
        });
        plan.indexed += result.indexed;
        plan.failed += result.failed;
        plan.pending_remaining += result.pending_remaining;
      }
    }
    if (plan.failed > 0 || plan.pending_remaining > 0) {
      throw new Error(
        `${plan.scope} embedding migration incomplete: ${plan.failed} failed, ${plan.pending_remaining} pending`,
      );
    }
    const indexedMetadata = indexedActiveMetadataCount(db, plan.scope, desired);
    const vectorRows = countOwnedIndexedVectorRows(db, {
      scope: plan.scope,
      table: staging.vectorTable,
      contract: desired,
    });
    if (vectorRows !== indexedMetadata) {
      throw new Error(
        `${plan.scope} embedding migration verification failed: ${indexedMetadata} active indexed metadata rows, ${vectorRows} matching vector rows`,
      );
    }
    smokeOwnedVectorQuery(db, {
      scope: plan.scope,
      table: staging.vectorTable,
      contract: desired,
    });
    if (activateAfterIndex) {
      this.withLifecycleMutation(
        db,
        ownership,
        () => activateEmbeddingContract(db, { scope: plan.scope, contractId: staging.id }),
      );
      plan.activated = true;
    }
    return staging.id;
  }

  private pruneCandidates(db: Database): EmbeddingPruneCandidate[] {
    const candidates: EmbeddingPruneCandidate[] = [];
    for (const scope of ["session_memory", "project_memory"] as const) {
      const protectedIds = new Set([
        readActiveEmbeddingContract(db, scope)?.id,
        readPreviousEmbeddingContract(db, scope)?.id,
      ].filter((id): id is string => Boolean(id)));
      const registered = listEmbeddingContracts(db, scope);
      for (const contract of registered) {
        if (protectedIds.has(contract.id)) continue;
        candidates.push(this.pruneCandidate(db, scope, contract, contract.lifecycle, contract.vectorTable));
      }
      for (const row of historicalMetadataContracts(db, scope)) {
        const id = embeddingContractId(scope, normalizeHistoricalIdentity(row));
        if (protectedIds.has(id) || registered.some((contract) => contract.id === id)) continue;
        candidates.push({
          scope,
          contract: statusContract(row),
          metadata_rows: row.metadata_rows,
          query_cache_rows: queryCacheCount(db, row),
          lifecycle: "historical",
          vector_table: null,
        });
      }
    }
    return candidates;
  }

  private pruneCandidate(
    db: Database,
    scope: EmbeddingScope,
    contract: EmbeddingContractIdentity,
    lifecycle: string,
    vectorTable: string,
  ): EmbeddingPruneCandidate {
    return {
      scope,
      contract: statusContract(contract),
      metadata_rows: metadataCount(db, scope, contract),
      query_cache_rows: queryCacheCount(db, contract),
      lifecycle,
      vector_table: vectorTable,
    };
  }

  private applyPruneCandidate(db: Database, candidate: EmbeddingPruneCandidate, result: EmbeddingPruneResult): void {
    const table = candidate.scope === "session_memory" ? "session_memory_embeddings" : "project_memory_retrieval_embeddings";
    if (candidate.vector_table && candidate.vector_table.includes("_vec_")) {
      dropOwnedVectorTable(db, candidate.vector_table);
      result.removed_vector_tables.push(candidate.vector_table);
    } else {
      const metadataIdColumn = candidate.scope === "session_memory" ? "session_memory_id" : "id";
      const vectorIdColumn = candidate.scope === "session_memory" ? "memory_id" : "retrieval_row_id";
      const vectorTable = candidate.scope === "session_memory" ? "session_memory_vec" : "project_memory_section_vec";
      const ids = (db.query(
        `SELECT ${metadataIdColumn} AS id FROM ${table}
         WHERE embedding_provider = ? AND embedding_model = ? AND embedding_dimensions = ?
           AND format_version = ?`,
      ).all(
        candidate.contract.provider,
        candidate.contract.model,
        candidate.contract.dimensions,
        candidate.contract.format_version,
      ) as Array<{ id: string }>).map((row) => row.id);
      result.removed_vector_rows += deleteOwnedVectorRows(db, {
        table: vectorTable,
        idColumn: vectorIdColumn,
        ids,
        model: candidate.contract.model,
        dimensions: candidate.contract.dimensions,
        formatVersion: candidate.contract.format_version,
      });
    }
    const metadata = db.query(
      `DELETE FROM ${table}
       WHERE embedding_provider = ? AND embedding_model = ? AND embedding_dimensions = ?
         AND format_version = ?`,
    ).run(candidate.contract.provider, candidate.contract.model, candidate.contract.dimensions, candidate.contract.format_version);
    result.removed_metadata_rows += metadata.changes;
    const cache = db.query(
      `DELETE FROM query_embedding_cache
       WHERE embedding_provider = ? AND embedding_model = ? AND embedding_dimensions = ?
         AND format_version = ?`,
    ).run(candidate.contract.provider, candidate.contract.model, candidate.contract.dimensions, candidate.contract.format_version);
    result.removed_query_cache_rows += cache.changes;
    if (isEmbeddingProvider(candidate.contract.provider)) {
      const contract = identityFromStatus(candidate.contract);
      const registered = listEmbeddingContracts(db, candidate.scope).find((item) => sameEmbeddingContract(item, contract));
      if (registered) removeEmbeddingContract(db, registered.id);
    }
  }
}

async function indexSessionProject(
  db: Database,
  input: {
    projectKey: string;
    contract: Parameters<EmbeddingProviderFactory["initializeContract"]>[0];
    provider: Awaited<ReturnType<EmbeddingProviderFactory["initializeContract"]>>["client"];
    vectorTable: string;
    batchSize: number;
  },
) {
  let total = { indexed: 0, failed: 0, pending_remaining: 0 };
  while (true) {
    const result = await new SessionMemoryIndexService({
      db,
      contract: input.contract,
      provider: input.provider,
      vectorTable: input.vectorTable,
    }).indexPending({
      projectKey: input.projectKey,
      limit: 500,
      batchSize: input.batchSize,
      retryFailed: false,
    });
    total = {
      indexed: total.indexed + result.indexed,
      failed: total.failed + result.failed,
      pending_remaining: result.pending_remaining,
    };
    if (result.failed > 0 || result.pending_remaining === 0 || result.indexed === 0) return total;
  }
}

async function indexProjectMemory(
  db: Database,
  input: {
    root: string;
    projectKey: string;
    contract: Parameters<EmbeddingProviderFactory["initializeContract"]>[0];
    provider: Awaited<ReturnType<EmbeddingProviderFactory["initializeContract"]>>["client"];
    vectorTable: string;
    batchSize: number;
  },
) {
  let total = { indexed: 0, failed: 0, pending_remaining: 0 };
  while (true) {
    const result = await new ProjectMemoryRetrievalIndexService({
      root: input.root,
      db,
      contract: input.contract,
      provider: input.provider,
      vectorTable: input.vectorTable,
    }).indexProject({
      projectKey: input.projectKey,
      limit: 500,
      batchSize: input.batchSize,
      retryFailed: false,
    });
    total = {
      indexed: total.indexed + result.indexed,
      failed: total.failed + result.failed,
      pending_remaining: result.pending_remaining,
    };
    if (result.failed > 0 || result.pending_remaining === 0 || result.indexed === 0) return total;
  }
}

function sessionProjectKeys(db: Database): string[] {
  return (db.query("SELECT DISTINCT project_key FROM session_memories ORDER BY project_key").all() as Array<{ project_key: string }>)
    .map((row) => row.project_key);
}

async function projectMemoryProjectKeys(root: string): Promise<string[]> {
  const result: string[] = [];
  for (const project of await discoverProjects(root)) {
    try {
      if ((await readdir(join(project.dir, "wiki"))).some((entry) => entry.endsWith(".md"))) result.push(project.key);
    } catch {
      // Projects without canonical markdown have no Project Memory index to migrate.
    }
  }
  return result.sort();
}

function historicalMetadataContracts(db: Database, scope: EmbeddingScope): Array<EmbeddingContractIdentity & { metadata_rows: number }> {
  const table = scope === "session_memory" ? "session_memory_embeddings" : "project_memory_retrieval_embeddings";
  return db.query(
    `SELECT embedding_provider AS provider, embedding_model AS model, embedding_dimensions AS dimensions,
            format_version AS formatVersion, count(*) AS metadata_rows
     FROM ${table}
     WHERE embedding_purpose = 'retrieval_document'
     GROUP BY embedding_provider, embedding_model, embedding_dimensions, format_version
     ORDER BY embedding_provider, embedding_model, embedding_dimensions, format_version`,
  ).all() as Array<EmbeddingContractIdentity & { metadata_rows: number }>;
}

function normalizeHistoricalIdentity(identity: EmbeddingContractIdentity): EmbeddingContractIdentity {
  if ((identity.provider as string) === "ollama") {
    return { ...identity, provider: identity.model.includes("qwen") ? "ollama_qwen" : "ollama_nomic" };
  }
  return identity;
}

function metadataCount(db: Database, scope: EmbeddingScope, contract: EmbeddingContractIdentity): number {
  const table = scope === "session_memory" ? "session_memory_embeddings" : "project_memory_retrieval_embeddings";
  return (db.query(
    `SELECT count(*) AS count FROM ${table}
     WHERE embedding_provider = ? AND embedding_model = ? AND embedding_dimensions = ? AND format_version = ?`,
  ).get(contract.provider, contract.model, contract.dimensions, contract.formatVersion) as { count: number }).count;
}

function indexedActiveMetadataCount(
  db: Database,
  scope: EmbeddingScope,
  contract: EmbeddingContractIdentity,
): number {
  const table = scope === "session_memory" ? "session_memory_embeddings" : "project_memory_retrieval_embeddings";
  const activeClause = scope === "session_memory"
    ? "AND session_memory_id IN (SELECT id FROM session_memories WHERE status = 'active')"
    : "";
  return (db.query(
    `SELECT count(*) AS count FROM ${table}
     WHERE embedding_provider = ? AND embedding_model = ? AND embedding_dimensions = ?
       AND format_version = ? AND status = 'indexed' ${activeClause}`,
  ).get(contract.provider, contract.model, contract.dimensions, contract.formatVersion) as { count: number }).count;
}

function queryCacheCount(db: Database, contract: EmbeddingContractIdentity): number {
  return (db.query(
    `SELECT count(*) AS count FROM query_embedding_cache
     WHERE embedding_provider = ? AND embedding_model = ? AND embedding_dimensions = ? AND format_version = ?`,
  ).get(contract.provider, contract.model, contract.dimensions, contract.formatVersion) as { count: number }).count;
}

function statusContract(contract: EmbeddingContractIdentity): EmbeddingContractStatus {
  return {
    provider: contract.provider,
    model: contract.model,
    dimensions: contract.dimensions,
    format_version: contract.formatVersion,
  };
}

function identityFromStatus(contract: EmbeddingContractStatus): EmbeddingContractIdentity {
  if (!isEmbeddingProvider(contract.provider)) {
    throw new Error(`Unsupported embedding provider in lifecycle state: ${contract.provider}`);
  }
  return {
    provider: contract.provider,
    model: contract.model,
    dimensions: contract.dimensions,
    formatVersion: contract.format_version,
  };
}

function isEmbeddingProvider(provider: string): provider is EmbeddingContractIdentity["provider"] {
  return provider === "ollama_nomic" || provider === "ollama_qwen" || provider === "gemini";
}

type SessionLifecycleOwnership = {
  operationKind: SessionEmbeddingLifecycleOperationKind;
  operationId: string;
  generation: number;
  activeContractId: string | null;
  targetContractId: string | null;
  ownerEpoch: number;
  authority: SessionEmbeddingLifecycleAuthority | null;
  receipt: SessionEmbeddingLifecycleReceipt | null;
  operationPlanJson: string;
  operationPlanDigest: string;
  staleBefore?: string;
  replayReceiptId?: string;
};

function lifecycleResultDigest(
  result: EmbeddingMigrationResult | EmbeddingRollbackResult | EmbeddingPruneResult,
): string {
  const { session_lifecycle: _sessionLifecycle, ...receiptResult } = result;
  return sha256Digest(JSON.stringify(receiptResult));
}

type FrozenLifecyclePlanState = {
  plan: SessionEmbeddingLifecycleFrozenPlan;
  json: string;
  digest: string;
  source?: "fresh" | "fence" | "receipt";
  activeContractId?: string | null;
  targetContractId?: string | null;
  operationId?: string;
  generation?: number;
  receiptId?: string;
};

function freezeLifecyclePlan(
  operationKind: SessionEmbeddingLifecycleOperationKind,
  orderedScopePlans: SessionEmbeddingLifecycleFrozenPlan["ordered_scope_plans"],
): FrozenLifecyclePlanState {
  const plan: SessionEmbeddingLifecycleFrozenPlan = {
    version: 1,
    operation_kind: operationKind,
    ordered_scope_plans: structuredClone(orderedScopePlans),
  };
  const json = JSON.stringify(plan);
  return { plan, json, digest: sha256Digest(json), source: "fresh" };
}

function reusableFrozenLifecyclePlan(
  db: Database,
  operationKind: SessionEmbeddingLifecycleOperationKind,
): FrozenLifecyclePlanState | null {
  const fence = inspectSessionEmbeddingLifecycleFence(db);
  if (fence?.operation_kind === operationKind) {
    return { ...parseFrozenLifecyclePlan(
      fence.operation_plan_json,
      fence.operation_plan_digest,
      operationKind,
      "fence",
    ), activeContractId: fence.active_contract_id, targetContractId: fence.target_contract_id,
      operationId: fence.operation_id, generation: fence.generation };
  }
  const receipt = readLatestSessionEmbeddingLifecycleReceipt(db);
  if (!receipt || receipt.outcome !== "completed" || receipt.operation_kind !== operationKind) return null;
  return { ...parseFrozenLifecyclePlan(
    receipt.operation_plan_json,
    receipt.operation_plan_digest,
    operationKind,
    "receipt",
  ), activeContractId: receipt.active_contract_id, targetContractId: receipt.target_contract_id,
    operationId: receipt.operation_id, generation: receipt.generation, receiptId: receipt.id };
}

function parseFrozenLifecyclePlan(
  json: string,
  digest: string,
  operationKind: SessionEmbeddingLifecycleOperationKind,
  source: "fence" | "receipt",
): FrozenLifecyclePlanState {
  if (sha256Digest(json) !== digest) {
    throw new SessionEmbeddingLifecycleFenceError(
      "session_embedding_lifecycle_identity_mismatch",
      `persisted ${operationKind} operation plan digest does not match its canonical JSON`,
    );
  }
  const plan = JSON.parse(json) as Partial<SessionEmbeddingLifecycleFrozenPlan>;
  if (plan.version !== 1 || plan.operation_kind !== operationKind || !Array.isArray(plan.ordered_scope_plans)) {
    throw new SessionEmbeddingLifecycleFenceError(
      "session_embedding_lifecycle_identity_mismatch",
      `persisted ${operationKind} operation plan is invalid`,
    );
  }
  return { plan: plan as SessionEmbeddingLifecycleFrozenPlan, json, digest, source };
}

function cloneFrozenPlans<T>(frozen: SessionEmbeddingLifecycleFrozenPlan): T[] {
  return structuredClone(frozen.ordered_scope_plans) as T[];
}

function migrationScopeAtTarget(db: Database, plan: EmbeddingMigrationScopePlan): boolean {
  if (plan.action === "none") return true;
  if (!plan.desired_contract) return false;
  return readActiveEmbeddingContract(db, plan.scope)?.id
    === embeddingContractId(plan.scope, identityFromStatus(plan.desired_contract));
}

function rollbackScopeAtTarget(db: Database, plan: EmbeddingRollbackScopePlan): boolean {
  if (plan.action === "none") return true;
  if (!plan.previous_contract) return false;
  return readActiveEmbeddingContract(db, plan.scope)?.id
    === embeddingContractId(plan.scope, identityFromStatus(plan.previous_contract));
}

function frozenPlanAtTarget(db: Database, frozen: SessionEmbeddingLifecycleFrozenPlan): boolean {
  if (frozen.operation_kind === "migrate") {
    return (frozen.ordered_scope_plans as EmbeddingMigrationScopePlan[])
      .every((plan) => migrationScopeAtTarget(db, plan));
  }
  if (frozen.operation_kind === "rollback") {
    return (frozen.ordered_scope_plans as EmbeddingRollbackScopePlan[])
      .every((plan) => rollbackScopeAtTarget(db, plan));
  }
  return (frozen.ordered_scope_plans as EmbeddingPruneCandidate[]).every((candidate) => {
    const identity = identityFromStatus(candidate.contract);
    return metadataCount(db, candidate.scope, identity) === 0
      && queryCacheCount(db, identity) === 0
      && !listEmbeddingContracts(db, candidate.scope).some((contract) => contract.id === embeddingContractId(candidate.scope, identity))
      && (
        !candidate.vector_table?.includes("_vec_")
        || db.query("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?").get(candidate.vector_table) === null
      );
  });
}

function requireLifecycleAuthority(ownership: SessionLifecycleOwnership): SessionEmbeddingLifecycleAuthority {
  if (!ownership.authority) {
    throw new SessionEmbeddingLifecycleFenceError(
      "session_embedding_lifecycle_authority_invalid",
      `terminal lifecycle operation ${ownership.operationId} cannot issue mutation authority`,
    );
  }
  return ownership.authority;
}

function completedStatus(receipt: SessionEmbeddingLifecycleReceipt): SessionEmbeddingLifecycleOperationStatus {
  return {
    operation_id: receipt.operation_id,
    generation: receipt.generation,
    owner_epoch: receipt.owner_epoch,
    phase: receipt.outcome,
    receipt,
  };
}

function sha256Digest(value: string): string {
  return `sha256:${createHash("sha256").update(value).digest("hex")}`;
}

function lifecycleCasError(input: {
  code: string;
  fence: unknown;
}): SessionEmbeddingLifecycleFenceError {
  return new SessionEmbeddingLifecycleFenceError(
    input.code as ConstructorParameters<typeof SessionEmbeddingLifecycleFenceError>[0],
    "Session embedding lifecycle fence compare-and-set was rejected",
  );
}
