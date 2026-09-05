import {
  QueryTypes,
  TransactionType,
  type Sequelize,
  type Transaction,
} from "@sequelize/core";
import type { SqliteDialect } from "@sequelize/sqlite3";

import { initializeEvidenceItemModel } from "./models/evidence-item.model.ts";
import { initializeProjectModel } from "./models/project.model.ts";

type AppliedMigration = Readonly<{
  version: number;
  name: string;
}>;

type SqliteMigration = Readonly<{
  version: number;
  name: string;
  apply(
    sequelize: Sequelize<SqliteDialect>,
    transaction: Transaction,
  ): Promise<void>;
}>;

const ORDERED_MIGRATIONS: readonly SqliteMigration[] = [
  {
    version: 1,
    name: "create-projects",
    async apply(sequelize, transaction) {
      await sequelize.query(
        `CREATE TABLE projects (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          key TEXT NOT NULL UNIQUE,
          root_path TEXT NOT NULL UNIQUE,
          repository_root_path TEXT NULL,
          last_allocated_evidence_sequence INTEGER NOT NULL DEFAULT 0
            CHECK (last_allocated_evidence_sequence >= 0)
        )`,
        { transaction },
      );

      await sequelize.query(
        `CREATE TRIGGER projects_key_immutable
        BEFORE UPDATE OF key ON projects
        FOR EACH ROW
        WHEN NEW.key <> OLD.key
        BEGIN
          SELECT RAISE(ABORT, 'Project key is immutable.');
        END`,
        { transaction },
      );
    },
  },
  {
    version: 2,
    name: "create-evidence-items",
    async apply(sequelize, transaction) {
      await sequelize.query(
        `CREATE TABLE evidence_items (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          project_id INTEGER NOT NULL REFERENCES projects(id),
          project_sequence INTEGER NOT NULL CHECK (project_sequence > 0),
          capture_source_key TEXT NOT NULL,
          native_event_kind TEXT NOT NULL,
          native_session_reference TEXT NULL,
          native_interaction_reference TEXT NULL,
          native_occurred_at TEXT NULL,
          normalized_content TEXT NULL,
          working_directory TEXT NOT NULL,
          workspace_context_json TEXT NOT NULL,
          raw_source_format TEXT NOT NULL,
          raw_source_content BLOB NOT NULL,
          raw_source_digest TEXT NOT NULL,
          replay_scheme TEXT NOT NULL,
          replay_key TEXT NOT NULL,
          received_at TEXT NOT NULL
        )`,
        { transaction },
      );

      await sequelize.query(
        `CREATE UNIQUE INDEX evidence_items_project_sequence
        ON evidence_items (project_id, project_sequence)`,
        { transaction },
      );
      await sequelize.query(
        `CREATE UNIQUE INDEX evidence_items_replay_identity
        ON evidence_items (capture_source_key, project_id, replay_scheme, replay_key)`,
        { transaction },
      );

      for (const operation of ["UPDATE", "DELETE"] as const) {
        await sequelize.query(
          `CREATE TRIGGER evidence_items_reject_${operation.toLowerCase()}
          BEFORE ${operation} ON evidence_items
          FOR EACH ROW
          BEGIN
            SELECT RAISE(ABORT, 'Captured evidence is immutable.');
          END`,
          { transaction },
        );
      }
    },
  },
];

export class SqliteSchema {
  static initializeModels(sequelize: Sequelize<SqliteDialect>): void {
    initializeProjectModel(sequelize);
    initializeEvidenceItemModel(sequelize);
  }

  static async ensureCurrent(
    sequelize: Sequelize<SqliteDialect>,
  ): Promise<void> {
    await sequelize.transaction(
      { type: TransactionType.IMMEDIATE },
      async (transaction) => {
        await sequelize.query(
          `CREATE TABLE IF NOT EXISTS schema_migrations (
            version INTEGER PRIMARY KEY,
            name TEXT NOT NULL,
            applied_at TEXT NOT NULL
          )`,
          { transaction },
        );

        const appliedMigrations = await sequelize.query<AppliedMigration>(
          `SELECT version, name
          FROM schema_migrations
          ORDER BY version ASC`,
          {
            type: QueryTypes.SELECT,
            transaction,
          },
        );

        requireKnownMigrationPrefix(appliedMigrations);

        for (const migration of ORDERED_MIGRATIONS.slice(
          appliedMigrations.length,
        )) {
          await migration.apply(sequelize, transaction);
          await sequelize.query(
            `INSERT INTO schema_migrations (version, name, applied_at)
            VALUES (:version, :name, :appliedAt)`,
            {
              replacements: {
                version: migration.version,
                name: migration.name,
                appliedAt: new Date().toISOString(),
              },
              transaction,
            },
          );
        }
      },
    );
  }
}

function requireKnownMigrationPrefix(
  appliedMigrations: readonly AppliedMigration[],
): void {
  for (const [index, applied] of appliedMigrations.entries()) {
    const expected = ORDERED_MIGRATIONS[index];
    if (
      !expected ||
      applied.version !== expected.version ||
      applied.name !== expected.name
    ) {
      throw new Error("The SQLite schema version is incompatible.");
    }
  }
}
