import type { Cli } from "./registry.ts";
import { fail, ok } from "./registry.ts";
import { repoRoot } from "../runtime/fs.ts";
import { migrateProjectLayout, migrateStageInstructions } from "../runtime/layout.ts";
import { stableJson } from "../runtime/json.ts";
import { runProjectPipeline, type PipelineKind } from "../pipeline/runner.ts";

export function registerProjectCommands(cli: Cli): void {
  cli.command(["project", "learn"], async (args) => runPipelineCommand("learn", args));
  cli.command(["project", "ingest"], async (args) => runPipelineCommand("ingest", args));
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

async function runPipelineCommand(kind: PipelineKind, args: string[]) {
  const parsed = parsePipelineArgs(kind, args);
  if (parsed.error) return fail(parsed.error);

  try {
    const result = await runProjectPipeline(repoRoot().root, parsed.projectKey, kind, {
      dryRun: parsed.dryRun,
      review: parsed.review,
      provider: parsed.provider,
      modelOverride: parsed.modelOverride,
    });
    if (parsed.json) return ok(stableJson(result));

    const lines = [
      `Project ${kind} ${result.status} for ${result.project_key}.`,
      `run: ${result.run_dir}`,
      `stages: ${result.stages.map((stage) => `${stage.stage_id}:${stage.status}`).join(", ")}`,
      `validation: ${result.validation.ok ? "passed" : "failed"}`,
    ];
    if (result.stopped_reason) lines.push(`stopped: ${result.stopped_reason}`);
    return result.status === "failed" ? fail(lines.join("\n")) : ok(lines.join("\n"));
  } catch (error) {
    return fail(error instanceof Error ? error.message : String(error));
  }
}

function parsePipelineArgs(
  kind: PipelineKind,
  args: string[],
): {
  projectKey: string;
  dryRun: boolean;
  review: boolean;
  json: boolean;
  provider?: "codex" | "claude";
  modelOverride?: string;
  error?: string;
} {
  let projectKey = "";
  let dryRun = false;
  let review = false;
  let json = false;
  let provider: "codex" | "claude" | undefined;
  let modelOverride: string | undefined;

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === "--dry-run") dryRun = true;
    else if (arg === "--review") review = true;
    else if (arg === "--json") json = true;
    else if (arg === "--provider") {
      const value = args[++index];
      if (value !== "codex" && value !== "claude") return { projectKey, dryRun, review, json, error: "--provider must be codex or claude" };
      provider = value;
    } else if (arg === "--model") {
      modelOverride = args[++index];
      if (!modelOverride) return { projectKey, dryRun, review, json, error: "--model requires a value" };
    } else if (arg.startsWith("-")) {
      return { projectKey, dryRun, review, json, error: `Unknown project ${kind} option: ${arg}` };
    } else if (!projectKey) {
      projectKey = arg;
    } else {
      return { projectKey, dryRun, review, json, error: `Unexpected project ${kind} argument: ${arg}` };
    }
  }

  if (!projectKey) return { projectKey, dryRun, review, json, error: `Usage: myelin project ${kind} <project-key> [--dry-run] [--review] [--json]` };
  return { projectKey, dryRun, review, json, provider, modelOverride };
}
