import { ApplicationError } from "./application-error.ts";
import { CaptureAdapterFactory } from "./capture/capture-adapter.factory.ts";
import type { TrustedCaptureInput } from "./capture/capture-input.ts";
import { EvidenceCaptureService } from "./capture/evidence-capture.service.ts";
import type { CapturedEvidenceReference } from "./evidence/captured-evidence-reference.ts";
import { EvidenceItemRepository } from "./evidence/evidence-item.repository.ts";
import { ProjectRegistrationRepository } from "./storage/sqlite/repositories/project-registration.repository.ts";
import { SqliteDatabase } from "./storage/sqlite/sqlite-database.ts";
import { SqliteRuntime } from "./storage/sqlite/sqlite-runtime.ts";
import { WorkspaceContextService } from "./workspace/workspace-context.service.ts";

export type RuntimeApplicationConfiguration = Readonly<{
  sqlite: Readonly<{
    databasePath: string;
  }>;
  // Accepted for existing callers; capture resolves directories from its input.
  workingDirectory?: string;
}>;

export class Application {
  private constructor(private readonly sqliteDatabase: SqliteDatabase) {}

  public static async create(
    configuration: RuntimeApplicationConfiguration,
  ): Promise<Application> {
    const sqliteRuntime = await SqliteRuntime.initialize();
    const sqliteDatabase = await SqliteDatabase.open({
      databasePath: configuration.sqlite.databasePath,
      runtime: sqliteRuntime,
    });

    return new Application(sqliteDatabase);
  }

  public async capture(
    input: TrustedCaptureInput,
  ): Promise<readonly CapturedEvidenceReference[]> {
    try {
      if (!Array.isArray(input.nativeInputs) || input.nativeInputs.length === 0) {
        throw new ApplicationError("capture:invalid-input");
      }

      const adapter = new CaptureAdapterFactory().create(input.sourceKey);
      const results = input.nativeInputs.map((nativeInput: unknown) =>
        adapter.normalize(nativeInput),
      );
      const workspaceContextService = new WorkspaceContextService(
        new ProjectRegistrationRepository(),
      );
      const evidenceItemRepository = new EvidenceItemRepository(
        this.sqliteDatabase,
      );
      const evidenceCaptureService = new EvidenceCaptureService(
        workspaceContextService,
        evidenceItemRepository,
      );
      return await evidenceCaptureService.captureBatch({
        sourceKey: input.sourceKey,
        results,
      });
    } catch (cause) {
      if (
        cause instanceof ApplicationError &&
        cause.code.startsWith("capture:")
      ) {
        throw cause;
      }
      throw new ApplicationError("capture:failed", { cause });
    }
  }

  public async close(): Promise<void> {
    await this.sqliteDatabase.close();
  }
}
