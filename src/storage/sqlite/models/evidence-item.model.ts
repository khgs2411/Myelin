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

import type { Project } from "./project.model.ts";
import type { SessionMemoryEntry } from "./session-memory-entry.model.ts";

export class EvidenceItem extends Model<
  InferAttributes<EvidenceItem>,
  InferCreationAttributes<EvidenceItem>
> {
  public declare id: CreationOptional<number>;
  public declare projectId: number;
  public declare projectSequence: number;
  public declare captureSourceKey: string;
  public declare nativeEventKind: string;
  public declare nativeSessionReference: string | null;
  public declare nativeInteractionReference: string | null;
  public declare nativeOccurredAt: string | null;
  public declare normalizedContent: string | null;
  public declare workingDirectory: string;
  public declare workspaceContextJson: string;
  public declare rawSourceFormat: string;
  public declare rawSourceContent: Buffer;
  public declare rawSourceDigest: string;
  public declare replayScheme: string;
  public declare replayKey: string;
  public declare receivedAt: string;
  public declare project?: NonAttribute<Project>;
  public declare sessionEntries?: NonAttribute<SessionMemoryEntry[]>;
}

export function initializeEvidenceItemModel(
  sequelize: Sequelize<SqliteDialect>,
): void {
  EvidenceItem.init(
    {
      id: {
        type: DataTypes.INTEGER,
        primaryKey: true,
        autoIncrement: true,
      },
      projectId: {
        type: DataTypes.INTEGER,
        allowNull: false,
        columnName: "project_id",
        references: { table: "projects", key: "id" },
      },
      projectSequence: {
        type: DataTypes.INTEGER,
        allowNull: false,
        columnName: "project_sequence",
      },
      captureSourceKey: {
        type: DataTypes.TEXT,
        allowNull: false,
        columnName: "capture_source_key",
      },
      nativeEventKind: {
        type: DataTypes.TEXT,
        allowNull: false,
        columnName: "native_event_kind",
      },
      nativeSessionReference: {
        type: DataTypes.TEXT,
        allowNull: true,
        columnName: "native_session_reference",
      },
      nativeInteractionReference: {
        type: DataTypes.TEXT,
        allowNull: true,
        columnName: "native_interaction_reference",
      },
      nativeOccurredAt: {
        type: DataTypes.TEXT,
        allowNull: true,
        columnName: "native_occurred_at",
      },
      normalizedContent: {
        type: DataTypes.TEXT,
        allowNull: true,
        columnName: "normalized_content",
      },
      workingDirectory: {
        type: DataTypes.TEXT,
        allowNull: false,
        columnName: "working_directory",
      },
      workspaceContextJson: {
        type: DataTypes.TEXT,
        allowNull: false,
        columnName: "workspace_context_json",
      },
      rawSourceFormat: {
        type: DataTypes.TEXT,
        allowNull: false,
        columnName: "raw_source_format",
      },
      rawSourceContent: {
        type: DataTypes.BLOB,
        allowNull: false,
        columnName: "raw_source_content",
      },
      rawSourceDigest: {
        type: DataTypes.TEXT,
        allowNull: false,
        columnName: "raw_source_digest",
      },
      replayScheme: {
        type: DataTypes.TEXT,
        allowNull: false,
        columnName: "replay_scheme",
      },
      replayKey: {
        type: DataTypes.TEXT,
        allowNull: false,
        columnName: "replay_key",
      },
      receivedAt: {
        type: DataTypes.TEXT,
        allowNull: false,
        columnName: "received_at",
      },
    },
    {
      sequelize,
      modelName: "EvidenceItem",
      tableName: "evidence_items",
      timestamps: false,
      indexes: [
        {
          name: "evidence_items_project_sequence",
          unique: true,
          fields: ["project_id", "project_sequence"],
        },
        {
          name: "evidence_items_replay_identity",
          unique: true,
          fields: ["capture_source_key", "project_id", "replay_scheme", "replay_key"],
        },
      ],
    },
  );
}
