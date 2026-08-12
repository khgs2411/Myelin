import type { Database } from "bun:sqlite";
import { openMemoryDb, type MemoryDb } from "../memory/db.ts";
import type { IngestJobRow, IngestJobStatus, SessionMemoryAnchorJobRow } from "../memory/ingest-types.ts";
import { updateIngestJobStatus } from "./jobs.ts";
import {
  abandonSessionMaintenanceAnchor,
  type AbandonSessionMaintenanceResult,
} from "../session-maintenance/abandonment-service.ts";
import {
  beginSessionMaintenanceCoordinatorResume,
  type BeginSMCResumeResult,
  type SMCCoordinatorLauncher,
} from "../session-maintenance/recovery-service.ts";
import type { SMCResolvedInvocationIdentity } from "../session-maintenance/evidence-selection.ts";
import {
  cleanupSessionMaintenanceForensics,
  type CleanupSessionMaintenanceForensicsResult,
} from "../session-maintenance/forensic-cleanup-service.ts";
import {
  launchDetachedSMCCompanionWorker,
  type DetachedSpawner,
} from "./runtime.ts";
import type { LaunchContext } from "../runtime/launch-context.ts";

export type IngestJobAdminServiceDeps = {
  db?: Database;
  now?: () => Date;
  smcCoordinator?: SMCCoordinatorLauncher;
  spawn?: DetachedSpawner;
  context?: LaunchContext;
  env?: NodeJS.ProcessEnv;
};

export type ResolveFailedJobsResult = {
  dry_run: boolean;
  resolved: IngestJobRow[];
};

export type IngestJobAdminRow = IngestJobRow & {
  anchor: SessionMemoryAnchorJobRow | null;
  permanently_denied_legacy_identity: boolean;
};

export class IngestJobAdminService {
  constructor(private readonly root: string, private readonly deps: IngestJobAdminServiceDeps = {}) {}

  list(input: { projectKey: string; status?: IngestJobStatus; limit?: number }): { jobs: IngestJobAdminRow[] } {
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
      return { jobs: jobs.map((job) => ({
        ...job,
        anchor: (db.query("SELECT * FROM session_memory_anchor_jobs WHERE job_id = ?").get(job.id) as SessionMemoryAnchorJobRow | null) ?? null,
        permanently_denied_legacy_identity: Boolean(db.query(
          "SELECT 1 FROM legacy_session_job_deny_identities WHERE job_id = ?",
        ).get(job.id)),
      })) };
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

  resumeSessionMaintenance(input: {
    jobId: string;
    projectKey: string;
    expectedOwnerEpoch: number;
    attemptId: string;
    invocation: SMCResolvedInvocationIdentity;
  }): BeginSMCResumeResult {
    const coordinator = this.deps.smcCoordinator ?? ((launch) => {
      launchDetachedSMCCompanionWorker({
        root: this.root,
        projectKey: launch.project_key,
        jobId: launch.job_id,
        targetRepo: launch.target_repo,
        spawn: this.deps.spawn,
        context: this.deps.context,
        env: this.deps.env,
      });
    });
    return this.withDb((db) => beginSessionMaintenanceCoordinatorResume(db, {
      job_id: input.jobId,
      project_key: input.projectKey,
      expected_owner_epoch: input.expectedOwnerEpoch,
      attempt_id: input.attemptId,
      invocation: input.invocation,
      now: (this.deps.now ?? (() => new Date()))().toISOString(),
      coordinator,
    }));
  }

  abandonSessionMaintenance(input: {
    jobId: string;
    projectKey: string;
    expectedOwnerEpoch: number;
    receiptId: string;
    requestId: string;
    operatorId: string;
    reason: string;
  }): AbandonSessionMaintenanceResult {
    return this.withDb((db) => abandonSessionMaintenanceAnchor(db, {
      job_id: input.jobId,
      project_key: input.projectKey,
      expected_owner_epoch: input.expectedOwnerEpoch,
      receipt_id: input.receiptId,
      request_id: input.requestId,
      operator_id: input.operatorId,
      reason: input.reason,
      now: (this.deps.now ?? (() => new Date()))().toISOString(),
    }));
  }

  cleanupSessionMaintenanceForensics(input: {
    jobId: string;
    projectKey: string;
    expectedOwnerEpoch: number;
    terminalReceiptDigest: string;
    forensicRetentionMs: number | null;
  }): CleanupSessionMaintenanceForensicsResult {
    return this.withDb((db) => cleanupSessionMaintenanceForensics(db, {
      job_id: input.jobId,
      project_key: input.projectKey,
      expected_owner_epoch: input.expectedOwnerEpoch,
      terminal_receipt_digest: input.terminalReceiptDigest,
      now: (this.deps.now ?? (() => new Date()))(),
      forensic_retention_ms: input.forensicRetentionMs,
    }));
  }

  private listFailedCandidates(db: Database, projectKey: string, ids: string[]): IngestJobRow[] {
    if (ids.length === 0) {
      return db
        .query(
          `SELECT *
           FROM ingest_jobs
           WHERE project_key = ?
             AND status = 'failed'
             AND NOT EXISTS (SELECT 1 FROM session_memory_anchor_jobs a WHERE a.job_id = ingest_jobs.id)
             AND NOT EXISTS (SELECT 1 FROM legacy_session_job_deny_identities d WHERE d.job_id = ingest_jobs.id)
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
           AND NOT EXISTS (SELECT 1 FROM session_memory_anchor_jobs a WHERE a.job_id = ingest_jobs.id)
           AND NOT EXISTS (SELECT 1 FROM legacy_session_job_deny_identities d WHERE d.job_id = ingest_jobs.id)
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
