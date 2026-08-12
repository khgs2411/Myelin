import type { Database } from "bun:sqlite";
import { openMemoryDb, type MemoryDb } from "../memory/db.ts";
import type { IngestJobRow, IngestJobStatus } from "../memory/ingest-types.ts";
import { updateIngestJobStatus } from "./jobs.ts";

export type IngestJobAdminServiceDeps = {
  db?: Database;
  now?: () => Date;
};

export type ResolveFailedJobsResult = {
  dry_run: boolean;
  resolved: IngestJobRow[];
};

export class IngestJobAdminService {
  constructor(private readonly root: string, private readonly deps: IngestJobAdminServiceDeps = {}) {}

  list(input: { projectKey: string; status?: IngestJobStatus; limit?: number }): { jobs: IngestJobRow[] } {
    return this.withDb((db) => {
      const limit = input.limit ?? 50;
      const jobs = input.status
        ? (db
            .query(
              `SELECT *
               FROM ingest_jobs
               WHERE project_key = ?
                 AND status = ?
               ORDER BY created_at DESC, id DESC
               LIMIT ?`,
            )
            .all(input.projectKey, input.status, limit) as IngestJobRow[])
        : (db
            .query(
              `SELECT *
               FROM ingest_jobs
               WHERE project_key = ?
               ORDER BY created_at DESC, id DESC
               LIMIT ?`,
            )
            .all(input.projectKey, limit) as IngestJobRow[]);
      return { jobs };
    });
  }

  resolveFailed(input: {
    projectKey: string;
    ids?: string[];
    errorCode?: string;
    reason: string;
    dryRun?: boolean;
  }): ResolveFailedJobsResult {
    return this.withDb((db) => {
      const candidates = this.listFailedCandidates(db, input.projectKey, input.ids ?? []);
      const matched = input.errorCode
        ? candidates.filter((job) => errorCode(job.error_json) === input.errorCode)
        : candidates;
      if (input.dryRun) return { dry_run: true, resolved: matched };

      const now = (this.deps.now ?? (() => new Date()))().toISOString();
      const resolved = matched.map((job) =>
        updateIngestJobStatus(db, {
          id: job.id,
          status: "completed",
          updated_at: now,
          terminal_summary: `Resolved failed ingest job: ${input.reason}`,
          error: null,
          followup_state: {
            ...jsonObject(job.followup_state_json),
            resolved_failed_job: {
              resolved_at: now,
              reason: input.reason,
              previous_error: jsonObject(job.error_json),
            },
          },
        }),
      );
      return { dry_run: false, resolved };
    });
  }

  private listFailedCandidates(db: Database, projectKey: string, ids: string[]): IngestJobRow[] {
    if (ids.length === 0) {
      return db
        .query(
          `SELECT *
           FROM ingest_jobs
           WHERE project_key = ?
             AND status = 'failed'
           ORDER BY created_at ASC, id ASC`,
        )
        .all(projectKey) as IngestJobRow[];
    }

    const placeholders = ids.map(() => "?").join(", ");
    return db
      .query(
        `SELECT *
         FROM ingest_jobs
         WHERE project_key = ?
           AND status = 'failed'
           AND id IN (${placeholders})
         ORDER BY created_at ASC, id ASC`,
      )
      .all(projectKey, ...ids) as IngestJobRow[];
  }

  private withDb<T>(fn: (db: MemoryDb | Database) => T): T {
    if (this.deps.db) return fn(this.deps.db);
    const db = openMemoryDb(this.root);
    try {
      return fn(db);
    } finally {
      db.close();
    }
  }
}

export function ingestJobErrorCode(job: IngestJobRow): string | null {
  return errorCode(job.error_json);
}

function errorCode(value: string | null): string | null {
  const parsed = jsonObject(value);
  const code = parsed.code;
  return typeof code === "string" && code.trim() !== "" ? code : null;
}

function jsonObject(value: string | null): Record<string, unknown> {
  if (!value) return {};
  try {
    const parsed = JSON.parse(value) as unknown;
    return parsed !== null && typeof parsed === "object" && !Array.isArray(parsed) ? (parsed as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

