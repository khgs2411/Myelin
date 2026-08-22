import { SqliteDatabase } from "./storage/sqlite/sqlite-database.ts";
import { SqliteRuntime } from "./storage/sqlite/sqlite-runtime.ts";

export type RuntimeApplicationConfiguration = Readonly<{
  sqlite: Readonly<{
    databasePath: string;
  }>;
}>;

export class Application {
  private constructor(private readonly sqliteDatabase: SqliteDatabase) {}

  static async create(
    configuration: RuntimeApplicationConfiguration,
  ): Promise<Application> {
    const sqliteRuntime = await SqliteRuntime.initialize();
    const sqliteDatabase = await SqliteDatabase.open({
      databasePath: configuration.sqlite.databasePath,
      runtime: sqliteRuntime,
    });

    return new Application(sqliteDatabase);
  }

  async close(): Promise<void> {
    await this.sqliteDatabase.close();
  }
}
