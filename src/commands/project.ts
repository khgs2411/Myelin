import type { Cli } from "./registry.ts";
import { fail, ok } from "./registry.ts";
import { repoRoot } from "../runtime/fs.ts";
import { stableJson } from "../runtime/json.ts";
import type { PipelineKind } from "../pipeline/runner.ts";
import { ProjectService } from "../project/project-service.ts";

export function registerProjectCommands(cli: Cli): void {
  cli.command(["project", "list"], async (args) => listProjectsCommand(args));
  cli.command(["project", "learn"], async (args) => runPipelineCommand("learn", args));
  cli.command(["project", "ingest"], async (args) => runPipelineCommand("ingest", args));
  cli.command(["project", "migrate-layout"], async (args) => {
    const projectKey = args[0];
    if (!projectKey || args.length > 1) return fail("Usage: myelin project migrate-layout <project-key>");

    const root = repoRoot().root;
    try {
      const result = await new ProjectService(root).migrateLayout(projectKey);
      return ok(
        [
          `Migrated project layout for ${projectKey}.`,
          `Project actions: ${result.projectActions.length}`,
        ].join("\n"),
      );
    } catch (error) {
      return fail(error instanceof Error ? error.message : String(error));
    }
  });
}

async function listProjectsCommand(args: string[]) {
  const parsed = parseProjectListArgs(args);
  if (parsed.error) return fail(parsed.error);

  try {
    const result = await new ProjectService(repoRoot().root).listProjects({
      includeLegacy: parsed.includeLegacy,
    });
    if (parsed.json) return ok(stableJson(result));

    const lines = [
      parsed.includeLegacy ? "Projects:" : "Active projects:",
      ...result.projects.map((project) => {
        const repo = project.repo_paths[0] ? ` repo=${project.repo_paths[0]}` : "";
        return `- ${project.key} [${project.lifecycle}]${repo}`;
      }),
    ];
    if (!parsed.includeLegacy) lines.push("", "Use --include-legacy to show archived V1 projects.");
    return ok(lines.join("\n"));
  } catch (error) {
    return fail(error instanceof Error ? error.message : String(error));
  }
}

async function runPipelineCommand(kind: PipelineKind, args: string[]) {
  const parsed = parsePipelineArgs(kind, args);
  if (parsed.error) return fail(parsed.error);

  try {
    const result = await new ProjectService(repoRoot().root).runPipeline({ ...parsed, kind });
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

function parseProjectListArgs(args: string[]): {
  includeLegacy: boolean;
  json: boolean;
  error?: string;
} {
  let includeLegacy = false;
  let json = false;

  for (const arg of args) {
    if (arg === "--include-legacy") includeLegacy = true;
    else if (arg === "--json") json = true;
    else return { includeLegacy, json, error: `Unknown project list option: ${arg}` };
  }

  return { includeLegacy, json };
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
