#!/usr/bin/env bun

import {
  Application,
  type RuntimeApplicationConfiguration,
} from "./src/application.ts";
import { ApplicationError } from "./src/application-error.ts";
import { readDevelopmentCaptureFixture } from "./src/development/capture-fixture.ts";
import type { CapturedEvidenceReference } from "./src/evidence/captured-evidence-reference.ts";

const LOCAL_DATABASE_PATH =
  "/Users/liadgoren/Repositories/llm-wiki/.llm-wiki-dev/state.sqlite";

const ROOT_HELP = `LLM Wiki local prototype

Usage:
  bun run cli.ts [command]

Commands:
  dev capture-fixture <fixture-file>  Capture an ordered JSON array as evidence.
`;

export async function runCli(
  args: readonly string[],
  configuration: RuntimeApplicationConfiguration = {
    sqlite: { databasePath: LOCAL_DATABASE_PATH },
  },
): Promise<number> {
  if (args.length === 0 || isHelpRequest(args)) {
    process.stdout.write(ROOT_HELP);
    return 0;
  }

  if (args[0] === "dev" && args[1] === "capture-fixture") {
    const fixtureFile = args[2];
    if (args.length !== 3 || !fixtureFile) {
      process.stderr.write("Usage: dev capture-fixture <fixture-file>\n");
      return 2;
    }
    return runCaptureFixture(fixtureFile, configuration);
  }

  process.stderr.write(`Unknown command.\n\n${ROOT_HELP}`);
  return 2;
}

async function runCaptureFixture(
  fixtureFile: string,
  configuration: RuntimeApplicationConfiguration,
): Promise<number> {
  let application: Application | undefined;
  let receipt: readonly CapturedEvidenceReference[] | undefined;
  const errors: ApplicationError[] = [];

  try {
    const nativeInputs = await readDevelopmentCaptureFixture(fixtureFile);
    try {
      application = await Application.create(configuration);
    } catch (cause) {
      throw new ApplicationError("cli:startup-failed", { cause });
    }

    receipt = await application.capture({
      sourceKey: "development.fixture",
      nativeInputs,
    });

    try {
      await Bun.write(Bun.stdout, `${JSON.stringify(receipt)}\n`);
    } catch (cause) {
      throw new ApplicationError("cli:output-failed", { cause });
    }
  } catch (cause) {
    errors.push(
      cause instanceof ApplicationError
        ? cause
        : new ApplicationError("capture:failed", { cause }),
    );
  } finally {
    if (application) {
      try {
        await application.close();
      } catch (cause) {
        errors.push(new ApplicationError("cli:cleanup-failed", { cause }));
      }
    }
  }

  // A successful receipt remains valid even if output or cleanup failed.
  for (const error of errors) {
    try {
      await Bun.write(Bun.stderr, `${error.code}: ${error.message}\n`);
    } catch {
      // Diagnostic output is best effort; the command still fails.
    }
  }

  return errors.length === 0 ? 0 : 1;
}

function isHelpRequest(args: readonly string[]): boolean {
  return args.length === 1 && (args[0] === "--help" || args[0] === "-h");
}

if (import.meta.main) {
  process.exitCode = await runCli(Bun.argv.slice(2));
}
