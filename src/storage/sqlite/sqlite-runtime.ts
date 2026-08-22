import type { Sqlite3Module, SqliteConnection } from "@sequelize/sqlite3";
import * as sqliteVec from "sqlite-vec";
import * as sqlite3 from "sqlite3";

const SUPPORTED_BUN_RELEASE = "1.4";

export type InitializedSqliteRuntime = Readonly<{
  bunVersion: string;
  sqlite3Module: Sqlite3Module;
  sqliteVecExtensionPath: string;
  initializeConnection(connection: SqliteConnection): Promise<void>;
}>;

export class SqliteRuntime {
  static async initialize(): Promise<InitializedSqliteRuntime> {
    if (!Bun.version.startsWith(`${SUPPORTED_BUN_RELEASE}.`)) {
      throw new Error(
        `Unsupported Bun runtime ${Bun.version}. Expected Bun ${SUPPORTED_BUN_RELEASE}.x.`,
      );
    }

    const sqliteVecExtensionPath = sqliteVec.getLoadablePath();
    if (!(await Bun.file(sqliteVecExtensionPath).exists())) {
      throw new Error("The packaged sqlite-vec extension is unavailable.");
    }

    return {
      bunVersion: Bun.version,
      sqlite3Module: sqlite3,
      sqliteVecExtensionPath,
      async initializeConnection(connection) {
        await run(connection, "PRAGMA foreign_keys = ON");
        await loadExtension(connection, sqliteVecExtensionPath);
      },
    };
  }
}

function run(connection: SqliteConnection, sql: string): Promise<void> {
  return new Promise((resolve, reject) => {
    connection.run(sql, (error) => {
      if (error) {
        reject(error);
        return;
      }

      resolve();
    });
  });
}

function loadExtension(
  connection: SqliteConnection,
  extensionPath: string,
): Promise<void> {
  return new Promise((resolve, reject) => {
    connection.loadExtension(extensionPath, (error) => {
      if (error) {
        reject(error);
        return;
      }

      resolve();
    });
  });
}
