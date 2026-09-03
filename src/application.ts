import { ProjectRegistrationRepository } from "./storage/sqlite/repositories/project-registration.repository.ts";
import { SqliteDatabase } from "./storage/sqlite/sqlite-database.ts";
import { SqliteRuntime } from "./storage/sqlite/sqlite-runtime.ts";
import type { WorkspaceContext } from "./workspace/workspace-context.ts";
import { WorkspaceContextService } from "./workspace/workspace-context.service.ts";

export type RuntimeApplicationConfiguration = Readonly<{
  sqlite: Readonly<{
    databasePath: string;
  }>;
  workingDirectory: string;
}>;

export class Application {
  private constructor(
    private readonly sqliteDatabase: SqliteDatabase,
    private readonly workspaceContext: WorkspaceContext,
  ) {}

  static async create(
    configuration: RuntimeApplicationConfiguration,
  ): Promise<Application> {
    const sqliteRuntime = await SqliteRuntime.initialize();
    const sqliteDatabase = await SqliteDatabase.open({
      databasePath: configuration.sqlite.databasePath,
      runtime: sqliteRuntime,
    });

    try {
      const projectRegistrationRepository =
        new ProjectRegistrationRepository();
      const workspaceContextService = new WorkspaceContextService(
        projectRegistrationRepository,
      );
      const resolution = await workspaceContextService.resolve({
        workingDirectory: configuration.workingDirectory,
      });

      if (resolution.kind === "unmanaged") {
        throw new Error(resolution.reason.safeDiagnostic);
      }
      if (resolution.kind === "failed") {
        throw new Error(resolution.failure.safeDiagnostic);
      }

      return new Application(sqliteDatabase, resolution.context);
    } catch (cause) {
      await sqliteDatabase.close().catch(() => undefined);
      throw cause;
    }
  }

  async close(): Promise<void> {
    await this.sqliteDatabase.close();
  }
}
