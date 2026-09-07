import { randomUUID } from "node:crypto";

import type { Transaction } from "@sequelize/core";

import type { CaptureSourceKey } from "../capture/capture-adapter.ts";
import type { SqliteDatabase } from "../storage/sqlite/sqlite-database.ts";
import type { WorkspaceContext } from "../workspace/workspace-context.ts";
import type { CapturedEvidenceReference } from "./captured-evidence-reference.ts";
import type { EvidenceItemDto } from "./evidence-item.dto.ts";
import type {
  EvidenceScopeFilters,
  IEvidenceItemRepository,
  IEvidenceQueryRepository,
} from "./evidence-item.repository.ts";
import type { EvidenceItem } from "../storage/sqlite/models/evidence-item.model.ts";

/**
 * A thirty-minute lease leaves enough time for a normal curator invocation
 * while allowing an abandoned process to become retryable without a long wait.
 */
export const EVIDENCE_LEASE_DURATION_MS = 30 * 60 * 1000;

export interface IEvidenceLedgerRepository {
  ClaimEvidence(
    evidenceIds: readonly number[],
    attemptId: string,
    leaseExpiresAt: string,
    transaction: Transaction,
  ): Promise<void>;
  VerifyOwnership(
    evidenceIds: readonly number[],
    attemptId: string,
    transaction: Transaction,
  ): Promise<boolean>;
  CompleteEvidence(
    evidenceIds: readonly number[],
    attemptId: string,
    transaction: Transaction,
  ): Promise<void>;
  ReleaseEvidence(
    evidenceIds: readonly number[],
    attemptId: string,
    transaction: Transaction,
  ): Promise<void>;
  RenewEvidence(
    evidenceIds: readonly number[],
    attemptId: string,
    leaseExpiresAt: string,
    transaction: Transaction,
  ): Promise<void>;
}

export interface IEvidenceClaimRequest {
  readonly workspaceContext: WorkspaceContext;
  readonly captureSourceKey: CaptureSourceKey;
  readonly batchSize: number;
}

export interface IClaimedEvidenceBatch {
  readonly attemptId: string;
  readonly evidence: readonly EvidenceItem[];
}

type EvidenceRepository = IEvidenceItemRepository & IEvidenceQueryRepository;

export class EvidenceManager {
  public constructor(
    private readonly sqliteDatabase: SqliteDatabase,
    private readonly evidenceItemRepository: EvidenceRepository,
    private readonly evidenceLedgerRepository: IEvidenceLedgerRepository,
  ) {}

  public async InsertBatch(
    items: readonly EvidenceItemDto[],
  ): Promise<readonly CapturedEvidenceReference[]> {
    const retainedItems = items.filter(
      (item) => (item.normalizedContent?.trim().length ?? 0) > 0,
    );
    if (retainedItems.length === 0) {
      return [];
    }

    return await this.evidenceItemRepository.insertBatch(retainedItems);
  }

  public async insertBatch(
    items: readonly EvidenceItemDto[],
  ): Promise<readonly CapturedEvidenceReference[]> {
    return await this.InsertBatch(items);
  }

  public async CountUnavailableGitEvidence(
    workspaceContext: WorkspaceContext,
    captureSourceKey: CaptureSourceKey,
  ): Promise<number> {
    const filters: Omit<EvidenceScopeFilters, "limit"> = {
      workspaceContext,
      captureSourceKey,
    };

    return await this.sqliteDatabase.readTransaction(async (transaction) =>
      await this.evidenceItemRepository.CountUnavailableGitEvidence(
        filters,
        transaction,
      ),
    );
  }

  public async ClaimEvidence(
    request: IEvidenceClaimRequest,
  ): Promise<IClaimedEvidenceBatch | null> {
    validateBatchSize(request.batchSize);
    if (request.workspaceContext.git?.kind === "unavailable") {
      throw new Error("The current Git context is unavailable.");
    }

    return await this.sqliteDatabase.writeTransaction(async (transaction) => {
      const eligibilityAt = new Date();
      const evidence = await this.evidenceItemRepository.GetAllEligibleEvidence(
        {
          workspaceContext: request.workspaceContext,
          captureSourceKey: request.captureSourceKey,
          limit: request.batchSize,
        },
        eligibilityAt.toISOString(),
        transaction,
      );

      if (evidence.length === 0) {
        return null;
      }

      const attemptId = randomUUID();
      const leaseExpiresAt = new Date(
        eligibilityAt.getTime() + EVIDENCE_LEASE_DURATION_MS,
      ).toISOString();
      await this.evidenceLedgerRepository.ClaimEvidence(
        evidence.map((item) => item.id),
        attemptId,
        leaseExpiresAt,
        transaction,
      );

      return { attemptId, evidence };
    });
  }

  public async VerifyOwnership(
    batch: IClaimedEvidenceBatch,
    transaction: Transaction,
  ): Promise<boolean> {
    const evidenceIds = getEvidenceIds(batch);
    return await this.evidenceLedgerRepository.VerifyOwnership(
      evidenceIds,
      batch.attemptId,
      transaction,
    );
  }

  public async RenewEvidence(
    batch: IClaimedEvidenceBatch,
  ): Promise<boolean> {
    const evidenceIds = getEvidenceIds(batch);
    return await this.sqliteDatabase.writeTransaction(async (transaction) => {
      const owned = await this.evidenceLedgerRepository.VerifyOwnership(
        evidenceIds,
        batch.attemptId,
        transaction,
      );
      if (!owned) {
        return false;
      }

      const leaseExpiresAt = new Date(
        Date.now() + EVIDENCE_LEASE_DURATION_MS,
      ).toISOString();
      await this.evidenceLedgerRepository.RenewEvidence(
        evidenceIds,
        batch.attemptId,
        leaseExpiresAt,
        transaction,
      );
      return true;
    });
  }

  public async CompleteEvidence(
    batch: IClaimedEvidenceBatch,
    transaction: Transaction,
  ): Promise<void> {
    await this.evidenceLedgerRepository.CompleteEvidence(
      getEvidenceIds(batch),
      batch.attemptId,
      transaction,
    );
  }

  public async ReleaseEvidence(
    batch: IClaimedEvidenceBatch,
  ): Promise<void> {
    await this.sqliteDatabase.writeTransaction(async (transaction) => {
      await this.evidenceLedgerRepository.ReleaseEvidence(
        getEvidenceIds(batch),
        batch.attemptId,
        transaction,
      );
    });
  }
}

function validateBatchSize(batchSize: number): void {
  if (!Number.isSafeInteger(batchSize) || batchSize <= 0) {
    throw new RangeError("The evidence batch size must be a positive integer.");
  }
}

function getEvidenceIds(batch: IClaimedEvidenceBatch): readonly number[] {
  if (batch.evidence.length === 0) {
    throw new Error("A claimed evidence batch cannot be empty.");
  }

  return batch.evidence.map((item) => item.id);
}
