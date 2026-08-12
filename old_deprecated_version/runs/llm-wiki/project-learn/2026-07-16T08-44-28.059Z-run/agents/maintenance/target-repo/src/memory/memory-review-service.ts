import { readdir, stat } from "node:fs/promises";
import { memoryDbPath, openMemoryDb } from "./db.ts";
import type { ExperienceEventTombstoneRow, IngestJobRow } from "./ingest-types.ts";
import { projectRunsPath, resolveInside } from "../runtime/fs.ts";
import { readJsonIfExists } from "../runtime/json.ts";
import type {
  ProjectMemoryAgentCandidateDisposition,
  ProjectMemoryMaintenanceReport,
} from "../project/project-memory-agent-contracts.ts";
import type { MemoryReviewItem, MemoryReviewReport } from "./memory-review-contracts.ts";
export type { MemoryReviewItem, MemoryReviewReport } from "./memory-review-contracts.ts";

const POSITIVE_PROJECT_DISPOSITIONS = new Set<ProjectMemoryAgentCandidateDisposition>([
  "applied_to_project_memory",
  "already_covered",
]);

const FAILURE_PROJECT_DISPOSITIONS = new Set<ProjectMemoryAgentCandidateDisposition>([
  "blocked_by_runner_failure",
]);

export class MemoryReviewService {
  constructor(private readonly root: string) {}

  async reviewProject(input: { projectKey: string; limit?: number; status?: string }): Promise<MemoryReviewReport> {
    const limit = input.limit ?? 100;
    const allItems = [
      ...(await this.projectMemoryDispositionItems(input.projectKey)),
      ...(await this.sqliteItems(input.projectKey)),
    ].filter((item) => !input.status || item.status === input.status).sort(compareReviewItems);
    const items = allItems.slice(0, limit);

    return {
      project_key: input.projectKey,
      reviewable_count: allItems.length,
      returned_count: items.length,
      items,
    };
  }

  private async projectMemoryDispositionItems(projectKey: string): Promise<MemoryReviewItem[]> {
    const runsDir = projectRunsPath(this.root, projectKey, "project-learn");
    let entries: string[];
    try {
      entries = await readdir(runsDir);
    } catch (error) {
      if (isEnoent(error)) return [];
      throw error;
    }

    const items: MemoryReviewItem[] = [];
    for (const entry of entries.sort().reverse()) {
      const runDir = `runs/${projectKey}/project-learn/${entry}`;
      if (!(await isDirectory(resolveInside(this.root, runDir)))) continue;
      const reportRel = `${runDir}/reports/documentation-maintenance-report.json`;
      const reportPath = resolveInside(this.root, reportRel);
      const report = await readJsonIfExists<ProjectMemoryMaintenanceReport>(reportPath);
      if (!report || report.project_key !== projectKey) continue;

      if (report.status === "degraded") {
        items.push({
          kind: "project_memory_run",
          project_key: projectKey,
          run_dir: runDir,
          json_path: reportRel,
          status: "degraded",
          reason: report.known_gaps.join("; ") || "Project Memory maintenance report is degraded.",
        });
      }

      for (const disposition of report.dispositions ?? []) {
        if (!isReviewableProjectDisposition(disposition.disposition)) continue;
        items.push({
          kind: "project_memory_disposition",
          project_key: projectKey,
          run_dir: runDir,
          json_path: reportRel,
          source_kind: disposition.source_kind,
          source_ref: disposition.source_ref,
          status: disposition.disposition,
          reason: disposition.reason,
          output_refs: disposition.output_refs,
        });
      }
    }
    return items;
  }

