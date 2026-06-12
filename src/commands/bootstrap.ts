import type { Cli } from "./registry.ts";
import { fail, ok } from "./registry.ts";
import { bootstrapProject } from "../runtime/bootstrap.ts";
import { repoRoot } from "../runtime/fs.ts";

export function registerBootstrapCommand(cli: Cli): void {
  cli.command(["bootstrap"], async (args) => {
    const parsed = parseArgs(args);
    if (parsed.error) return fail(parsed.error);

    try {
      const result = await bootstrapProject(repoRoot().root, parsed.projectKey, parsed.repoPath);
      return ok(
        [
          `Bootstrapped project ${result.projectKey}.`,
          `repo: ${result.repoPath}`,
          `created: ${result.created.length}`,
          `kept: ${result.kept.length}`,
        ].join("\n"),
      );
    } catch (error) {
      return fail(error instanceof Error ? error.message : String(error));
    }
  });
}

function parseArgs(args: string[]): { projectKey: string; repoPath: string; error?: string } {
  let projectKey = "";
  let repoPath = "";

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === "--repo") {
      repoPath = args[++index] ?? "";
      if (!repoPath) return { projectKey, repoPath, error: "--repo requires an absolute path" };
    } else if (arg.startsWith("-")) {
      return { projectKey, repoPath, error: `Unknown bootstrap option: ${arg}` };
    } else if (!projectKey) {
      projectKey = arg;
    } else {
      return { projectKey, repoPath, error: `Unexpected bootstrap argument: ${arg}` };
    }
  }

  if (!projectKey || !repoPath) {
    return { projectKey, repoPath, error: "Usage: myelin bootstrap <project-key> --repo <absolute-path>" };
  }

  return { projectKey, repoPath };
}
