import { createHash } from "node:crypto";

import { ApplicationError } from "../application-error.ts";
import { EvidenceItem } from "../storage/sqlite/models/evidence-item.model.ts";
import { Project } from "../storage/sqlite/models/project.model.ts";
import type { SqliteDatabase } from "../storage/sqlite/sqlite-database.ts";
import type { CapturedEvidenceReference } from "./captured-evidence-reference.ts";
import type { EvidenceItemDto } from "./evidence-item.dto.ts";

export interface IEvidenceItemRepository {
  insertBatch(
    items: readonly EvidenceItemDto[],
  ): Promise<readonly CapturedEvidenceReference[]>;
}

export class EvidenceItemRepository implements IEvidenceItemRepository {
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
}
