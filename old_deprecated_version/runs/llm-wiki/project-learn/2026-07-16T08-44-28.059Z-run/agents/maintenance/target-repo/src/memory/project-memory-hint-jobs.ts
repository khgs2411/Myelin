import { createHash } from "node:crypto";
import type { Database } from "bun:sqlite";

export type ProjectMemoryHintJobStatus = "pending" | "running" | "completed" | "failed" | "skipped";

export type ProjectMemoryHintJobRow = {
  id: string;
  project_key: string;
  category: string | null;
  status: ProjectMemoryHintJobStatus;
  required: 0 | 1;
  section_refs_json: string;
  provider: string | null;
  model: string | null;
  run_ref: string | null;
  failure_reason: string | null;
  created_at: string;
  updated_at: string;
  completed_at: string | null;
};

export function createProjectMemoryHintJob(
  db: Database,
  input: {
    project_key: string;
    category: string | null;
    required: boolean;
    section_refs: string[];
    provider?: string;
    model?: string;
    now: string;
  },
): ProjectMemoryHintJobRow {
  const id = hintJobId(input.project_key, input.category, input.section_refs, input.now);
  db.query(
    `INSERT INTO project_memory_hint_jobs
      (id, project_key, category, status, required, section_refs_json, provider, model, run_ref,
       failure_reason, created_at, updated_at, completed_at)
     VALUES (?, ?, ?, 'pending', ?, ?, ?, ?, NULL, NULL, ?, ?, NULL)`,
  ).run(
    id,
    input.project_key,
    input.category,
    input.required ? 1 : 0,
    JSON.stringify(input.section_refs),
    input.provider ?? null,
    input.model ?? null,
    input.now,
    input.now,
  );
  return getProjectMemoryHintJob(db, id);
}

export function markProjectMemoryHintJobRunning(
  db: Database,
  input: { id: string; run_ref: string; provider?: string; model?: string; now: string },
): ProjectMemoryHintJobRow {
  db.query(
    `UPDATE project_memory_hint_jobs
     SET status = 'running',
         run_ref = ?,
         provider = COALESCE(?, provider),
         model = COALESCE(?, model),
         failure_reason = NULL,
         updated_at = ?
     WHERE id = ?`,
  ).run(input.run_ref, input.provider ?? null, input.model ?? null, input.now, input.id);
  return getProjectMemoryHintJob(db, input.id);
}

export function markProjectMemoryHintJobCompleted(
  db: Database,
  input: { id: string; run_ref: string; now: string },
): ProjectMemoryHintJobRow {
  db.query(
    `UPDATE project_memory_hint_jobs
     SET status = 'completed',
         run_ref = ?,
         failure_reason = NULL,
         updated_at = ?,
         completed_at = ?
     WHERE id = ?`,
  ).run(input.run_ref, input.now, input.now, input.id);
  return getProjectMemoryHintJob(db, input.id);
}

export function markProjectMemoryHintJobFailed(
  db: Database,
  input: { id: string; failure_reason: string; now: string },
): ProjectMemoryHintJobRow {
  db.query(
    `UPDATE project_memory_hint_jobs
     SET status = 'failed',
         failure_reason = ?,
         updated_at = ?
     WHERE id = ?`,
  ).run(input.failure_reason, input.now, input.id);
  return getProjectMemoryHintJob(db, input.id);
}

export function listProjectMemoryHintJobs(
  db: Database,
  input: { project_key: string; status?: ProjectMemoryHintJobStatus },
): ProjectMemoryHintJobRow[] {
  if (input.status) {
    return db
      .query("SELECT * FROM project_memory_hint_jobs WHERE project_key = ? AND status = ? ORDER BY created_at ASC, id ASC")
      .all(input.project_key, input.status) as ProjectMemoryHintJobRow[];
  }
  return db
    .query("SELECT * FROM project_memory_hint_jobs WHERE project_key = ? ORDER BY created_at ASC, id ASC")
    .all(input.project_key) as ProjectMemoryHintJobRow[];
}

export function getProjectMemoryHintJob(db: Database, id: string): ProjectMemoryHintJobRow {
  const row = db.query("SELECT * FROM project_memory_hint_jobs WHERE id = ?").get(id) as ProjectMemoryHintJobRow | null;
  if (!row) throw new Error(`Project Memory hint job not found: ${id}`);
  return row;
}

function hintJobId(projectKey: string, category: string | null, sectionRefs: string[], now: string): string {
  const hash = createHash("sha256")
    .update([projectKey, category ?? "", ...sectionRefs.sort(), now].join("|"), "utf8")
    .digest("hex")
    .slice(0, 24);
  return `pmh_${hash}`;
}
