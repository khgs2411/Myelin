import type { Cli } from "./registry.ts";
import { fail, ok } from "./registry.ts";
import { repoRoot } from "../runtime/fs.ts";
import { stableJson } from "../runtime/json.ts";
import { buildSchemaContext, checkSchema } from "../schema/compiler.ts";

export function registerSchemaCommands(cli: Cli): void {
  cli.command(["schema", "check"], async (args) => {
    const parsed = parseArgs(args, { allowDryRun: false });
    if (parsed.error) return fail(parsed.error);

    const result = await checkSchema(repoRoot().root, parsed.projectKey);
    if (!result.ok) return fail(`Schema check failed:\n${result.errors.map((error) => `  - ${error}`).join("\n")}`);
    return ok(`Schema check passed for ${parsed.projectKey}.`);
  });

  cli.command(["schema", "build"], async (args) => {
    const parsed = parseArgs(args, { allowDryRun: true });
    if (parsed.error) return fail(parsed.error);

    try {
      const result = await buildSchemaContext(repoRoot().root, parsed.projectKey, { dryRun: parsed.dryRun });
      if (parsed.dryRun) return ok(stableJson(result.context));
      return ok(
        result.wrote
          ? `Wrote projects/${parsed.projectKey}/state/schema-context.json.`
          : `Schema context already current for ${parsed.projectKey}.`,
      );
    } catch (error) {
      return fail(error instanceof Error ? error.message : String(error));
    }
  });
}

function parseArgs(args: string[], options: { allowDryRun: boolean }): { projectKey: string; dryRun: boolean; error?: string } {
  let projectKey = "";
  let dryRun = false;

  for (const arg of args) {
    if (arg === "--dry-run") {
      if (!options.allowDryRun) return { projectKey, dryRun, error: "schema check does not accept --dry-run; it is always read-only." };
      dryRun = true;
    } else if (arg.startsWith("-")) {
      return { projectKey, dryRun, error: `Unknown schema option: ${arg}` };
    } else if (!projectKey) {
      projectKey = arg;
    } else {
      return { projectKey, dryRun, error: `Unexpected schema argument: ${arg}` };
    }
  }

  if (!projectKey) return { projectKey, dryRun, error: "Usage: myelin schema <check|build> <project-key> [--dry-run]" };
  return { projectKey, dryRun };
}
