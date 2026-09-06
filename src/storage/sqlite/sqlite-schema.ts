import {
  QueryTypes,
  TransactionType,
  type Sequelize,
  type Transaction,
} from "@sequelize/core";
import type { SqliteDialect } from "@sequelize/sqlite3";

import {
  EvidenceItem,
  initializeEvidenceItemModel,
} from "./models/evidence-item.model.ts";
import {
  Project,
  initializeProjectModel,
} from "./models/project.model.ts";
import {
  SessionMemoryEntry,
  initializeSessionMemoryEntryModel,
} from "./models/session-memory-entry.model.ts";
import {
  SessionMemoryEvidence,
  initializeSessionMemoryEvidenceModel,
} from "./models/session-memory-evidence.model.ts";
import {
  SessionMemoryLifecycle,
  initializeSessionMemoryLifecycleModel,
} from "./models/session-memory-lifecycle.model.ts";

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
  {
    version: 3,
    name: "create-session-memory-relationships",
    async apply(sequelize, transaction) {
      // The deferred reverse FK requires a lifecycle row by commit. A writer
      // inserts entry, evidence links, then lifecycle in one transaction.
      const statements = [
        `CREATE TABLE session_memory_entries (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          project_id INTEGER NOT NULL REFERENCES projects(id),
          content TEXT NOT NULL CHECK (length(trim(content)) > 0),
          observed_at TEXT NULL,
          FOREIGN KEY (id) REFERENCES session_memory_lifecycles(entry_id)
            DEFERRABLE INITIALLY DEFERRED
        )`,
        `CREATE INDEX session_memory_entries_project
          ON session_memory_entries(project_id)`,
        `CREATE TABLE session_memory_evidence (
          entry_id INTEGER NOT NULL REFERENCES session_memory_entries(id),
          evidence_id INTEGER NOT NULL REFERENCES evidence_items(id),
          PRIMARY KEY (entry_id, evidence_id)
        )`,
        `CREATE INDEX session_memory_evidence_source
          ON session_memory_evidence(evidence_id, entry_id)`,
        `CREATE TABLE session_memory_lifecycles (
          entry_id INTEGER PRIMARY KEY REFERENCES session_memory_entries(id),
          state TEXT NOT NULL CHECK (state IN ('active', 'retired')),
          reason TEXT NULL,
          superseded_by_entry_id INTEGER NULL REFERENCES session_memory_entries(id),
          CHECK (
            (state = 'active' AND reason IS NULL AND superseded_by_entry_id IS NULL)
            OR (state = 'retired' AND reason IS NOT NULL AND (
              (reason = 'irrelevant' AND superseded_by_entry_id IS NULL)
              OR (reason = 'superseded' AND superseded_by_entry_id IS NOT NULL
                AND superseded_by_entry_id <> entry_id)
            ))
          )
        )`,
        `CREATE INDEX session_memory_lifecycles_superseding_entry
          ON session_memory_lifecycles(superseded_by_entry_id)`,
        // SQLite REPLACE may delete conflicts without firing DELETE triggers.
        // Reject replacement before it can change an existing durable identity.
        `CREATE TRIGGER session_memory_entries_reject_replace
          BEFORE INSERT ON session_memory_entries
          FOR EACH ROW
          WHEN EXISTS (SELECT 1 FROM session_memory_entries WHERE id = NEW.id)
          BEGIN
            SELECT RAISE(ABORT, 'Session memory is immutable.');
          END`,
        `CREATE TRIGGER evidence_items_reject_replace
          BEFORE INSERT ON evidence_items
          FOR EACH ROW
          WHEN EXISTS (SELECT 1 FROM evidence_items
            WHERE id = NEW.id
              OR (project_id = NEW.project_id AND project_sequence = NEW.project_sequence)
              OR (project_id = NEW.project_id AND capture_source_key = NEW.capture_source_key
                AND replay_scheme = NEW.replay_scheme AND replay_key = NEW.replay_key))
          BEGIN
            SELECT RAISE(ABORT, 'Captured evidence is immutable.');
          END`,
        `CREATE TRIGGER session_memory_evidence_same_project
          BEFORE INSERT ON session_memory_evidence
          FOR EACH ROW
          WHEN (SELECT project_id FROM session_memory_entries WHERE id = NEW.entry_id)
            <> (SELECT project_id FROM evidence_items WHERE id = NEW.evidence_id)
          BEGIN
            SELECT RAISE(ABORT, 'Session evidence must belong to the same Project.');
          END`,
        `CREATE TRIGGER session_memory_evidence_sealed
          BEFORE INSERT ON session_memory_evidence
          FOR EACH ROW
          WHEN EXISTS (SELECT 1 FROM session_memory_lifecycles WHERE entry_id = NEW.entry_id)
          BEGIN
            SELECT RAISE(ABORT, 'Published Session evidence membership is immutable.');
          END`,
        `CREATE TRIGGER session_memory_lifecycles_require_evidence
          BEFORE INSERT ON session_memory_lifecycles
          FOR EACH ROW
          WHEN NOT EXISTS (SELECT 1 FROM session_memory_evidence WHERE entry_id = NEW.entry_id)
          BEGIN
            SELECT RAISE(ABORT, 'Session memory requires supporting evidence.');
          END`,
        `CREATE TRIGGER session_memory_lifecycles_identity_immutable
          BEFORE UPDATE OF entry_id ON session_memory_lifecycles
          FOR EACH ROW
          WHEN NEW.entry_id <> OLD.entry_id
          BEGIN
            SELECT RAISE(ABORT, 'Session lifecycle identity is immutable.');
          END`,
        `CREATE TRIGGER session_memory_lifecycles_reject_delete
          BEFORE DELETE ON session_memory_lifecycles
          FOR EACH ROW
          BEGIN
            SELECT RAISE(ABORT, 'Retire Session memory instead of deleting its lifecycle.');
          END`,
      ];

      for (const statement of statements) {
        await sequelize.query(statement, { transaction });
      }

      for (const operation of ["INSERT", "UPDATE"] as const) {
        await sequelize.query(
          `CREATE TRIGGER session_memory_supersession_project_${operation.toLowerCase()}
          BEFORE ${operation} ON session_memory_lifecycles
          FOR EACH ROW
          WHEN NEW.superseded_by_entry_id IS NOT NULL AND
            (SELECT project_id FROM session_memory_entries WHERE id = NEW.entry_id)
            <> (SELECT project_id FROM session_memory_entries WHERE id = NEW.superseded_by_entry_id)
          BEGIN
            SELECT RAISE(ABORT, 'Superseding Session memory must belong to the same Project.');
          END`,
          { transaction },
        );
      }

      for (const table of ["session_memory_entries", "session_memory_evidence"] as const) {
        for (const operation of ["UPDATE", "DELETE"] as const) {
          await sequelize.query(
            `CREATE TRIGGER ${table}_reject_${operation.toLowerCase()}
            BEFORE ${operation} ON ${table}
            FOR EACH ROW
            BEGIN
              SELECT RAISE(ABORT, 'Session memory and its evidence membership are immutable.');
            END`,
            { transaction },
          );
        }
      }
    },
  },
];

