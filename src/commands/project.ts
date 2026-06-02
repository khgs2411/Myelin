import type { Cli } from "./registry.ts";
import { fail, ok } from "./registry.ts";
import { repoRoot } from "../runtime/fs.ts";
import { migrateProjectLayout, migrateStageInstructions } from "../runtime/layout.ts";

export function registerProjectCommands(cli: Cli): void {
  cli.command(["project", "learn"], () => ok("project learn is registered but not implemented in this slice."));
  cli.command(["project", "ingest"], () => ok("project ingest is registered but not implemented in this slice."));
  cli.command(["project", "onboard"], () => ok("project onboard is registered but not implemented in this slice."));
  cli.command(["project", "migrate-layout"], async (args) => {
    const projectKey = args[0];
    if (!projectKey || args.length > 1) return fail("Usage: myelin project migrate-layout <project-key>");

    const root = repoRoot().root;
    try {
      const projectActions = await migrateProjectLayout(root, projectKey);
      const stageActions = await migrateStageInstructions(root);
      return ok(
        [
          `Migrated project layout for ${projectKey}.`,
          `Project actions: ${projectActions.length}`,
          `Stage actions: ${stageActions.length}`,
        ].join("\n"),
      );
    } catch (error) {
      return fail(error instanceof Error ? error.message : String(error));
    }
  });
}
