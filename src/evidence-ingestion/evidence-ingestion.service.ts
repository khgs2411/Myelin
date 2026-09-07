import type { IApplicationConfiguration } from "../application.configuration.ts";
import type { EvidenceAdapterFactory } from "../evidence/evidence-adapter.factory.ts";
import type {
  IClaimedEvidenceBatch,
  EvidenceManager,
} from "../evidence/evidence-manager.ts";
import type { IEvidenceAdapter } from "../evidence/evidence.adapter.ts";
import type { EvidenceItem } from "../storage/sqlite/models/evidence-item.model.ts";
import type { SqliteDatabase } from "../storage/sqlite/sqlite-database.ts";
import { SessionMemoryManager } from "../session-memory/session-memory-manager.ts";
import type { WorkspaceContextService } from "../workspace/workspace-context.service.ts";
import type { WorkspaceContext } from "../workspace/workspace-context.ts";
import type {
  ICuratorExecutor,
  IEvidenceIngestionRequest,
  IEvidenceIngestionResult,
} from "./evidence-ingestion.types.ts";
import type { ISessionMemoryDraft } from "../session-memory/session-memory-manager.ts";

type EvidenceIngestionConfiguration = Readonly<{
  evidenceIngestion: Pick<
    IApplicationConfiguration["evidenceIngestion"],
    "batchSize"
  >;
  agents: Pick<IApplicationConfiguration["agents"], "evidenceCurator">;
}>;

type WorkspaceResolver = Pick<WorkspaceContextService, "resolve">;
type EvidenceAdapterCreator = Pick<EvidenceAdapterFactory, "Create">;
type EvidenceIngestionManager = Pick<
  EvidenceManager,
  | "CountUnavailableGitEvidence"
  | "ClaimEvidence"
  | "RenewEvidence"
  | "VerifyOwnership"
  | "CompleteEvidence"
  | "ReleaseEvidence"
>;
type SessionMemoryPublisher = Pick<SessionMemoryManager, "Publish">;
type WriteTransactionDatabase = Pick<SqliteDatabase, "writeTransaction">;

export class EvidenceIngestionService {
  public constructor(
    private readonly workspaceContextService: WorkspaceResolver,
    private readonly evidenceAdapterFactory: EvidenceAdapterCreator,
    private readonly evidenceManager: EvidenceIngestionManager,
    private readonly sessionMemoryManager: SessionMemoryPublisher,
    private readonly sqliteDatabase: WriteTransactionDatabase,
    private readonly configuration: EvidenceIngestionConfiguration,
    private readonly curatorExecutor: ICuratorExecutor,
  ) {}

  public async Ingest(
    request: IEvidenceIngestionRequest,
  ): Promise<IEvidenceIngestionResult> {
    const workspaceContext = await this.resolveWorkspace(
      request.workingDirectory,
    );
    if (workspaceContext.git?.kind === "unavailable") {
      throw new Error(workspaceContext.git.safeDiagnostic);
    }

    // Source support must be established before any evidence lease can exist.
    const adapter = this.evidenceAdapterFactory.Create(
      request.captureSourceKey,
    );
    const skippedUnavailableGitEvidenceCount =
      await this.evidenceManager.CountUnavailableGitEvidence(
        workspaceContext,
        request.captureSourceKey,
      );
    const batch = await this.evidenceManager.ClaimEvidence({
      workspaceContext,
      captureSourceKey: request.captureSourceKey,
      batchSize: this.configuration.evidenceIngestion.batchSize,
    });

    if (batch === null) {
      return {
        processedEvidenceCount: 0,
        createdMemoryIds: [],
        skippedUnavailableGitEvidenceCount,
      };
    }

    try {
      const drafts = await this.prepareAndCurate(adapter, batch);

      // Refresh the lease after preparation and execution. The manager checks
      // the complete original batch and renews it atomically.
      const renewed = await this.evidenceManager.RenewEvidence(batch);
      if (!renewed) {
        throw new Error("Evidence processing ownership changed before publication.");
      }

      const entries = await this.sqliteDatabase.writeTransaction(
        async (transaction) => {
          const owned = await this.evidenceManager.VerifyOwnership(
            batch,
            transaction,
          );
          if (!owned) {
            throw new Error(
              "Evidence processing ownership changed before publication.",
            );
          }

          const published = await this.sessionMemoryManager.Publish(
            workspaceContext.project.identity,
            drafts,
            transaction,
          );
          await this.evidenceManager.CompleteEvidence(batch, transaction);
          return published;
        },
      );

      return {
        processedEvidenceCount: batch.evidence.length,
        createdMemoryIds: entries.map((entry) => entry.id),
        skippedUnavailableGitEvidenceCount,
      };
    } catch (cause) {
      // writeTransaction has rolled back before this cleanup starts. Release
      // only rows that this attempt still owns, then preserve the failure.
      await this.releaseAfterFailure(batch);
      throw cause;
    }
  }

