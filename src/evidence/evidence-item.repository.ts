import { createHash } from "node:crypto";

import { Op, sql, type Transaction, type WhereOptions } from "@sequelize/core";

import { ApplicationError } from "../application-error.ts";
import type { CaptureSourceKey } from "../capture/capture-adapter.ts";
import { EvidenceItem } from "../storage/sqlite/models/evidence-item.model.ts";
import { Project } from "../storage/sqlite/models/project.model.ts";
import type { SqliteDatabase } from "../storage/sqlite/sqlite-database.ts";
import type { CapturedEvidenceReference } from "./captured-evidence-reference.ts";
import type { EvidenceItemDto } from "./evidence-item.dto.ts";
import type { GitContext, WorkspaceContext } from "../workspace/workspace-context.ts";

export type EvidenceProcessingFilter =
  | Readonly<{ kind: "unclaimed" }>
  | Readonly<{
      kind: "status";
      status: "processing" | "void" | "processed";
    }>
  | Readonly<{ kind: "eligible"; at: string }>;

export type EvidenceScopeFilters = Readonly<{
  workspaceContext: WorkspaceContext;
  captureSourceKey: CaptureSourceKey;
  limit: number;
}>;

export type EvidenceFilters = EvidenceScopeFilters & Readonly<{
  processing: EvidenceProcessingFilter;
}>;

// The design contract names the complete filter shape IEvidenceFilters.
export type IEvidenceFilters = EvidenceFilters;

export interface IEvidenceItemRepository {
  insertBatch(
    items: readonly EvidenceItemDto[],
  ): Promise<readonly CapturedEvidenceReference[]>;
}

export interface IEvidenceQueryRepository {
  GetEvidence(
    filters: EvidenceFilters,
    transaction: Transaction,
  ): Promise<readonly EvidenceItem[]>;
  GetAllUnclaimedEvidence(
    filters: EvidenceScopeFilters,
    transaction: Transaction,
  ): Promise<readonly EvidenceItem[]>;
  GetAllVoidEvidence(
    filters: EvidenceScopeFilters,
    transaction: Transaction,
  ): Promise<readonly EvidenceItem[]>;
  GetAllProcessingEvidence(
    filters: EvidenceScopeFilters,
    transaction: Transaction,
  ): Promise<readonly EvidenceItem[]>;
  GetAllProcessedEvidence(
    filters: EvidenceScopeFilters,
    transaction: Transaction,
  ): Promise<readonly EvidenceItem[]>;
  GetAllEligibleEvidence(
    filters: EvidenceScopeFilters,
    at: string,
    transaction: Transaction,
  ): Promise<readonly EvidenceItem[]>;
  CountUnavailableGitEvidence(
    filters: Omit<EvidenceScopeFilters, "limit">,
    transaction: Transaction,
  ): Promise<number>;
}

