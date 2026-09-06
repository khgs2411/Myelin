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
import type { SessionMemoryEntry } from "./session-memory-entry.model.ts";

export const PROJECT_KEY_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
export const PROJECT_KEY_MAX_LENGTH = 64;

export class Project extends Model<
  InferAttributes<Project>,
  InferCreationAttributes<Project>
> {
  public declare id: CreationOptional<number>;
  public declare key: string;
  public declare rootPath: string;
  public declare repositoryRootPath: string | null;
  public declare lastAllocatedEvidenceSequence: CreationOptional<number>;
  public declare evidenceItems?: NonAttribute<EvidenceItem[]>;
  public declare sessionEntries?: NonAttribute<SessionMemoryEntry[]>;
}

export function initializeProjectModel(
  sequelize: Sequelize<SqliteDialect>,
): void {
  Project.init(
    {
      id: {
        type: DataTypes.INTEGER,
        primaryKey: true,
        autoIncrement: true,
      },
      key: {
        type: DataTypes.TEXT,
        allowNull: false,
        unique: true,
        validate: {
          is: PROJECT_KEY_PATTERN,
          len: [1, PROJECT_KEY_MAX_LENGTH],
        },
      },
      rootPath: {
        type: DataTypes.TEXT,
        allowNull: false,
        unique: true,
        columnName: "root_path",
      },
      repositoryRootPath: {
        type: DataTypes.TEXT,
        allowNull: true,
        columnName: "repository_root_path",
      },
      lastAllocatedEvidenceSequence: {
        type: DataTypes.INTEGER,
        allowNull: false,
        defaultValue: 0,
        columnName: "last_allocated_evidence_sequence",
        validate: {
          min: 0,
        },
      },
    },
    {
      sequelize,
      modelName: "Project",
      tableName: "projects",
      timestamps: false,
    },
  );
}