export class SqliteSchema {
  public static initializeModels(sequelize: Sequelize<SqliteDialect>): void {
    initializeProjectModel(sequelize);
    initializeEvidenceItemModel(sequelize);
    initializeSessionMemoryEntryModel(sequelize);
    initializeSessionMemoryEvidenceModel(sequelize);
    initializeSessionMemoryLifecycleModel(sequelize);

    Project.hasMany(EvidenceItem, {
      as: "evidenceItems",
      inverse: "project",
      foreignKey: { name: "projectId", onDelete: "NO ACTION", onUpdate: "NO ACTION" },
    });
    Project.hasMany(SessionMemoryEntry, {
      as: "sessionEntries",
      inverse: "project",
      foreignKey: { name: "projectId", onDelete: "NO ACTION", onUpdate: "NO ACTION" },
    });
    SessionMemoryEntry.belongsToMany(EvidenceItem, {
      as: "evidence",
      inverse: "sessionEntries",
      through: { model: SessionMemoryEvidence, unique: false },
      foreignKey: { name: "entryId", onDelete: "NO ACTION", onUpdate: "NO ACTION" },
      otherKey: { name: "evidenceId", onDelete: "NO ACTION", onUpdate: "NO ACTION" },
      throughAssociations: {
        fromSource: "evidenceLinks",
        toSource: "entry",
        fromTarget: "sessionLinks",
        toTarget: "evidenceItem",
      },
    });
    SessionMemoryEntry.hasOne(SessionMemoryLifecycle, {
      as: "lifecycle",
      inverse: "entry",
      foreignKey: { name: "entryId", onDelete: "NO ACTION", onUpdate: "NO ACTION" },
    });
    SessionMemoryLifecycle.belongsTo(SessionMemoryEntry, {
      as: "supersededByEntry",
      foreignKey: {
        name: "supersededByEntryId",
        onDelete: "NO ACTION",
        onUpdate: "NO ACTION",
      },
    });
  }

  public static async ensureCurrent(
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