export class EvidenceItemRepository
  implements IEvidenceItemRepository, IEvidenceQueryRepository
{
  public constructor(private readonly sqliteDatabase: SqliteDatabase) {}

  public async insertBatch(
    items: readonly EvidenceItemDto[],
  ): Promise<readonly CapturedEvidenceReference[]> {
    const firstItem = items[0];
    if (!firstItem) {
      throw new ApplicationError("capture:invalid-input");
    }

    const projectId = firstItem.workspaceContext.project.identity;
    if (items.some((item) => item.workspaceContext.project.identity !== projectId)) {
      throw new ApplicationError("capture:mixed-project-batch");
    }

    const preparedItems = items.map((item) => {
      // Copy bytes and serialize context before awaiting the transaction.
      // Stored content must remain the same content used for its digest.
      const rawSourceContent = Buffer.from(item.sourceMaterial.content);
      return {
        projectId,
        captureSourceKey: item.captureSourceKey,
        nativeEventKind: item.nativeEventKind,
        nativeSessionReference: item.nativeSessionReference ?? null,
        nativeInteractionReference: item.nativeInteractionReference ?? null,
        nativeOccurredAt: item.nativeOccurredAt ?? null,
        normalizedContent: item.normalizedContent,
        workingDirectory: item.workspaceContext.workingDirectory,
        workspaceContextJson: JSON.stringify(item.workspaceContext),
        rawSourceFormat: item.sourceMaterial.format,
        rawSourceContent,
        rawSourceDigest: createHash("sha256").update(rawSourceContent).digest("hex"),
        replayScheme: item.replay.scheme,
        replayKey: item.replay.key,
      };
    });

    return this.sqliteDatabase.writeTransaction(async (transaction) => {
      const project = await Project.findByPk(projectId, {
        transaction,
        rejectOnEmpty: true,
      });
      const references: CapturedEvidenceReference[] = [];

      for (const item of preparedItems) {
        const existing = await EvidenceItem.findOne({
          where: {
            captureSourceKey: item.captureSourceKey,
            projectId,
            replayScheme: item.replayScheme,
            replayKey: item.replayKey,
          },
          transaction,
        });

        if (existing) {
          if (
            existing.rawSourceFormat !== item.rawSourceFormat ||
            !existing.rawSourceContent.equals(item.rawSourceContent)
          ) {
            throw new ApplicationError("capture:replay-conflict");
          }

          references.push({
            evidenceId: existing.id,
            projectSequence: existing.projectSequence,
            disposition: "existing",
          });
          continue;
        }

        const projectSequence = project.lastAllocatedEvidenceSequence + 1;
        if (!Number.isSafeInteger(projectSequence)) {
          throw new ApplicationError("capture:failed");
        }

        project.lastAllocatedEvidenceSequence = projectSequence;
        await project.save({
          fields: ["lastAllocatedEvidenceSequence"],
          transaction,
        });

        const row = await EvidenceItem.create(
          { ...item, projectSequence, receivedAt: new Date().toISOString() },
          { transaction },
        );
        references.push({
          evidenceId: row.id,
          projectSequence: row.projectSequence,
          disposition: "inserted",
        });
      }

      return references;
    });
  }

  public async GetEvidence(
    filters: EvidenceFilters,
    transaction: Transaction,
  ): Promise<readonly EvidenceItem[]> {
    const where: WhereOptions = {
      projectId: filters.workspaceContext.project.identity,
      captureSourceKey: filters.captureSourceKey,
      workingDirectory: filters.workspaceContext.workingDirectory,
      [Op.and]: [
        this.buildWorkspaceMatch(filters.workspaceContext),
        this.buildProcessingMatch(filters.processing),
      ],
    };

    return await EvidenceItem.findAll({
      where,
      order: [["projectSequence", "ASC"]],
      limit: filters.limit,
      transaction,
    });
  }

  public async GetAllUnclaimedEvidence(
    filters: EvidenceScopeFilters,
    transaction: Transaction,
  ): Promise<readonly EvidenceItem[]> {
    return await this.GetEvidence(
      { ...filters, processing: { kind: "unclaimed" } },
      transaction,
    );
  }

  public async GetAllVoidEvidence(
    filters: EvidenceScopeFilters,
    transaction: Transaction,
  ): Promise<readonly EvidenceItem[]> {
    return await this.GetEvidence(
      { ...filters, processing: { kind: "status", status: "void" } },
      transaction,
    );
  }

  public async GetAllProcessingEvidence(
    filters: EvidenceScopeFilters,
    transaction: Transaction,
  ): Promise<readonly EvidenceItem[]> {
    return await this.GetEvidence(
      { ...filters, processing: { kind: "status", status: "processing" } },
      transaction,
    );
  }

  public async GetAllProcessedEvidence(
    filters: EvidenceScopeFilters,
    transaction: Transaction,
  ): Promise<readonly EvidenceItem[]> {
    return await this.GetEvidence(
      { ...filters, processing: { kind: "status", status: "processed" } },
      transaction,
    );
  }

  public async GetAllEligibleEvidence(
    filters: EvidenceScopeFilters,
    at: string,
    transaction: Transaction,
  ): Promise<readonly EvidenceItem[]> {
    return await this.GetEvidence(
      { ...filters, processing: { kind: "eligible", at } },
      transaction,
    );
  }

  public async CountUnavailableGitEvidence(
    filters: Omit<EvidenceScopeFilters, "limit">,
    transaction: Transaction,
  ): Promise<number> {
    const where: WhereOptions = {
      projectId: filters.workspaceContext.project.identity,
      captureSourceKey: filters.captureSourceKey,
      workingDirectory: filters.workspaceContext.workingDirectory,
      [Op.and]: [this.buildUnavailableGitMatch()],
    };

    return await EvidenceItem.count({ where, transaction });
  }

  private buildWorkspaceMatch(
    workspaceContext: WorkspaceContext,
  ): ReturnType<typeof sql> {
    const git = workspaceContext.git;
    if (!git) {
      return sql`
        json_type(${sql.attribute("workspaceContextJson")}, '$.git') IS NULL
      `;
    }

    if (git.kind === "unavailable") {
      // A current unavailable observation must never become a claim scope.
      return sql`1 = 0`;
    }

    return this.buildObservedGitMatch(git);
  }

  private buildObservedGitMatch(
    git: Extract<GitContext, { kind: "observed" }>,
  ): ReturnType<typeof sql> {
    const capturedGitKind = sql`json_extract(
      ${sql.attribute("workspaceContextJson")}, '$.git.kind'
    )`;
    const capturedBranchName = sql`json_extract(
      ${sql.attribute("workspaceContextJson")}, '$.git.branchName'
    )`;
    const capturedHeadCommitId = sql`json_extract(
      ${sql.attribute("workspaceContextJson")}, '$.git.headCommitId'
    )`;

    if (git.branchName !== null) {
      return sql`(
        ${capturedGitKind} = 'observed'
        AND ${capturedBranchName} = ${git.branchName}
      )`;
    }

    if (git.headCommitId === null) {
      return sql`(
        ${capturedGitKind} = 'observed'
        AND ${capturedBranchName} IS NULL
        AND ${capturedHeadCommitId} IS NULL
      )`;
    }

    return sql`(
      ${capturedGitKind} = 'observed'
      AND ${capturedBranchName} IS NULL
      AND ${capturedHeadCommitId} = ${git.headCommitId}
    )`;
  }

  private buildUnavailableGitMatch(): ReturnType<typeof sql> {
    return sql`
      json_extract(
        ${sql.attribute("workspaceContextJson")}, '$.git.kind'
      ) = 'unavailable'
    `;
  }

  private buildProcessingMatch(
    processing: EvidenceProcessingFilter,
  ): ReturnType<typeof sql> {
    switch (processing.kind) {
      case "unclaimed":
        return sql`NOT EXISTS (
          SELECT 1
          FROM evidence_processing_ledgers AS ledger
          WHERE ledger.evidence_id = ${sql.attribute("id")}
        )`;
      case "status":
        return sql`EXISTS (
          SELECT 1
          FROM evidence_processing_ledgers AS ledger
          WHERE ledger.evidence_id = ${sql.attribute("id")}
            AND ledger.status = ${processing.status}
        )`;
      case "eligible":
        return sql`NOT EXISTS (
          SELECT 1
          FROM evidence_processing_ledgers AS ledger
          WHERE ledger.evidence_id = ${sql.attribute("id")}
            AND (
              ledger.status = 'processed'
              OR (
                ledger.status = 'processing'
                AND ledger.lease_expires_at > ${processing.at}
              )
            )
        )`;
    }
  }
}