  private async sqliteItems(projectKey: string): Promise<MemoryReviewItem[]> {
    if (!(await exists(memoryDbPath(this.root)))) return [];
    const db = openMemoryDb(this.root);
    try {
      const items: MemoryReviewItem[] = [];
      const needsFollowupJobs = db
        .query("SELECT * FROM ingest_jobs WHERE project_key = ? AND status = 'needs_followup' ORDER BY updated_at DESC")
        .all(projectKey) as IngestJobRow[];
      for (const job of needsFollowupJobs) {
        items.push({
          kind: "ingest_job",
          project_key: projectKey,
          sqlite_table: "ingest_jobs",
          id: job.id,
          status: "needs_followup",
          reason: job.terminal_summary,
          created_at: job.created_at,
          updated_at: job.updated_at,
        });
      }

      const noOutputTombstones = db
        .query("SELECT * FROM experience_event_tombstones WHERE project_key = ? AND state = 'no_output' ORDER BY claimed_at DESC")
        .all(projectKey) as ExperienceEventTombstoneRow[];
      for (const tombstone of noOutputTombstones) {
        items.push({
          kind: "experience_tombstone",
          project_key: projectKey,
          sqlite_table: "experience_event_tombstones",
          id: tombstone.id,
          original_event_id: tombstone.original_event_id,
          ingest_job_id: tombstone.ingest_job_id,
          status: "no_output",
          terminal_decision: tombstone.terminal_decision,
          claimed_at: tombstone.claimed_at,
          finalized_at: tombstone.finalized_at,
        });
      }

      const rejectedCandidates = db
        .query("SELECT * FROM memory_candidates WHERE project_key = ? AND status = 'rejected' ORDER BY updated_at DESC")
        .all(projectKey) as Array<{
          id: string;
          scope: string;
          title: string | null;
          summary: string;
          reason: string;
          updated_at: string;
        }>;
      for (const candidate of rejectedCandidates) {
        items.push({
          kind: "memory_candidate",
          project_key: projectKey,
          sqlite_table: "memory_candidates",
          id: candidate.id,
          scope: candidate.scope,
          status: "rejected",
          title: candidate.title,
          summary: candidate.summary,
          reason: candidate.reason,
          updated_at: candidate.updated_at,
        });
      }

      for (const scope of ["project", "practice", "personal"] as const) {
        const table = `${scope}_handoff_instructions` as const;
        const handoffs = db
          .query(`SELECT * FROM ${table} WHERE project_key = ? AND status = 'rejected' ORDER BY updated_at DESC`)
          .all(projectKey) as Array<{ id: string; objective: string; reason: string; updated_at: string }>;
        for (const handoff of handoffs) {
          items.push({
            kind: "handoff_instruction",
            project_key: projectKey,
            sqlite_table: table,
            id: handoff.id,
            scope,
            status: "rejected",
            objective: handoff.objective,
            reason: handoff.reason,
            updated_at: handoff.updated_at,
          });
        }
      }

      return items;
    } finally {
      db.close();
    }
  }
}

function isReviewableProjectDisposition(disposition: ProjectMemoryAgentCandidateDisposition): boolean {
  return !POSITIVE_PROJECT_DISPOSITIONS.has(disposition) && !FAILURE_PROJECT_DISPOSITIONS.has(disposition);
}

function compareReviewItems(left: MemoryReviewItem, right: MemoryReviewItem): number {
  return itemTime(right).localeCompare(itemTime(left)) || left.kind.localeCompare(right.kind);
}

function itemTime(item: MemoryReviewItem): string {
  if ("updated_at" in item) return item.updated_at;
  if ("claimed_at" in item) return item.claimed_at;
  if ("run_dir" in item) return item.run_dir;
  return "";
}

async function exists(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch (error) {
    if (isEnoent(error)) return false;
    throw error;
  }
}

async function isDirectory(path: string): Promise<boolean> {
  try {
    return (await stat(path)).isDirectory();
  } catch (error) {
    if (isEnoent(error)) return false;
    throw error;
  }
}

function isEnoent(error: unknown): boolean {
  return Boolean(error && typeof error === "object" && "code" in error && error.code === "ENOENT");
}
