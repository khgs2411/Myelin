import { Database } from "bun:sqlite";
import { copyFileSync, existsSync, mkdtempSync, rmSync } from "node:fs";
import { readFile, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { isAbsolute, join } from "node:path";
import type { AutoMemoryMaintenanceConfig, EmbeddingConfig } from "../runtime/config.ts";
import { configureBunSQLite } from "../memory/sqlite-runtime.ts";
import type { EvidenceRegistry, SessionMemoryStatusSection, StatusInspection } from "./contracts.ts";
import { inspectLock, type MaintenanceStateRecord } from "./lock-inspector.ts";
import { maxState, sessionRetrievalState, warning } from "./severity.ts";
import { inspectEmbeddingRetrievalStatus } from "./embedding-retrieval-status.ts";
import { memoryDbPath } from "../memory/db.ts";
import { normalizeRecordedCheckoutPath, projectStatePath } from "../runtime/fs.ts";

const REQUIRED_TABLES = ["experience_events", "experience_event_tombstones", "ingest_jobs", "session_memories", "session_memory_embeddings", "memory_candidates", "project_memory_retrieval_embeddings"];

export type StatusDatabaseSnapshot = {
  db: Database;
  close(): void;
};

export function openStatusDatabase(root: string): StatusDatabaseSnapshot {
  configureBunSQLite(root);
  const sourcePath = memoryDbPath(root);
  if (!existsSync(sourcePath)) throw new Error(`Root SQLite database is missing at ${sourcePath}.`);
  const snapshotDir = mkdtempSync(join(tmpdir(), "myelin-status-snapshot-"));
  const snapshotPath = join(snapshotDir, "memory.db");
  copyFileSync(sourcePath, snapshotPath);
  for (const suffix of ["-wal", "-shm"]) {
    if (existsSync(`${sourcePath}${suffix}`)) copyFileSync(`${sourcePath}${suffix}`, `${snapshotPath}${suffix}`);
  }
  const db = new Database(snapshotPath, { readonly: true });
  try {
    db.exec("PRAGMA query_only = ON;");
    const tables = new Set((db.query("SELECT name FROM sqlite_master WHERE type = 'table'").all() as Array<{ name: string }>).map((row) => row.name));
    const missing = REQUIRED_TABLES.filter((table) => !tables.has(table));
    if (missing.length > 0) throw new Error(`Missing required SQLite tables: ${missing.join(", ")}`);
    return {
      db,
      close() {
        db.close();
        rmSync(snapshotDir, { recursive: true, force: true });
      },
    };
  } catch (error) {
    db.close();
    rmSync(snapshotDir, { recursive: true, force: true });
    throw error;
  }
}

export async function inspectSessionMemory(input: {
  root: string;
  projectKey: string;
  db: Database;
  config: AutoMemoryMaintenanceConfig;
  embeddingConfig: EmbeddingConfig;
  evidence: EvidenceRegistry;
  isAlive: (pid: number) => boolean;
}): Promise<{ section: SessionMemoryStatusSection } & StatusInspection> {
  const dbId = input.evidence.add("sqlite", memoryDbPath(input.root));
  const statePath = projectStatePath(input.root, input.projectKey, "auto-memory-maintenance.json");
  const lockPath = projectStatePath(input.root, input.projectKey, ".auto-memory-maintenance.lock");
  const stateRead = await readOptionalState(statePath);
  const stateId = input.evidence.add("file", statePath);
  const lockId = input.evidence.add("file", join(lockPath, "owner.json"));
  const lock = await inspectLock({ root: input.root, lockPath, state: stateRead.state, isAlive: input.isAlive });
  const warnings = [] as ReturnType<typeof warning>[];
  const actions: StatusInspection["actions"] = [];

  const counts = queueCounts(input.db, input.projectKey);
  const jobs = input.db.query("SELECT id, status, followup_state_json, error_json, created_at, updated_at FROM ingest_jobs WHERE project_key = ? AND status IN ('running','failed') ORDER BY updated_at DESC, id DESC").all(input.projectKey) as JobRow[];
  const leasesByJob = new Map((input.db.query("SELECT ingest_job_id AS id, count(*) AS count FROM experience_event_tombstones WHERE project_key = ? AND state = 'claimed' GROUP BY ingest_job_id").all(input.projectKey) as Array<{ id: string | null; count: number }>).map((row) => [row.id, row.count]));
  let jobState: "healthy" | "attention" | "blocked" = "healthy";
  let hasLiveJob = false;
  let latestLog: string | null = null;
  for (const job of jobs) {
    const followup = jsonObject(job.followup_state_json);
    const error = jsonObject(job.error_json);
    latestLog ??= normalizeRecordedCheckoutPath(input.root, stringValue(followup?.log_path) ?? stringValue(error?.log_path));
    const pid = numberValue(followup?.pid);
    const leased = leasesByJob.get(job.id) ?? 0;
    if (job.status === "running") {
      if (pid === null) {
        jobState = maxState(jobState, "attention");
        warnings.push(warning("SESSION_JOB_RUNNING_UNVERIFIABLE", "attention", "session_memory", "A running ingest job has no observable PID.", [dbId]));
      } else if (input.isAlive(pid)) {
        hasLiveJob = true;
      } else {
        const severity = leased > 0 ? "blocked" : "attention";
        jobState = maxState(jobState, severity);
        warnings.push(warning("SESSION_JOB_OWNER_DEAD", severity, "session_memory", "A recorded ingest worker is not alive.", [dbId]));
      }
    } else if (job.status === "failed") {
      const severity = leased > 0 ? "blocked" : "attention";
      jobState = maxState(jobState, severity);
      warnings.push(warning("SESSION_INGEST_JOB_FAILED", severity, "session_memory", "An ingest job failed.", [dbId]));
    }
  }

  if (stateRead.error) warnings.push(warning("SESSION_MAINTENANCE_STATE_MALFORMED", "attention", "session_memory", stateRead.error, [stateId]));
  if (lock.state === "blocked") warnings.push(warning("SESSION_MAINTENANCE_STALE_LOCK", "blocked", "session_memory", lock.reason ?? "Maintenance lock is stale.", [lockId, stateId]));
  const maintenanceFailureState = stateRead.state?.last_status === "failed" ? (counts.leased > 0 ? "blocked" : "attention") : "healthy";
  if (maintenanceFailureState !== "healthy") warnings.push(warning("SESSION_MAINTENANCE_FAILED", maintenanceFailureState, "session_memory", "The latest Session Memory maintenance run failed.", [stateId]));
  const maintenanceActive = lock.lock.lifecycle === "active";
  if (counts.queued >= input.config.minCapturedEvents && !hasLiveJob && !maintenanceActive) {
    warnings.push(warning("SESSION_QUEUE_UNOWNED", "attention", "session_memory", "Capture queue reached the maintenance threshold without a live owner.", [dbId]));
    actions.push({ command: `myelin ingest ${input.projectKey}`, reason: "Drain queued Experience Log rows.", section: "session_memory" });
  }
  if (!input.config.enabled && counts.queued > 0) warnings.push(warning("SESSION_MAINTENANCE_DISABLED", "attention", "session_memory", "Automatic Session Memory maintenance is disabled with queued work.", [stateId]));
  let logState: "healthy" | "attention" = "healthy";
  for (const logPath of [latestLog, normalizeRecordedCheckoutPath(input.root, stateRead.state?.last_log_path ?? null)]) {
    if (logPath && !(await exists(resolveCheckoutPath(input.root, logPath)))) {
      logState = "attention";
      warnings.push(warning("SESSION_REFERENCED_LOG_MISSING", "attention", "session_memory", `Referenced log is missing: ${logPath}`, [stateId]));
    }
  }

  const retrieval = inspectEmbeddingRetrievalStatus({
    db: input.db,
    projectKey: input.projectKey,
    scope: "session_memory",
    config: input.embeddingConfig,
  });
  const retrievalState = sessionRetrievalState(
    retrieval.active_memory_count,
    retrieval.indexed_count,
    retrieval.pending_count,
    retrieval.failed_count,
  );
  if (retrievalState !== "healthy") {
    warnings.push(warning("SESSION_RETRIEVAL_UNAVAILABLE", retrievalState, "session_memory", retrieval.indexed_count === 0 ? "Active Session Memory has no usable index." : "Session Memory retrieval has pending or failed rows.", [dbId]));
    actions.push({ command: `myelin memory index session ${input.projectKey}`, reason: "Build or repair Session Memory retrieval.", section: "session_memory" });
  }
  if (retrieval.migration_required) {
    warnings.push(warning("SESSION_EMBEDDING_MIGRATION_REQUIRED", "attention", "session_memory", "Configured Session Memory embedding contract differs from the active contract.", [dbId]));
    actions.push({ command: "myelin memory embeddings migrate", reason: "Preview the configured embedding-contract migration.", section: "session_memory" });
  }
  const queueState = counts.queued >= input.config.minCapturedEvents && !hasLiveJob && !maintenanceActive ? "attention" : "healthy";
  const disabledState = !input.config.enabled && counts.queued > 0 ? "attention" : "healthy";
  const malformedState = stateRead.error ? "attention" : "healthy";
  const migrationState = retrieval.migration_required ? "attention" : "healthy";
  const state = maxState(jobState, lock.state, retrievalState, migrationState, queueState, disabledState, malformedState, maintenanceFailureState, logState);
  const lifecycle = lock.lock.lifecycle === "stale" ? "stale_lock" : retrievalState === "blocked" ? "retrieval_unavailable" : state === "attention" ? "attention" : "ready";
  return {
    section: {
      state, lifecycle, evidence_ids: [dbId, stateId, lockId],
      capture: { queued_events: counts.queued, unleased_events: counts.unleased, leased_events: counts.leased },
      ingest: { running_jobs: jobs.filter((job) => job.status === "running").length, failed_jobs: jobs.filter((job) => job.status === "failed").length, terminal_tombstones: counts.terminal, latest_log_path: latestLog },
      maintenance: { enabled: input.config.enabled, lifecycle: lock.lock.lifecycle === "active" ? "running" : lock.lock.lifecycle === "stale" ? "stale_lock" : stateRead.state?.last_status ?? "never_run", lock: lock.lock, last_run_id: stateRead.state?.last_run_id ?? null, last_log_path: normalizeRecordedCheckoutPath(input.root, stateRead.state?.last_log_path ?? null) },
      retrieval,
    }, warnings, actions,
  };
}

function queueCounts(db: Database, key: string): { queued: number; leased: number; unleased: number; terminal: number } {
  const queued = scalar(db, "SELECT count(*) AS count FROM experience_events WHERE project_key = ?", key);
  const leased = scalar(db, "SELECT count(*) AS count FROM experience_event_tombstones t JOIN experience_events e ON e.id=t.original_event_id AND e.project_key=t.project_key WHERE t.project_key=? AND t.state='claimed'", key);
  const terminal = scalar(db, "SELECT count(*) AS count FROM experience_event_tombstones WHERE project_key=? AND state IN ('output','no_output','failed','unfinished')", key);
  return { queued, leased, unleased: Math.max(0, queued - leased), terminal };
}

async function readOptionalState(path: string): Promise<{ state: MaintenanceStateRecord | null; error: string | null }> {
  try {
    const parsed = JSON.parse(await readFile(path, "utf8")) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("state is not an object");
    return { state: parsed as MaintenanceStateRecord, error: null };
  } catch (error) {
    if (hasCode(error, "ENOENT")) return { state: null, error: null };
    return { state: null, error: `Cannot read maintenance state: ${message(error)}` };
  }
}

type JobRow = { id: string; status: "running" | "failed"; followup_state_json: string | null; error_json: string | null; created_at: string; updated_at: string };
function scalar(db: Database, sql: string, value: string): number { return (db.query(sql).get(value) as { count: number }).count; }
function jsonObject(value: string | null): Record<string, unknown> | null { try { const parsed = value ? JSON.parse(value) : null; return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : null; } catch { return null; } }
function stringValue(value: unknown): string | null { return typeof value === "string" ? value : null; }
function numberValue(value: unknown): number | null { return Number.isInteger(value) && Number(value) > 0 ? Number(value) : null; }
function resolveCheckoutPath(root: string, value: string): string { return isAbsolute(value) ? value : join(root, value); }
async function exists(path: string): Promise<boolean> { try { await stat(path); return true; } catch { return false; } }
function hasCode(error: unknown, code: string): boolean { return Boolean(error && typeof error === "object" && "code" in error && error.code === code); }
function message(error: unknown): string { return error instanceof Error ? error.message : String(error); }
