import {
  QueryTypes,
  Sequelize,
  TransactionType,
  type Transaction,
} from "@sequelize/core";
import { SqliteDialect, type SqliteConnection } from "@sequelize/sqlite3";

import type { InitializedSqliteRuntime } from "./sqlite-runtime.ts";

export type SqliteDatabaseConfiguration = Readonly<{
  databasePath: string;
  runtime: InitializedSqliteRuntime;
}>;

export class SqliteDatabase {
  private constructor(private readonly sequelize: Sequelize<SqliteDialect>) {}

  static async open(
    configuration: SqliteDatabaseConfiguration,
  ): Promise<SqliteDatabase> {
    const sequelize = new Sequelize({
      dialect: SqliteDialect,
      logging: false,
      sqlite3Module: configuration.runtime.sqlite3Module,
      storage: configuration.databasePath,
    });

    sequelize.hooks.addListener("afterConnect", async (connection) => {
      await configuration.runtime.initializeConnection(
        connection as SqliteConnection,
      );
    });

    try {
      await sequelize.authenticate();
      await verifyCapabilities(sequelize);
      return new SqliteDatabase(sequelize);
    } catch (cause) {
      await sequelize.close().catch(() => undefined);
      throw new Error("Unable to initialize the SQLite database.", { cause });
    }
  }

  async writeTransaction<T>(
    operation: (transaction: Transaction) => Promise<T>,
  ): Promise<T> {
    return await this.sequelize.transaction(
      { type: TransactionType.IMMEDIATE },
      operation,
    );
  }

  async close(): Promise<void> {
    await this.sequelize.close();
  }
}

async function verifyCapabilities(
  sequelize: Sequelize<SqliteDialect>,
): Promise<void> {
  const [foreignKeys] = await sequelize.query<{ foreign_keys: number }>(
    "PRAGMA foreign_keys",
    { type: QueryTypes.SELECT },
  );
  if (foreignKeys?.foreign_keys !== 1) {
    throw new Error("SQLite foreign-key enforcement is unavailable.");
  }

  const [fts5] = await sequelize.query<{ enabled: number }>(
    "SELECT sqlite_compileoption_used('ENABLE_FTS5') AS enabled",
    { type: QueryTypes.SELECT },
  );
  if (fts5?.enabled !== 1) {
    throw new Error("SQLite FTS5 is unavailable.");
  }

  const [sqliteVec] = await sequelize.query<{ version: string }>(
    "SELECT vec_version() AS version",
    { type: QueryTypes.SELECT },
  );
  if (!sqliteVec?.version) {
    throw new Error("sqlite-vec is unavailable.");
  }
}
