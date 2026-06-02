import type { Cli } from "./registry.ts";
import { fail, ok } from "./registry.ts";
import { readdir, stat } from "node:fs/promises";
import { basename, join } from "node:path";
import { repoRoot } from "../runtime/fs.ts";
import { discoverProjects, findProject, projectForRepoPath, type Project } from "../runtime/projects.ts";
import { readProjectStateIfExists } from "../runtime/state.ts";

type FacadeResponse = {
  answer: string;
  confidence: number;
  memory_scope: "project";
  citations: string[];
  candidate_ids: string[];
  degraded: boolean;
  degraded_reason: string | null;
  source_tools: string[];
};

type FreshnessState = {
  status?: string;
  changed_paths?: string[];
  impacted_pages?: string[];
  updated_at?: string | null;
  last_seen_commit?: string | null;
};

type UpdateState = {
  latest_run_dir?: string | null;
  last_completed_stage?: string | null;
  stages?: Record<string, { status?: string; last_completed_at?: string | null }>;
};

type SessionPointer = {
  path?: string;
  title?: string;
  updated_at?: string | null;
};

type StatusSummary = {
  project: {
    key: string;
    name: string;
    dir: string;
  };
  latest_session: SessionPointer | null;
  stale: {
    status: string;
    changed_paths: string[];
    impacted_pages: string[];
    updated_at: string | null;
  };
  latest_run: {
    dir: string | null;
    last_completed_stage: string | null;
    last_completed_at: string | null;
  };
};

export function registerStatusCommand(cli: Cli): void {
  cli.command(["status"], async (args) => {
    const parsed = parseArgs(args);
    if (parsed.error) return fail(parsed.error);

    const root = repoRoot().root;
    let project: Project | null = null;
    if (parsed.projectKey) {
      try {
        project = await findProject(root, parsed.projectKey);
      } catch (error) {
        return fail(error instanceof Error ? error.message : String(error));
      }
    } else {
      project = await projectForRepoPath(root, process.cwd());
      project ??= (await discoverProjects(root))[0] ?? null;
    }

    if (!project) {
      return fail("No project found. Pass `myelin status <project-key>` or run inside a registered repo path.");
    }

    const summary = await buildStatusSummary(root, project);
    if (parsed.json) return ok(JSON.stringify(toFacadeResponse(summary), null, 2));
    return ok(renderHuman(summary));
  });
}

async function buildStatusSummary(root: string, project: Project): Promise<StatusSummary> {
  const freshness = (await readProjectStateIfExists<FreshnessState>(root, project.key, "freshness.json")) ?? {};
  const updateState =
    (await readProjectStateIfExists<UpdateState>(root, project.key, "update-state.json")) ??
    (await readProjectStateIfExists<UpdateState>(root, project.key, "bootstrap-state.json")) ??
    {};
  const stage = updateState.last_completed_stage ?? null;

  return {
    project: {
      key: project.key,
      name: project.config.name ?? project.key,
      dir: project.dir,
    },
    latest_session: await latestSession(project.dir),
    stale: {
      status: freshness.status ?? "unknown",
      changed_paths: freshness.changed_paths ?? [],
      impacted_pages: freshness.impacted_pages ?? [],
      updated_at: freshness.updated_at ?? null,
    },
    latest_run: {
      dir: updateState.latest_run_dir ?? null,
      last_completed_stage: stage,
      last_completed_at: stage ? (updateState.stages?.[stage]?.last_completed_at ?? null) : null,
    },
  };
}

async function latestSession(projectDir: string): Promise<SessionPointer | null> {
  const sessionsDir = join(projectDir, "wiki", "sessions");
  let entries: string[];
  try {
    entries = await readdir(sessionsDir);
  } catch (error) {
    if (error && typeof error === "object" && "code" in error && error.code === "ENOENT") return null;
    throw error;
  }

  const candidates = await Promise.all(
    entries
      .filter((entry) => entry.endsWith(".md"))
      .map(async (entry) => {
        const path = join(sessionsDir, entry);
        const info = await stat(path);
        return { path: `wiki/sessions/${entry}`, title: basename(entry, ".md"), updated_at: info.mtime.toISOString() };
      }),
  );

  return candidates.sort((a, b) => b.updated_at.localeCompare(a.updated_at) || b.path.localeCompare(a.path))[0] ?? null;
}

function toFacadeResponse(summary: StatusSummary): FacadeResponse {
  const staleCount = summary.stale.changed_paths.length + summary.stale.impacted_pages.length;
  const answer = [
    `Project ${summary.project.key} (${summary.project.name})`,
    summary.latest_session ? `latest session ${summary.latest_session.path}` : "latest session not recorded",
    `stale status ${summary.stale.status}${staleCount > 0 ? ` with ${staleCount} item(s)` : ""}`,
  ].join("; ");

  return {
    answer,
    confidence: 1,
    memory_scope: "project",
    citations: [
      `projects/${summary.project.key}/state/project.json`,
      `projects/${summary.project.key}/state/freshness.json`,
      `projects/${summary.project.key}/state/update-state.json`,
    ],
    candidate_ids: [],
    degraded: false,
    degraded_reason: null,
    source_tools: ["project-state"],
  };
}

function renderHuman(summary: StatusSummary): string {
  const lines = [
    `Project`,
    `  key: ${summary.project.key}`,
    `  name: ${summary.project.name}`,
    `  dir: ${summary.project.dir}`,
    `Latest Session`,
    `  ${summary.latest_session ? `${summary.latest_session.path} (${summary.latest_session.updated_at})` : "none recorded"}`,
    `Stale`,
    `  status: ${summary.stale.status}`,
    `  changed paths: ${summary.stale.changed_paths.length}`,
    `  impacted pages: ${summary.stale.impacted_pages.length}`,
  ];

  if (summary.stale.changed_paths.length > 0) lines.push(`  changed: ${summary.stale.changed_paths.join(", ")}`);
  if (summary.stale.impacted_pages.length > 0) lines.push(`  impacted: ${summary.stale.impacted_pages.join(", ")}`);
  if (summary.latest_run.last_completed_stage) {
    lines.push(
      `Latest Run`,
      `  stage: ${summary.latest_run.last_completed_stage}`,
      `  completed at: ${summary.latest_run.last_completed_at ?? "unknown"}`,
    );
  }

  return lines.join("\n");
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
