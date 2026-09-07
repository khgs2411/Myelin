import { type Transaction } from "@sequelize/core";

import { EvidenceProcessingLedger } from "../storage/sqlite/models/evidence-processing-ledger.model.ts";

export class EvidenceLedgerRepository {
  public async ClaimEvidence(
    evidenceIds: readonly number[],
    attemptId: string,
    leaseExpiresAt: string,
    transaction: Transaction,
  ): Promise<void> {
    const ids = [...evidenceIds];
    if (ids.length === 0) {
      return;
    }

    await EvidenceProcessingLedger.bulkCreate(
      ids.map((evidenceId) => ({
        evidenceId,
        status: "processing" as const,
        attemptId,
        leaseExpiresAt,
      })),
      {
        transaction,
        updateOnDuplicate: ["status", "attemptId", "leaseExpiresAt"],
      },
    );
  }

  public async VerifyOwnership(
    evidenceIds: readonly number[],
    attemptId: string,
    transaction: Transaction,
  ): Promise<boolean> {
    const ids = [...evidenceIds];
    if (ids.length === 0) {
      return true;
    }

    const ownedRows = await EvidenceProcessingLedger.findAll({
      attributes: ["evidenceId"],
      where: {
        evidenceId: ids,
        status: "processing",
        attemptId,
      },
      transaction,
    });

    return ownedRows.length === ids.length;
  }

  public async CompleteEvidence(
    evidenceIds: readonly number[],
    attemptId: string,
    transaction: Transaction,
  ): Promise<void> {
    const ids = [...evidenceIds];
    if (ids.length === 0) {
      return;
    }

    const [updatedRows] = await EvidenceProcessingLedger.update(
      {
        status: "processed",
        leaseExpiresAt: null,
      },
      {
        where: {
          evidenceId: ids,
          status: "processing",
          attemptId,
        },
        transaction,
      },
    );

    if (updatedRows !== ids.length) {
      throw new Error(
        "Evidence processing ownership changed before completion.",
      );
    }
  }

  public async ReleaseEvidence(
    evidenceIds: readonly number[],
    attemptId: string,
    transaction: Transaction,
  ): Promise<void> {
    const ids = [...evidenceIds];
    if (ids.length === 0) {
      return;
    }

    await EvidenceProcessingLedger.update(
      {
        status: "void",
        leaseExpiresAt: null,
      },
      {
        where: {
          evidenceId: ids,
          status: "processing",
          attemptId,
        },
        transaction,
      },
    );
  }

  public async RenewEvidence(
    evidenceIds: readonly number[],
    attemptId: string,
    leaseExpiresAt: string,
    transaction: Transaction,
  ): Promise<void> {
    const ids = [...evidenceIds];
    if (ids.length === 0) {
      return;
    }

    const [updatedRows] = await EvidenceProcessingLedger.update(
      { leaseExpiresAt },
      {
        where: {
          evidenceId: ids,
          status: "processing",
          attemptId,
        },
        transaction,
      },
    );

    if (updatedRows !== ids.length) {
      throw new Error("Evidence processing ownership changed before renewal.");
    }
  }
}
