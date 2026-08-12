import { AutoMemoryMaintenanceService } from "../maintenance/auto-memory-maintenance.ts";
import { AutoProjectMemoryMaintenanceService } from "../maintenance/auto-project-memory-maintenance.ts";
import type { LaunchContext } from "../runtime/launch-context.ts";
import type { Cli, CommandResult } from "./registry.ts";
import { fail, ok } from "./registry.ts";

type SessionRunner = Pick<AutoMemoryMaintenanceService, "run">;
type ProjectRunner = Pick<AutoProjectMemoryMaintenanceService, "run">;

export type MaintenanceCommandDeps = {
  context: LaunchContext;
  sessionRunner?: SessionRunner;
  projectRunner?: ProjectRunner;
};

export function registerMaintenanceCommands(cli: Cli, deps: MaintenanceCommandDeps): void {
  cli.command(["maintenance", "worker", "session"], async (args) => {
    const projectKey = onlyProjectKey(args, "myelin maintenance worker session <project-key>");
    if (typeof projectKey !== "string") return projectKey;
    const result = await (deps.sessionRunner ?? new AutoMemoryMaintenanceService(deps.context.myelinRoot)).run(projectKey);
    return result.status === "failed"
      ? fail(result.error_message ?? "Auto memory maintenance failed.")
      : ok(`Auto memory maintenance ${result.run_id} completed for ${result.project_key}.`);
  });

  cli.command(["maintenance", "worker", "project"], async (args) => {
    const projectKey = onlyProjectKey(args, "myelin maintenance worker project <project-key>");
    if (typeof projectKey !== "string") return projectKey;
    const result = await (deps.projectRunner ?? new AutoProjectMemoryMaintenanceService(deps.context.myelinRoot)).run(projectKey);
    return result.status === "failed"
      ? fail(result.error_message ?? "Auto Project Memory maintenance failed.")
      : ok(`Auto Project Memory maintenance ${result.run_id} completed for ${result.project_key}.`);
  });
}

function onlyProjectKey(args: string[], usage: string): string | CommandResult {
  return args.length === 1 && args[0] ? args[0] : fail(`Usage: ${usage}`);
}
