import { ApplicationError } from "./application-error.ts";
import type { IApplicationConfiguration } from "./application.configuration.ts";
import { CaptureAdapterFactory } from "./capture/capture-adapter.factory.ts";
import type { TrustedCaptureInput } from "./capture/capture-input.ts";
import { EvidenceCaptureService } from "./capture/evidence-capture.service.ts";
import type { CapturedEvidenceReference } from "./evidence/captured-evidence-reference.ts";
import { EvidenceLedgerRepository } from "./evidence/evidence-ledger.repository.ts";
import { EvidenceItemRepository } from "./evidence/evidence-item.repository.ts";
import { EvidenceManager } from "./evidence/evidence-manager.ts";
import { CuratorExecutorFactory } from "./evidence-ingestion/curator.executor-factory.ts";
import { EvidenceIngestionService } from "./evidence-ingestion/evidence-ingestion.service.ts";
import type {
  IEvidenceIngestionRequest,
  IEvidenceIngestionResult,
} from "./evidence-ingestion/evidence-ingestion.types.ts";
import { SessionMemoryManager } from "./session-memory/session-memory-manager.ts";
import { SessionMemoryRepository } from "./session-memory/session-memory.repository.ts";
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

type ApplicationConfiguration =
  | RuntimeApplicationConfiguration
  | IApplicationConfiguration;

type EvidenceIngestionConfiguration = Readonly<{
  evidenceIngestion: IApplicationConfiguration["evidenceIngestion"];
  agents: Pick<IApplicationConfiguration["agents"], "evidenceCurator">;
}>;

export class Application {
  private constructor(
    private readonly sqliteDatabase: SqliteDatabase,
    private readonly captureAdapterFactory: CaptureAdapterFactory,
    private readonly evidenceCaptureService: EvidenceCaptureService,
    private readonly evidenceIngestionServiceFactory:
      | (() => EvidenceIngestionService)
      | undefined,
  ) {}

  public static async create(
    configuration: ApplicationConfiguration,
  ): Promise<Application> {
    const ingestionConfiguration = getEvidenceIngestionConfiguration(
      configuration,
    );

    const sqliteRuntime = await SqliteRuntime.initialize();
    const sqliteDatabase = await SqliteDatabase.open({
      databasePath: configuration.sqlite.databasePath,
      runtime: sqliteRuntime,
    });

    try {
      const projectRegistrationRepository = new ProjectRegistrationRepository();
      const workspaceContextService = new WorkspaceContextService(
        projectRegistrationRepository,
      );
      const evidenceItemRepository = new EvidenceItemRepository(sqliteDatabase);
      const evidenceLedgerRepository = new EvidenceLedgerRepository();
      const evidenceManager = new EvidenceManager(
        sqliteDatabase,
        evidenceItemRepository,
        evidenceLedgerRepository,
      );
      const evidenceCaptureService = new EvidenceCaptureService(
        workspaceContextService,
        evidenceManager,
      );

      const evidenceIngestionServiceFactory = ingestionConfiguration
        ? () =>
            new EvidenceIngestionService(
              workspaceContextService,
              evidenceManager,
              new SessionMemoryManager(new SessionMemoryRepository()),
              sqliteDatabase,
              ingestionConfiguration,
              new CuratorExecutorFactory().Create(
                ingestionConfiguration.agents.evidenceCurator,
              ),
            )
        : undefined;

      return new Application(
        sqliteDatabase,
        new CaptureAdapterFactory(),
        evidenceCaptureService,
        evidenceIngestionServiceFactory,
      );
    } catch (cause) {
      await sqliteDatabase.close().catch(() => undefined);
      throw cause;
    }
  }

  public async capture(
    input: TrustedCaptureInput,
  ): Promise<readonly CapturedEvidenceReference[]> {
    try {
      if (!Array.isArray(input.nativeInputs) || input.nativeInputs.length === 0) {
        throw new ApplicationError("capture:invalid-input");
      }

      const adapter = this.captureAdapterFactory.create(input.sourceKey);
      const results = input.nativeInputs.map((nativeInput: unknown) =>
        adapter.normalize(nativeInput),
      );
      return await this.evidenceCaptureService.captureBatch({
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

  public async ingest(
    request: IEvidenceIngestionRequest,
  ): Promise<IEvidenceIngestionResult> {
    if (!this.evidenceIngestionServiceFactory) {
      throw new ApplicationError("ingestion:configuration-unavailable");
    }

    const evidenceIngestionService = this.evidenceIngestionServiceFactory();
    return await evidenceIngestionService.Ingest(request);
  }

  public async close(): Promise<void> {
    await this.sqliteDatabase.close();
  }
}

function getEvidenceIngestionConfiguration(
  configuration: ApplicationConfiguration,
): EvidenceIngestionConfiguration | undefined {
  if (!("evidenceIngestion" in configuration) || !("agents" in configuration)) {
    return undefined;
  }

  return {
    evidenceIngestion: configuration.evidenceIngestion,
    agents: {
      evidenceCurator: configuration.agents.evidenceCurator,
    },
  };
}
