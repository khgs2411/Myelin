import {
  DataTypes,
  Model,
  type InferAttributes,
  type InferCreationAttributes,
  type NonAttribute,
  type Sequelize,
} from "@sequelize/core";
import type { SqliteDialect } from "@sequelize/sqlite3";

import type { EvidenceItem } from "./evidence-item.model.ts";

export type EvidenceProcessingLedgerStatus =
  | "processing"
  | "void"
  | "processed";

export class EvidenceProcessingLedger extends Model<
  InferAttributes<EvidenceProcessingLedger>,
  InferCreationAttributes<EvidenceProcessingLedger>
> {
  public declare evidenceId: number;
  public declare status: EvidenceProcessingLedgerStatus;
  public declare attemptId: string;
  public declare leaseExpiresAt: string | null;
  public declare evidenceItem?: NonAttribute<EvidenceItem>;
}

export function initializeEvidenceProcessingLedgerModel(
  sequelize: Sequelize<SqliteDialect>,
): void {
  EvidenceProcessingLedger.init(
    {
      evidenceId: {
        type: DataTypes.INTEGER,
        primaryKey: true,
        allowNull: false,
        columnName: "evidence_id",
        references: { table: "evidence_items", key: "id" },
      },
      status: {
        type: DataTypes.TEXT,
        allowNull: false,
        validate: { isIn: [["processing", "void", "processed"]] },
      },
      attemptId: {
        type: DataTypes.TEXT,
        allowNull: false,
        columnName: "attempt_id",
        validate: { notEmpty: true },
      },
      leaseExpiresAt: {
        type: DataTypes.TEXT,
        allowNull: true,
        columnName: "lease_expires_at",
      },
    },
    {
      sequelize,
      modelName: "EvidenceProcessingLedger",
      tableName: "evidence_processing_ledgers",
      timestamps: false,
      indexes: [
        {
          name: "evidence_processing_ledgers_status_lease",
          fields: ["status", "lease_expires_at"],
        },
      ],
    },
  );
}
