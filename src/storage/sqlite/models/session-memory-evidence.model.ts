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
import type { SessionMemoryEntry } from "./session-memory-entry.model.ts";

/** Immutable evidence membership, sealed when the entry's lifecycle is created. */
export class SessionMemoryEvidence extends Model<
  InferAttributes<SessionMemoryEvidence>,
  InferCreationAttributes<SessionMemoryEvidence>
> {
  public declare entryId: number;
  public declare evidenceId: number;

  public declare entry?: NonAttribute<SessionMemoryEntry>;
  public declare evidenceItem?: NonAttribute<EvidenceItem>;
}

export function initializeSessionMemoryEvidenceModel(
  sequelize: Sequelize<SqliteDialect>,
): void {
  SessionMemoryEvidence.init(
    {
      entryId: {
        type: DataTypes.INTEGER,
        primaryKey: true,
        allowNull: false,
        columnName: "entry_id",
        references: { table: "session_memory_entries", key: "id" },
      },
      evidenceId: {
        type: DataTypes.INTEGER,
        primaryKey: true,
        allowNull: false,
        columnName: "evidence_id",
        references: { table: "evidence_items", key: "id" },
      },
    },
    {
      sequelize,
      modelName: "SessionMemoryEvidence",
      tableName: "session_memory_evidence",
      timestamps: false,
      indexes: [{ name: "session_memory_evidence_source", fields: ["evidence_id", "entry_id"] }],
    },
  );
}
