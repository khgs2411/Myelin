import { homedir } from "node:os";
import { basename, dirname, isAbsolute, join, relative, resolve } from "node:path";
import { realpath } from "node:fs/promises";
import { discoverProjects, findProject, type Project } from "../runtime/projects.ts";
import { loadConfig } from "../runtime/config.ts";
import { isProcessAlive } from "../ingest/runtime.ts";
import { EvidenceRegistry, type OperationalStatusResult, type ProjectMemoryStatusSection, type SessionMemoryStatusSection, type StatusWarning } from "./contracts.ts";
import { inspectInstallation } from "./installation-inspector.ts";
import { inspectProjectMemory } from "./project-memory-inspector.ts";
import { inspectSessionMemory, openStatusDatabase } from "./session-memory-inspector.ts";
import { aggregateOverall, warning } from "./severity.ts";

export type StatusServiceDeps = {
  now?: () => Date;
  isProcessAlive?: (pid: number) => boolean;
  locatorPath?: string;
  env?: NodeJS.ProcessEnv;
};

export class StatusService {
  constructor(private readonly root: string, private readonly deps: StatusServiceDeps = {}) {}

  async summary(input: { projectKey?: string | null; cwd?: string }): Promise<OperationalStatusResult> {
    const resolved = await this.resolveProject(input);
    if (!resolved) throw new Error("No project found. Pass `myelin status <project-key>` or run inside a registered repo path.");
    const evidence = new EvidenceRegistry(this.root);
    const installation = await inspectInstallation({
      root: this.root,
      evidence,
      locatorPath: this.deps.locatorPath ?? join(homedir(), ".myelin", "install.json"),
    });
    const config = await loadConfig(this.root, this.deps.env ?? process.env);
    const alive = this.deps.isProcessAlive ?? isProcessAlive;
    let session: Awaited<ReturnType<typeof inspectSessionMemory>>;
    let project: Awaited<ReturnType<typeof inspectProjectMemory>>;
    try {
      const snapshot = openStatusDatabase(this.root);
      try {
        session = await inspectSessionMemory({ root: this.root, projectKey: resolved.project.key, db: snapshot.db, config: config.autoMemoryMaintenance, evidence, isAlive: alive });
        project = await inspectProjectMemory({ root: this.root, projectKey: resolved.project.key, db: snapshot.db, config: config.autoProjectMemoryMaintenance, evidence, isAlive: alive });
      } finally {
        snapshot.close();
      }
    } catch (error) {
      const dbId = evidence.add("sqlite", join(this.root, "state", "memory.db"));
      const dbWarning = warning("ROOT_SQLITE_UNAVAILABLE", "blocked", "session_memory", errorMessage(error), [dbId]);
      session = { section: unavailableSession(resolved.project.key, dbId), warnings: [dbWarning], actions: [] };
      project = { section: unavailableProject(resolved.project.key, dbId), warnings: [warning("ROOT_SQLITE_UNAVAILABLE", "blocked", "project_memory", errorMessage(error), [dbId])], actions: [] };
    }
    const warnings = [...installation.warnings, ...session.warnings, ...project.warnings];
    const actions = [...installation.actions, ...session.actions, ...project.actions];
    return {
      generated_at: (this.deps.now ?? (() => new Date()))().toISOString(),
      overall_state: aggregateOverall([installation.section.state, session.section.state, project.section.state]),
      project: { key: resolved.project.key, name: resolved.project.config.name ?? resolved.project.key, repo_paths: resolved.project.config.repo_paths ?? [], resolved_from: resolved.from },
      installation: installation.section,
      session_memory: session.section,
      project_memory: project.section,
      warnings,
      actions,
      evidence: evidence.all(),
    };
  }

  private async resolveProject(input: { projectKey?: string | null; cwd?: string }): Promise<{ project: Project; from: "argument" | "cwd" } | null> {
    if (input.projectKey) return { project: await findProject(this.root, input.projectKey), from: "argument" };
    if (!input.cwd) return null;
    const cwd = await canonicalPath(input.cwd);
    const matches: Project[] = [];
    for (const project of await discoverProjects(this.root)) {
      for (const repoPath of project.config.repo_paths ?? []) {
        const rel = relative(await canonicalPath(repoPath), cwd);
        if (rel === "" || (!rel.startsWith("..") && !isAbsolute(rel))) {
          matches.push(project);
          break;
        }
      }
    }
    if (matches.length > 1) throw new Error(`Ambiguous project for ${cwd}: ${matches.map((project) => project.key).join(", ")}. Pass an explicit project key.`);
    return matches[0] ? { project: matches[0], from: "cwd" } : null;
  }
}

function unavailableSession(key: string, evidenceId: string): SessionMemoryStatusSection {
  return {
    state: "blocked", lifecycle: "storage_unavailable", evidence_ids: [evidenceId],
    capture: { queued_events: 0, unleased_events: 0, leased_events: 0 },
    ingest: { running_jobs: 0, failed_jobs: 0, terminal_tombstones: 0, latest_log_path: null },
    maintenance: { enabled: false, lifecycle: "unknown", lock: { lifecycle: "absent", path: `projects/${key}/state/.auto-memory-maintenance.lock`, run_id: null, pid: null }, last_run_id: null, last_log_path: null },
    retrieval: { indexed_count: 0, pending_count: 0, failed_count: 0 },
  };
}

function unavailableProject(key: string, evidenceId: string): ProjectMemoryStatusSection {
  return {
    state: "blocked", lifecycle: "storage_unavailable", evidence_ids: [evidenceId],
    inbox: { pending_items: 0 }, candidates: { pending: 0, needs_review: 0 },
    maintenance: { enabled: false, lifecycle: "unknown", lock: { lifecycle: "absent", path: `projects/${key}/state/.auto-project-memory-maintenance.lock`, run_id: null, pid: null }, last_run_id: null, last_log_path: null },
    curation: { lifecycle: "unknown", canonical_wiki_path: `projects/${key}/wiki`, latest_run_path: null },
    retrieval: { indexed_count: 0, pending_count: 0, failed_count: 0 },
  };
}

function errorMessage(error: unknown): string { return error instanceof Error ? error.message : String(error); }

async function canonicalPath(path: string): Promise<string> {
  let current = resolve(path);
  const suffix: string[] = [];
  while (true) {
    try { return join(await realpath(current), ...suffix.reverse()); } catch {
      const parent = dirname(current);
      if (parent === current) return resolve(path);
      suffix.push(basename(current));
      current = parent;
    }
  }
}

export type { OperationalStatusResult, StatusWarning } from "./contracts.ts";
