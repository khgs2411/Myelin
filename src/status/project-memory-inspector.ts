import type { Database } from "bun:sqlite";
import { readFile, readdir, stat } from "node:fs/promises";
import { basename, isAbsolute, join, relative } from "node:path";
import type { AutoProjectMemoryMaintenanceConfig } from "../runtime/config.ts";
import type { EvidenceRegistry, ProjectMemoryStatusSection, StatusInspection } from "./contracts.ts";
import { inspectLock, type MaintenanceStateRecord } from "./lock-inspector.ts";
import { maxState, projectRetrievalState, warning } from "./severity.ts";

export async function inspectProjectMemory(input: {
  root: string;
  projectKey: string;
  db: Database;
  config: AutoProjectMemoryMaintenanceConfig;
  evidence: EvidenceRegistry;
  isAlive: (pid: number) => boolean;
}): Promise<{ section: ProjectMemoryStatusSection } & StatusInspection> {
  const dbId = input.evidence.add("sqlite", join(input.root, "state", "memory.db"));
  const statePath = join(input.root, "projects", input.projectKey, "state", "auto-project-memory-maintenance.json");
  const lockPath = join(input.root, "projects", input.projectKey, "state", ".auto-project-memory-maintenance.lock");
  const projectMemoryPath = join(input.root, "projects", input.projectKey, "state", "project-memory.json");
  const wikiPath = join(input.root, "projects", input.projectKey, "wiki");
  const maintenanceRead = await readOptionalObject<MaintenanceStateRecord>(statePath);
  const stateId = input.evidence.add("file", statePath);
  const lockId = input.evidence.add("file", join(lockPath, "owner.json"));
  const projectStateId = input.evidence.add("file", projectMemoryPath);
  const lock = await inspectLock({ root: input.root, lockPath, state: maintenanceRead.value, isAlive: input.isAlive });
  const warnings = [] as ReturnType<typeof warning>[];
  const actions: StatusInspection["actions"] = [];

  const inbox = await countPendingInbox(input.root, input.projectKey, input.db);
  const pending = scalar(input.db, "SELECT count(*) AS count FROM memory_candidates WHERE project_key=? AND scope='project' AND status='pending'", input.projectKey);
  const needsReview = scalar(input.db, "SELECT count(*) AS count FROM memory_candidates WHERE project_key=? AND scope='project' AND status='needs_review'", input.projectKey);
  if (inbox.error) warnings.push(warning("PROJECT_INBOX_UNREADABLE", "blocked", "project_memory", inbox.error, [projectStateId]));
  if (needsReview > 0) warnings.push(warning("PROJECT_CANDIDATES_NEED_REVIEW", "attention", "project_memory", "Project Memory candidates need review.", [dbId]));
  if (maintenanceRead.error) warnings.push(warning("PROJECT_MAINTENANCE_STATE_MALFORMED", "attention", "project_memory", maintenanceRead.error, [stateId]));
  if (lock.state === "blocked") warnings.push(warning("PROJECT_MAINTENANCE_STALE_LOCK", "blocked", "project_memory", lock.reason ?? "Project maintenance lock is stale.", [lockId, stateId]));
  const maintenanceFailureState = maintenanceRead.value?.last_status === "failed" ? "attention" : "healthy";
  if (maintenanceFailureState === "attention") warnings.push(warning("PROJECT_MAINTENANCE_FAILED", "attention", "project_memory", "The latest Project Memory maintenance run failed.", [stateId]));
  const pressure = inbox.count + pending + needsReview;
  if (pressure >= input.config.minPendingItems && lock.lock.lifecycle !== "active") {
    warnings.push(warning("PROJECT_MAINTENANCE_UNOWNED", "attention", "project_memory", "Project Memory maintenance threshold is reached without a live owner.", [dbId, stateId]));
    actions.push({ command: `myelin memory maintain project ${input.projectKey}`, reason: "Process pending Project Memory inputs.", section: "project_memory" });
  }
  if (!input.config.enabled && pressure > 0) warnings.push(warning("PROJECT_MAINTENANCE_DISABLED", "attention", "project_memory", "Automatic Project Memory maintenance is disabled with pending work.", [stateId]));
  let logState: "healthy" | "attention" = "healthy";
  const recordedLog = checkoutPath(input.root, maintenanceRead.value?.last_log_path ?? null);
  if (recordedLog && !(await exists(resolveCheckoutPath(input.root, recordedLog)))) {
    logState = "attention";
    warnings.push(warning("PROJECT_REFERENCED_LOG_MISSING", "attention", "project_memory", `Referenced log is missing: ${recordedLog}`, [stateId]));
  }

  const curationRead = await readOptionalObject<Record<string, unknown>>(projectMemoryPath);
  let curationState: "healthy" | "attention" | "blocked" = "attention";
  let curationLifecycle = "not_curated";
  let latestRun: string | null = null;
  let curated = false;
  if (curationRead.error) {
    curationState = "blocked";
    curationLifecycle = "invalid_state";
    warnings.push(warning("PROJECT_CURATION_STATE_INVALID", "blocked", "project_memory", curationRead.error, [projectStateId]));
  } else if (curationRead.value) {
    latestRun = stringValue(curationRead.value.source_run_dir);
    if (curationRead.value.status === "curated") {
      curated = true;
      if (await readableWiki(wikiPath)) {
        curationState = "healthy";
        curationLifecycle = "curated";
      } else {
        curationState = "blocked";
        curationLifecycle = "canonical_wiki_missing";
        warnings.push(warning("PROJECT_CANONICAL_WIKI_MISSING", "blocked", "project_memory", "Project Memory claims curated state but canonical wiki is unavailable.", [projectStateId]));
      }
    } else {
      curationState = "blocked";
      curationLifecycle = "curation_failed";
      warnings.push(warning("PROJECT_CURATION_NOT_READY", "blocked", "project_memory", "Project Memory state is not curated.", [projectStateId]));
    }
  }

  const retrieval = retrievalCounts(input.db, input.projectKey);
  const retrievalState = projectRetrievalState(curated, retrieval.indexed, retrieval.pending, retrieval.failed);
  if (retrievalState !== "healthy") {
    warnings.push(warning("PROJECT_RETRIEVAL_UNAVAILABLE", retrievalState, "project_memory", retrieval.indexed === 0 ? "Curated Project Memory has no usable index." : "Project Memory retrieval has pending or failed rows.", [dbId, projectStateId]));
    actions.push({ command: `myelin project learn ${input.projectKey}`, reason: "Rebuild Project Memory retrieval state.", section: "project_memory" });
  }
  const pressureState = needsReview > 0 || (pressure >= input.config.minPendingItems && lock.lock.lifecycle !== "active") || (!input.config.enabled && pressure > 0) ? "attention" : "healthy";
  const state = maxState(inbox.error ? "blocked" : "healthy", lock.state, maintenanceRead.error ? "attention" : "healthy", maintenanceFailureState, pressureState, curationState, retrievalState, logState);
  const lifecycle = lock.lock.lifecycle === "stale" ? "stale_lock" : curationState === "blocked" ? curationLifecycle : retrievalState === "blocked" ? "retrieval_unavailable" : state === "attention" ? "attention" : "ready";
  return {
    section: {
      state, lifecycle, evidence_ids: [dbId, stateId, lockId, projectStateId],
      inbox: { pending_items: inbox.count }, candidates: { pending, needs_review: needsReview },
      maintenance: { enabled: input.config.enabled, lifecycle: lock.lock.lifecycle === "active" ? "running" : lock.lock.lifecycle === "stale" ? "stale_lock" : maintenanceRead.value?.last_status ?? "never_run", lock: lock.lock, last_run_id: maintenanceRead.value?.last_run_id ?? null, last_log_path: checkoutPath(input.root, maintenanceRead.value?.last_log_path ?? null) },
      curation: { lifecycle: curationLifecycle, canonical_wiki_path: `projects/${input.projectKey}/wiki`, latest_run_path: latestRun },
      retrieval: { indexed_count: retrieval.indexed, pending_count: retrieval.pending, failed_count: retrieval.failed },
    }, warnings, actions,
  };
}

