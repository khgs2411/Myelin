import { Database } from "bun:sqlite";

import { ApplicationError } from "../../src/application-error.ts";
import { Application } from "../../src/application.ts";
import { Project } from "../../src/storage/sqlite/models/project.model.ts";

export type IngestionProcessInput = Readonly<{
  databasePath: string;
  workspace: string;
}>;

let application: Application | undefined;

try {
  const input = JSON.parse(await Bun.stdin.text()) as IngestionProcessInput;
  application = await Application.create({
    sqlite: { databasePath: input.databasePath },
    evidenceIngestion: { batchSize: 2 },
    agents: {
      evidenceCurator: { provider: "development.no-op", model: "no-op" },
      memoryReviewer: {
        provider: "development.unimplemented",
        model: "not-implemented",
      },
    },
  });

  await Project.create({
    key: "ingestion-project",
    rootPath: input.workspace,
    repositoryRootPath: null,
  });
  const receipt = await application.capture({
    sourceKey: "development.fixture",
    nativeInputs: [
      {
        fixtureReference: "ingestion-fixture",
        itemIndex: 0,
        workingDirectory: input.workspace,
        content: "stored evidence",
        speakerRole: "user",
      },
    ],
  });

  let ingestionErrorCode: string | null = null;
  try {
    await application.ingest({
      workingDirectory: input.workspace,
      captureSourceKey: "development.fixture",
    });
  } catch (cause) {
    ingestionErrorCode =
      cause instanceof ApplicationError ? cause.code : "unexpected-error";
  }

  await application.close();
  application = undefined;

  const sql = new Database(input.databasePath, { readonly: true, strict: true });
  try {
    const evidenceCount = sql
      .query<{ count: number }, []>(
        "SELECT COUNT(*) AS count FROM evidence_items",
      )
      .get()!.count;
    const claimCount = sql
      .query<{ count: number }, []>(
        "SELECT COUNT(*) AS count FROM evidence_processing_ledgers",
      )
      .get()!.count;
    process.stdout.write(
      JSON.stringify({
        receiptCount: receipt.length,
        ingestionErrorCode,
        evidenceCount,
        claimCount,
      }),
    );
  } finally {
    sql.close();
  }
} catch (cause) {
  const message = cause instanceof Error ? cause.message : "Unknown failure";
  process.stderr.write(`${message}\n`);
  process.exitCode = 1;
} finally {
  await application?.close().catch(() => undefined);
}
