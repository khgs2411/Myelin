import {
  DataTypes,
  Model,
  type CreationOptional,
  type InferAttributes,
  type InferCreationAttributes,
  type NonAttribute,
  type Sequelize,
} from "@sequelize/core";
import type { SqliteDialect } from "@sequelize/sqlite3";

import type { EvidenceItem } from "./evidence-item.model.ts";
import type { Project } from "./project.model.ts";
import type { SessionMemoryLifecycle } from "./session-memory-lifecycle.model.ts";

/**
 * Canonical Session entry contract. Persisted entries are immutable.
 * Evidence is loaded through the linking table, not stored as an array column.
 */
export class SessionMemoryEntry extends Model<
  InferAttributes<SessionMemoryEntry>,
  InferCreationAttributes<SessionMemoryEntry>
> {
  public declare id: CreationOptional<number>;
  public declare projectId: number;

  /** Non-empty memory text; the only semantic/vector search content. */
  public declare content: string;

  /** Latest supporting observation time in UTC ISO 8601, or null if unknown. */
  public declare observedAt: string | null;

  public declare project?: NonAttribute<Project>;
  public declare evidence?: NonAttribute<EvidenceItem[]>;
  public declare lifecycle?: NonAttribute<SessionMemoryLifecycle>;
}

export function initializeSessionMemoryEntryModel(
  sequelize: Sequelize<SqliteDialect>,
): void {
  SessionMemoryEntry.init(
    {
      id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
      projectId: {
        type: DataTypes.INTEGER,
        allowNull: false,
        columnName: "project_id",
        references: { table: "projects", key: "id" },
      },
      content: {
        type: DataTypes.TEXT,
        allowNull: false,
        validate: { notEmpty: true },
      },
      observedAt: {
        type: DataTypes.TEXT,
        allowNull: true,
        columnName: "observed_at",
      },
    },
    {
      sequelize,
      modelName: "SessionMemoryEntry",
      tableName: "session_memory_entries",
      timestamps: false,
      indexes: [{ name: "session_memory_entries_project", fields: ["project_id"] }],
    },
  );
}
