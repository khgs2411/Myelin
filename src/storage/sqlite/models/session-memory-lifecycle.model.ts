import {
  DataTypes,
  Model,
  type InferAttributes,
  type InferCreationAttributes,
  type NonAttribute,
  type Sequelize,
} from "@sequelize/core";
import type { SqliteDialect } from "@sequelize/sqlite3";

import type { SessionMemoryEntry } from "./session-memory-entry.model.ts";

/**
 * Mutable current lifecycle, with one row per immutable Session entry.
 * SQLite enforces the entry link and admitted retirement combinations.
 */
export class SessionMemoryLifecycle extends Model<
  InferAttributes<SessionMemoryLifecycle>,
  InferCreationAttributes<SessionMemoryLifecycle>
> {
  public declare entryId: number;
  public declare state: "active" | "retired";

  /**
   * Null while active; required when retired.
   * Promotion remains unavailable until durable publication can be validated.
   */
  public declare reason: "superseded" | "irrelevant" | "promoted" | null;

  /** Required for supersession; null for active entries and other reasons. */
  public declare supersededByEntryId: number | null;

  public declare entry?: NonAttribute<SessionMemoryEntry>;
  public declare supersededByEntry?: NonAttribute<SessionMemoryEntry>;
}

export function initializeSessionMemoryLifecycleModel(
  sequelize: Sequelize<SqliteDialect>,
): void {
  SessionMemoryLifecycle.init(
    {
      entryId: {
        type: DataTypes.INTEGER,
        primaryKey: true,
        allowNull: false,
        columnName: "entry_id",
        references: { table: "session_memory_entries", key: "id" },
      },
      state: {
        type: DataTypes.TEXT,
        allowNull: false,
        validate: { isIn: [["active", "retired"]] },
      },
      reason: {
        type: DataTypes.TEXT,
        allowNull: true,
        // Promotion cannot be admitted until its publication contract exists.
        validate: { isIn: [["superseded", "irrelevant"]] },
      },
      supersededByEntryId: {
        type: DataTypes.INTEGER,
        allowNull: true,
        columnName: "superseded_by_entry_id",
        references: { table: "session_memory_entries", key: "id" },
      },
    },
    {
      sequelize,
      modelName: "SessionMemoryLifecycle",
      tableName: "session_memory_lifecycles",
      timestamps: false,
      indexes: [{
        name: "session_memory_lifecycles_superseding_entry",
        fields: ["superseded_by_entry_id"],
      }],
    },
  );
}
