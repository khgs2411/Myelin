import type { Cli } from "./registry.ts";
import { fail, ok } from "./registry.ts";
import type { LaunchContext } from "../runtime/launch-context.ts";
import { StatusService } from "../status/status-service.ts";
import { renderStatusHuman } from "../status/status-renderer.ts";
import { serializeStatusV1 } from "../status/status-v1.ts";

export type StatusCommandDeps = { context: LaunchContext };

export function registerStatusCommand(cli: Cli, deps: StatusCommandDeps): void {
  cli.command(["status"], async (args) => {
    const parsed = parseArgs(args);
    if (parsed.error) return fail(parsed.error);

    const service = new StatusService(deps.context.myelinRoot, {
      locatorPath: deps.context.locatorPath ?? undefined,
    });
    try {
      const summary = await service.summary({ projectKey: parsed.projectKey, cwd: deps.context.callerCwd });
      const status = serializeStatusV1(summary);
      if (parsed.json) return ok(JSON.stringify(status, null, 2));
      return ok(renderStatusHuman(status));
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
