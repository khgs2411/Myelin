import { homedir } from "node:os";
import { basename, dirname, isAbsolute, join, relative, resolve } from "node:path";
import { realpath } from "node:fs/promises";
import { discoverProjects, findProject, type Project } from "../runtime/projects.ts";
import { loadConfig, selectModelProfile } from "../runtime/config.ts";
import { EmbeddingProviderFactory } from "../memory/embedding-provider-factory.ts";
import { isProcessAlive } from "../ingest/runtime.ts";
import { EvidenceRegistry, type OperationalStatusResult, type ProjectMemoryStatusSection, type SessionMemoryStatusSection } from "./contracts.ts";
import { inspectInstallation } from "./installation-inspector.ts";
import { inspectProjectMemory } from "./project-memory-inspector.ts";
import { inspectSessionMemory, openStatusDatabase } from "./session-memory-inspector.ts";
import { aggregateOverall, maxState, warning } from "./severity.ts";
import { memoryDbPath } from "../memory/db.ts";
import {
  selectSessionCurrentContinuity,
  unavailableSessionCurrentContinuity,
} from "../memory/session-current-continuity.ts";
import type { SessionCurrentContinuityV1 } from "../memory/session-current-continuity-types.ts";
import { embeddingProviderFailureKind } from "../memory/embedding-provider-errors.ts";
import type { MyelinConfig } from "../runtime/config.ts";
import { withSMCProviderState } from "../session-maintenance/status-service.ts";
import type { SMCStatusV1 } from "../session-maintenance/status-types.ts";

export type StatusServiceDeps = {
  now?: () => Date;
  isProcessAlive?: (pid: number) => boolean;
  locatorPath?: string;
  env?: NodeJS.ProcessEnv;
  createEmbeddingFactory?: (
    config: MyelinConfig,
  ) => Pick<EmbeddingProviderFactory, "initializeContract">;
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
    let sessionContinuity: SessionCurrentContinuityV1;
    const generatedAt = (this.deps.now ?? (() => new Date()))().toISOString();
    try {
      const snapshot = openStatusDatabase(this.root);
      try {
        session = await inspectSessionMemory({
          root: this.root,
          projectKey: resolved.project.key,
          db: snapshot.db,
          config: config.autoMemoryMaintenance,
          embeddingConfig: config.embedding,
          sessionMaintenanceConfig: config.sessionMaintenance,
          ingestProfile: selectModelProfile(config, "ingest"),
          generatedAt,
          evidence,
          isAlive: alive,
        });
        project = await inspectProjectMemory({ root: this.root, projectKey: resolved.project.key, db: snapshot.db, config: config.autoProjectMemoryMaintenance, embeddingConfig: config.embedding, evidence, isAlive: alive });
        sessionContinuity = selectSessionCurrentContinuity(snapshot.db, resolved.project.key);
      } finally {
        snapshot.close();
      }
    } catch (error) {
      const dbId = evidence.add("sqlite", memoryDbPath(this.root));
      const dbWarning = warning("ROOT_SQLITE_UNAVAILABLE", "blocked", "session_memory", errorMessage(error), [dbId]);
      session = { section: unavailableSession(resolved.project.key, dbId), warnings: [dbWarning], actions: [] };
      project = { section: unavailableProject(resolved.project.key, dbId), warnings: [warning("ROOT_SQLITE_UNAVAILABLE", "blocked", "project_memory", errorMessage(error), [dbId])], actions: [] };
      sessionContinuity = unavailableSessionCurrentContinuity();
    }
    await this.enrichProviderAvailability(config, session, project);
    const warnings = [...installation.warnings, ...session.warnings, ...project.warnings];
    const actions = [...installation.actions, ...session.actions, ...project.actions];
    return {
      generated_at: generatedAt,
      overall_state: aggregateOverall([installation.section.state, session.section.state, project.section.state]),
      project: { key: resolved.project.key, name: resolved.project.config.name ?? resolved.project.key, repo_paths: resolved.project.config.repo_paths ?? [], resolved_from: resolved.from },
      installation: installation.section,
      session_memory: session.section,
      project_memory: project.section,
      session_continuity: sessionContinuity,
      warnings,
      actions,
      evidence: evidence.all(),
    };
  }

  private async enrichProviderAvailability(
    config: Awaited<ReturnType<typeof loadConfig>>,
    session: Awaited<ReturnType<typeof inspectSessionMemory>>,
    project: Awaited<ReturnType<typeof inspectProjectMemory>>,
  ): Promise<void> {
    const cache = new Map<string, {
      available: boolean;
      state?: "unreachable" | "unavailable";
      reason?: string;
    }>();
    for (const [sectionName, inspection] of [
      ["session_memory", session],
      ["project_memory", project],
    ] as const) {
      const contract = inspection.section.retrieval.active_contract;
      if (!contract) continue;
      const key = `${contract.provider}\0${contract.model}\0${contract.dimensions}\0${contract.format_version}`;
      let availability = cache.get(key);
      if (!availability) {
        try {
          await (this.deps.createEmbeddingFactory?.(config) ?? new EmbeddingProviderFactory(config)).initializeContract({
            provider: contract.provider as "ollama_nomic" | "ollama_qwen" | "gemini",
            model: contract.model,
            dimensions: contract.dimensions,
            purpose: "retrieval_document",
            formatVersion: contract.format_version,
          });
          availability = { available: true };
        } catch (error) {
          availability = {
            available: false,
            state: embeddingProviderFailureKind(error) === "unreachable" ? "unreachable" : "unavailable",
            reason: errorMessage(error),
          };
        }
        cache.set(key, availability);
      }
      inspection.section.retrieval.provider_state = availability.available
        ? "available"
        : availability.state ?? "unavailable";
      if (sectionName === "session_memory") {
        inspection.section.smc = withSMCProviderState(
          inspection.section.smc!,
          inspection.section.retrieval.provider_state,
        );
      }
      if (!availability.available) {
        inspection.section.state = maxState(inspection.section.state, "attention");
        const unreachable = availability.state === "unreachable";
        inspection.warnings.push(warning(
          sectionName === "session_memory"
            ? unreachable ? "SESSION_EMBEDDING_PROVIDER_UNREACHABLE" : "SESSION_EMBEDDING_PROVIDER_UNAVAILABLE"
            : unreachable ? "PROJECT_EMBEDDING_PROVIDER_UNREACHABLE" : "PROJECT_EMBEDDING_PROVIDER_UNAVAILABLE",
          "attention",
          sectionName,
          availability.reason ?? "The active embedding provider is unavailable.",
          inspection.section.evidence_ids,
        ));
      }
    }
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
    maintenance: { enabled: false, lifecycle: "unknown", lock: { lifecycle: "absent", path: `state/${key}/.auto-memory-maintenance.lock`, run_id: null, pid: null }, last_run_id: null, last_log_path: null },
    retrieval: { active_contract: null, desired_contract: null, migration_required: false, provider_state: "not_checked", indexed_count: 0, pending_count: 0, failed_count: 0, historical: { contract_count: 0, row_count: 0 } },
    smc: unavailableSMCStatus(key),
  };
}