  private async resolveWorkspace(
    workingDirectory: string,
  ): Promise<WorkspaceContext> {
    const resolution = await this.workspaceContextService.resolve({
      workingDirectory,
    });

    if (resolution.kind === "failed") {
      throw new Error(resolution.failure.safeDiagnostic);
    }
    if (resolution.kind === "unmanaged") {
      throw new Error(resolution.reason.safeDiagnostic);
    }

    return resolution.context;
  }

  private async prepareAndCurate(
    adapter: IEvidenceAdapter,
    batch: IClaimedEvidenceBatch,
  ): Promise<readonly ISessionMemoryDraft[]> {
    const preparedEvidence = adapter.Prepare(batch.evidence);
    const result = await this.curatorExecutor.Execute(
      preparedEvidence,
      this.configuration.agents.evidenceCurator,
    );
    return validateCuratorResult(result, batch.evidence);
  }

  private async releaseAfterFailure(
    batch: IClaimedEvidenceBatch,
  ): Promise<void> {
    try {
      await this.evidenceManager.ReleaseEvidence(batch);
    } catch {
      // Preserve the post-claim failure. The manager owns the cleanup
      // transaction and restricts its update to still-owned rows.
    }
  }
}

function validateCuratorResult(
  result: unknown,
  evidence: readonly EvidenceItem[],
): readonly ISessionMemoryDraft[] {
  if (!isRecord(result) || result.outcome !== "completed") {
    throw new Error("The evidence curator did not report completed evaluation.");
  }
  if (!Array.isArray(result.memories)) {
    throw new Error("The evidence curator result has no memories array.");
  }

  const evidenceById = new Map<number, EvidenceItem>();
  for (const item of evidence) {
    if (evidenceById.has(item.id)) {
      throw new Error("The claimed evidence batch contains a duplicate ID.");
    }
    evidenceById.set(item.id, item);
  }

  return result.memories.map((candidate, index) =>
    validateDraft(candidate, index, evidenceById),
  );
}

function validateDraft(
  candidate: unknown,
  index: number,
  evidenceById: ReadonlyMap<number, EvidenceItem>,
): ISessionMemoryDraft {
  if (!isRecord(candidate)) {
    throw invalidDraft(index);
  }
  if (
    typeof candidate.content !== "string" ||
    candidate.content.trim().length === 0
  ) {
    throw invalidDraft(index);
  }
  if (!Array.isArray(candidate.evidenceIds) || candidate.evidenceIds.length === 0) {
    throw invalidDraft(index);
  }
  if (
    candidate.evidenceIds.some(
      (evidenceId) =>
        typeof evidenceId !== "number" ||
        !Number.isSafeInteger(evidenceId) ||
        !evidenceById.has(evidenceId),
    )
  ) {
    throw invalidDraft(index);
  }

  const evidenceIds = candidate.evidenceIds as number[];
  if (new Set(evidenceIds).size !== evidenceIds.length) {
    throw invalidDraft(index);
  }

  const observedAt = candidate.observedAt;
  if (!isCanonicalUtcTimestamp(observedAt)) {
    throw invalidDraft(index);
  }

  return {
    content: candidate.content,
    observedAt,
    evidenceIds,
  };
}

function isCanonicalUtcTimestamp(value: unknown): value is string | null {
  if (value === null) {
    return true;
  }
  if (typeof value !== "string" || !Number.isFinite(Date.parse(value))) {
    return false;
  }

  return new Date(value).toISOString() === value;
}

function invalidDraft(index: number): Error {
  return new Error(`The evidence curator returned an invalid memory draft at index ${index}.`);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
