import type { Cli } from "./registry.ts";
import { fail, ok } from "./registry.ts";
import { repoRoot } from "../runtime/fs.ts";
import { stableJson } from "../runtime/json.ts";
import type { ProcessRunner } from "../runtime/llm-client.ts";
import { ProjectService } from "../project/project-service.ts";
import { ProjectResetService } from "../project/project-reset-service.ts";

export type ProjectCommandDeps = {
  now?: () => Date;
  runner?: ProcessRunner;
  env?: NodeJS.ProcessEnv;
};

export function registerProjectCommands(cli: Cli, deps: ProjectCommandDeps = {}): void {
  cli.command(["project", "list"], async (args) => listProjectsCommand(args));
  cli.command(["project", "packet"], async (args) => projectPacketCommand(args));
  cli.command(["project", "learn"], async (args) => projectLearnCommand(args, deps));
  cli.command(["project", "reset"], async (args) => projectResetCommand(args));
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

async function projectResetCommand(args: string[]) {
  const parsed = parseProjectResetArgs(args);
  if (parsed.error) return fail(parsed.error);

  try {
    const result = await new ProjectResetService(repoRoot().root).cleanRebootstrap(parsed.projectKey);
    if (parsed.json) return ok(stableJson(result));

    return ok(
      [
        `Reset project shell for ${result.project_key}.`,
        `scope: ${result.reset_scope}`,
        `deleted: ${result.deleted_project_path}`,
        `preserved memory db: ${result.preserved_memory_db}`,
        `bootstrap: ${result.bootstrap_status}`,
      ].join("\n"),
    );
  } catch (error) {
    return fail(error instanceof Error ? error.message : String(error));
  }
}

async function projectPacketCommand(args: string[]) {
  const parsed = parseProjectPacketArgs(args);
  if (parsed.error) return fail(parsed.error);

  try {
    const packet = await new ProjectService(repoRoot().root).buildMemoryPacket(parsed.projectKey);
    if (parsed.json) return ok(stableJson(packet));

    return ok(
      [
        `Project Memory packet for ${packet.project_key}`,
        `mode: ${packet.mode}`,
        `wiki pages: ${packet.wiki.page_count}`,
        `project handoffs: ${packet.pending.project_handoffs.length}`,
        `project candidates: ${packet.pending.project_candidates.length}`,
        `session memories: ${packet.session_memory.selected.length}`,
        `lookup queries: ${packet.lookup.queries.length}`,
        `degraded: ${packet.degraded ? "yes" : "no"}`,
        packet.degraded ? `degraded reasons: ${packet.degraded_reasons.join("; ")}` : "",
        "",
        "Use --json for the full packet.",
      ].filter(Boolean).join("\n"),
    );
  } catch (error) {
    return fail(error instanceof Error ? error.message : String(error));
  }
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

async function projectLearnCommand(args: string[], deps: ProjectCommandDeps) {
  const parsed = parseProjectLearnArgs(args);
  if (parsed.error) return fail(parsed.error);

  try {
    const result = await new ProjectService(repoRoot().root).runProjectLearn({
      projectKey: parsed.projectKey,
      dryRun: parsed.dryRun,
      review: parsed.review,
      provider: parsed.provider,
      modelOverride: parsed.modelOverride,
      env: deps.env,
      runner: deps.runner,
      now: deps.now?.(),
    });
    if (parsed.json) return ok(stableJson(result));

    const lines = [
      `Project learn ${result.status} for ${result.project_key}.`,
      `mode: ${result.mode}`,
      `run: ${result.run_dir}`,
      `validation: ${result.validation_ok ? "passed" : "failed"}`,
      `stopped_before_writes: ${result.stopped_before_writes}`,
    ];
    if (result.applied_page_ids?.length) lines.push(`applied pages: ${result.applied_page_ids.join(", ")}`);
    if (result.applied_item_ids?.length) lines.push(`applied items: ${result.applied_item_ids.join(", ")}`);
    if (result.changed_files?.length) lines.push(`changed files: ${result.changed_files.join(", ")}`);
    if (result.status === "completed_with_pending_index") lines.push("pending retrieval index: yes");
    if (result.stopped_reason) lines.push(`stopped: ${result.stopped_reason}`);
    return result.status === "failed" ? fail(lines.join("\n")) : ok(lines.join("\n"));
  } catch (error) {
    return fail(error instanceof Error ? error.message : String(error));
  }
}

function parseProjectPacketArgs(args: string[]): {
  projectKey: string;
  json: boolean;
  error?: string;
} {
  let projectKey = "";
  let json = false;

  for (const arg of args) {
    if (arg === "--json") json = true;
    else if (arg.startsWith("-")) return { projectKey, json, error: `Unknown project packet option: ${arg}` };
    else if (!projectKey) projectKey = arg;
    else return { projectKey, json, error: `Unexpected project packet argument: ${arg}` };
  }

  if (!projectKey) return { projectKey, json, error: "Usage: myelin project packet <project-key> [--json]" };
  return { projectKey, json };
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

function parseProjectResetArgs(args: string[]): {
  projectKey: string;
  clean: boolean;
  confirm?: string;
  json: boolean;
  error?: string;
} {
  let projectKey = "";
  let clean = false;
  let confirm: string | undefined;
  let json = false;

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === "--clean") clean = true;
    else if (arg === "--json") json = true;
    else if (arg === "--confirm") confirm = args[++index];
    else if (arg.startsWith("-")) return { projectKey, clean, confirm, json, error: `Unknown project reset option: ${arg}` };
    else if (!projectKey) projectKey = arg;
    else return { projectKey, clean, confirm, json, error: `Unexpected project reset argument: ${arg}` };
  }

  if (!projectKey || !clean || confirm !== projectKey) {
    return {
      projectKey,
      clean,
      confirm,
      json,
      error: "Usage: myelin project reset <project-key> --clean --confirm <project-key> [--json]",
    };
  }
  return { projectKey, clean, confirm, json };
}

function parseProjectLearnArgs(args: string[]): {
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
      return { projectKey, dryRun, review, json, error: `Unknown project learn option: ${arg}` };
    } else if (!projectKey) {
      projectKey = arg;
    } else {
      return { projectKey, dryRun, review, json, error: `Unexpected project learn argument: ${arg}` };
    }
  }

  if (!projectKey) {
    return {
      projectKey,
      dryRun,
      review,
      json,
      error: "Usage: myelin project learn <project-key> [--dry-run] [--review] [--json]",
    };
  }
  return { projectKey, dryRun, review, json, provider, modelOverride };
}
