import { readdir, stat } from "node:fs/promises";
import { basename, join } from "node:path";
import { projectLayout } from "../runtime/layout.ts";
import { discoverProjects, findProject, projectForRepoPath, type Project } from "../runtime/projects.ts";
import { readProjectStateIfExists } from "../runtime/state.ts";

export type StatusFacadeResponse = {
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

export type StatusSummary = {
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

export class StatusService {
  constructor(private readonly root: string) {}

  async summary(input: { projectKey?: string | null; cwd?: string }): Promise<StatusSummary> {
    const project = await this.resolveProject(input);
    if (!project) {
      throw new Error("No project found. Pass `myelin status <project-key>` or run inside a registered repo path.");
    }
    return await this.buildStatusSummary(project);
  }

  toFacadeResponse(summary: StatusSummary): StatusFacadeResponse {
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

  renderHuman(summary: StatusSummary): string {
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

  private async resolveProject(input: { projectKey?: string | null; cwd?: string }): Promise<Project | null> {
    if (input.projectKey) return await findProject(this.root, input.projectKey);
    const cwd = input.cwd ?? process.cwd();
    return (await projectForRepoPath(this.root, cwd)) ?? (await discoverProjects(this.root))[0] ?? null;
  }

  private async buildStatusSummary(project: Project): Promise<StatusSummary> {
    const freshness = (await readProjectStateIfExists<FreshnessState>(this.root, project.key, "freshness.json")) ?? {};
    const updateState =
      (await readProjectStateIfExists<UpdateState>(this.root, project.key, "update-state.json")) ??
      (await readProjectStateIfExists<UpdateState>(this.root, project.key, "bootstrap-state.json")) ??
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
        dir: updateState.latest_run_dir ?? (await latestRunDir(this.root, project)),
        last_completed_stage: stage,
        last_completed_at: stage ? (updateState.stages?.[stage]?.last_completed_at ?? null) : null,
      },
    };
  }
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

async function latestRunDir(root: string, project: Project): Promise<string | null> {
  const runsDir = projectLayout(root, project.key).runs;
  let entries: string[];
  try {
    entries = await readdir(runsDir);
  } catch (error) {
    if (error && typeof error === "object" && "code" in error && error.code === "ENOENT") return null;
    throw error;
  }

  const candidates = (await Promise.all(entries.map((entry) => runCandidates(runsDir, project.key, entry)))).flat();

  return candidates
    .filter((candidate): candidate is { path: string; mtime: string } => candidate !== null)
    .sort((a, b) => b.mtime.localeCompare(a.mtime) || b.path.localeCompare(a.path))[0]?.path ?? null;
}

async function runCandidates(runsDir: string, projectKey: string, entry: string): Promise<Array<{ path: string; mtime: string } | null>> {
  const path = join(runsDir, entry);
  const info = await stat(path);
  if (!info.isDirectory()) return [null];
  if (entry.endsWith("-run")) {
    return [{ path: `projects/${projectKey}/runs/${entry}`, mtime: info.mtime.toISOString() }];
  }

  const children = await readdir(path);
  return Promise.all(
    children.map(async (child) => {
      const childPath = join(path, child);
      const childInfo = await stat(childPath);
      return childInfo.isDirectory()
        ? { path: `projects/${projectKey}/runs/${entry}/${child}`, mtime: childInfo.mtime.toISOString() }
        : null;
    }),
  );
}
