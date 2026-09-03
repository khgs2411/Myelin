#!/usr/bin/env bun

import { Application } from "./src/application.ts";

const LOCAL_DATABASE_PATH =
  "/Users/liadgoren/Repositories/llm-wiki/.llm-wiki-dev/state.sqlite";

const ROOT_HELP = `LLM Wiki local prototype

Usage:
  bun run cli.ts [command]

No operational commands are available yet.
`;

export async function runCli(args: readonly string[]): Promise<number> {
  if (args.length === 0 || isHelpRequest(args)) {
    process.stdout.write(ROOT_HELP);
    return 0;
  }

  process.stderr.write(`Unknown command.\n\n${ROOT_HELP}`);
  return 2;
}

async function withApplication<T>(
  operation: (application: Application) => Promise<T>,
): Promise<T> {
  const application = await Application.create({
    sqlite: {
      databasePath: LOCAL_DATABASE_PATH,
    },
    workingDirectory: process.cwd(),
  });

  try {
    return await operation(application);
  } finally {
    await application.close();
  }
}

function isHelpRequest(args: readonly string[]): boolean {
  return args.length === 1 && (args[0] === "--help" || args[0] === "-h");
}

if (import.meta.main) {
  process.exitCode = await runCli(Bun.argv.slice(2));
}
