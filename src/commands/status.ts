import type { Cli } from "./registry.ts";
import { fail, ok } from "./registry.ts";
import { repoRoot } from "../runtime/fs.ts";
import { StatusService } from "../status/status-service.ts";

export function registerStatusCommand(cli: Cli): void {
  cli.command(["status"], async (args) => {
    const parsed = parseArgs(args);
    if (parsed.error) return fail(parsed.error);

    const root = repoRoot().root;
    const service = new StatusService(root);
    try {
      const summary = await service.summary({ projectKey: parsed.projectKey, cwd: process.cwd() });
      if (parsed.json) return ok(JSON.stringify(service.toFacadeResponse(summary), null, 2));
      return ok(service.renderHuman(summary));
    } catch (error) {
      return fail(error instanceof Error ? error.message : String(error));
    }
  });
}

function parseArgs(args: string[]): { projectKey: string | null; json: boolean; error?: string } {
  let projectKey: string | null = null;
  let json = false;

  for (const arg of args) {
    if (arg === "--json") {
      json = true;
    } else if (arg.startsWith("-")) {
      return { projectKey: null, json, error: `Unknown status option: ${arg}` };
    } else if (!projectKey) {
      projectKey = arg;
    } else {
      return { projectKey: null, json, error: `Unexpected status argument: ${arg}` };
    }
  }

  return { projectKey, json };
}