function unavailableSMCStatus(key: string): SMCStatusV1 {
  return {
    contract_version: "myelin.smc.status.v1",
    kind: "session_memory_curator_status",
    generated_at: new Date(0).toISOString(),
    project_key: key,
    authority_mode: "legacy_compatibility",
    queued_content: { count: 0, oldest_inserted_at: null, oldest_age_ms: null },
    current_anchor: null,
    project_fence: null,
    global_embedding_fence: null,
    freshness: { state: "blocked", last_completed_at: null, queued_content_count: 0 },
    audit_coverage: { active_revision_count: 0, covered_revision_count: 0, due_revision_count: 0 },
    indexing: {
      state: "unavailable",
      active_memory_count: 0,
      indexed_count: 0,
      pending_count: 0,
      failed_count: 0,
      provider_state: "not_checked",
    },
    legacy: { permanently_denied_job_count: 0 },
    reason_codes: ["smc_authority_not_activated"],
  };
}

function unavailableProject(key: string, evidenceId: string): ProjectMemoryStatusSection {
  return {
    state: "blocked", lifecycle: "storage_unavailable", evidence_ids: [evidenceId],
    inbox: { pending_items: 0 }, candidates: { pending: 0, needs_review: 0 },
    maintenance: { enabled: false, lifecycle: "unknown", lock: { lifecycle: "absent", path: `state/${key}/.auto-project-memory-maintenance.lock`, run_id: null, pid: null }, last_run_id: null, last_log_path: null },
    curation: { lifecycle: "unknown", canonical_wiki_path: `projects/${key}`, latest_run_path: null },
    retrieval: { active_contract: null, desired_contract: null, migration_required: false, provider_state: "not_checked", indexed_count: 0, pending_count: 0, failed_count: 0, historical: { contract_count: 0, row_count: 0 } },
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