async function countPendingInbox(root: string, key: string, db: Database): Promise<{ count: number; error: string | null }> {
  const dir = join(root, "projects", key, "sources", "inbox");
  let entries: string[];
  try { entries = await readdir(dir); } catch (error) {
    if (hasCode(error, "ENOENT")) return { count: 0, error: null };
    return { count: 0, error: `Cannot read runtime inbox: ${message(error)}` };
  }
  let count = 0;
  for (const entry of entries) {
    if (!/^\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}(?:\.\d{3})?Z_[0-9a-f]{6}\.json$/.test(entry)) continue;
    const id = basename(entry, ".json");
    const candidate = db.query("SELECT 1 AS found FROM memory_candidates WHERE id=? AND project_key=?").get(`project_inbox:${key}:${id}`, key);
    if (!candidate) count += 1;
  }
  return { count, error: null };
}

async function readOptionalObject<T extends object>(path: string): Promise<{ value: T | null; error: string | null }> {
  try {
    const parsed = JSON.parse(await readFile(path, "utf8")) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("value is not an object");
    return { value: parsed as T, error: null };
  } catch (error) {
    if (hasCode(error, "ENOENT")) return { value: null, error: null };
    return { value: null, error: `Cannot read ${path}: ${message(error)}` };
  }
}

async function readableWiki(path: string): Promise<boolean> {
  try { return (await stat(path)).isDirectory() && (await readdir(path)).some((entry) => entry.endsWith(".md")); } catch { return false; }
}
function retrievalCounts(db: Database, key: string): { indexed: number; pending: number; failed: number } {
  return {
    indexed: scalar(db, "SELECT count(*) AS count FROM project_memory_retrieval_embeddings WHERE project_key=? AND status='indexed'", key),
    pending: scalar(db, "SELECT count(*) AS count FROM project_memory_retrieval_embeddings WHERE project_key=? AND status IN ('pending','stale','orphaned')", key),
    failed: scalar(db, "SELECT count(*) AS count FROM project_memory_retrieval_embeddings WHERE project_key=? AND status='failed'", key),
  };
}
function scalar(db: Database, sql: string, value: string): number { return (db.query(sql).get(value) as { count: number }).count; }
function stringValue(value: unknown): string | null { return typeof value === "string" ? value : null; }
function checkoutPath(root: string, value: string | null): string | null { return value && isAbsolute(value) ? relative(root, value) : value; }
function resolveCheckoutPath(root: string, value: string): string { return isAbsolute(value) ? value : join(root, value); }
async function exists(path: string): Promise<boolean> { try { await stat(path); return true; } catch { return false; } }
function hasCode(error: unknown, code: string): boolean { return Boolean(error && typeof error === "object" && "code" in error && error.code === code); }
function message(error: unknown): string { return error instanceof Error ? error.message : String(error); }
