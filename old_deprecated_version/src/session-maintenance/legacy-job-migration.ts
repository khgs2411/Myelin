import type { Database } from "bun:sqlite";
import type { IngestJobRow, IngestJobStatus, LegacySessionJobDenyIdentityRow } from "../memory/ingest-types.ts";
import { withMigrateLegacyAnchorAdmission } from "../memory/session-memory-write-firewall.ts";

export const LEGACY_QUARANTINE_REASON = "legacy_state_missing_smc_manifest" as const;

export type LegacyJobSnapshot = {
  job_id: string;
  project_key: string;
  status: IngestJobStatus;
  provider: string;
  provider_session_id: string | null;
  process_id: number | null;
  started_at: string | null;
  created_at: string;
  updated_at: string;
  followup_state_json: string | null;
  error_json: string | null;
};

export type LegacyNonterminalJobSnapshot = LegacyJobSnapshot & {
  status: "starting" | "running" | "needs_followup";
};

export function readLegacyJobs(db: Database): LegacyJobSnapshot[] {
  const rows = db.query(
    `SELECT * FROM ingest_jobs
     ORDER BY project_key, created_at, id`,
  ).all() as IngestJobRow[];
  return rows.map(toLegacySnapshot);
}

export function readLegacyNonterminalJobs(db: Database): LegacyNonterminalJobSnapshot[] {
  return readLegacyJobs(db).filter(isLegacyNonterminalJob);
}

export function readLegacySessionJobDenyIdentity(
  db: Database,
  jobId: string,
): LegacySessionJobDenyIdentityRow | null {
  return (db.query(
    "SELECT * FROM legacy_session_job_deny_identities WHERE job_id = ?",
  ).get(jobId) as LegacySessionJobDenyIdentityRow | null) ?? null;
}

export function insertLegacyJobDenyIdentitiesInOpenTransaction(
  db: Database,
  input: { jobs: readonly LegacyJobSnapshot[]; now: string },
): void {
  if (!db.inTransaction) {
    throw new LegacyJobMigrationError(
      "legacy_activation_transaction_required",
      "legacy deny assignment must run inside the authority activation transaction",
    );
  }
  const insert = db.query(
    `INSERT INTO legacy_session_job_deny_identities
      (job_id, project_key, reason_code, source_status, denied_at)
     VALUES (?, ?, 'pre_smc_job_identity', ?, ?)`,
  );
  for (const job of input.jobs) insert.run(job.job_id, job.project_key, job.status, input.now);
}

export function sameLegacyJobSnapshot(
  expected: readonly LegacyJobSnapshot[],
  actual: readonly LegacyJobSnapshot[],
): boolean {
  if (expected.length !== actual.length) return false;
  return expected.every((job, index) => {
    const other = actual[index];
    return other !== undefined
      && job.job_id === other.job_id
      && job.project_key === other.project_key
      && job.status === other.status
      && job.provider === other.provider
      && job.provider_session_id === other.provider_session_id
      && job.process_id === other.process_id
      && job.started_at === other.started_at
      && job.created_at === other.created_at
      && job.updated_at === other.updated_at
      && job.followup_state_json === other.followup_state_json
      && job.error_json === other.error_json;
  });
}

export function legacyProjectsWithMultipleNonterminalJobs(
  jobs: readonly LegacyNonterminalJobSnapshot[],
): Array<{ project_key: string; job_ids: string[] }> {
  const byProject = new Map<string, string[]>();
  for (const job of jobs) {
    const ids = byProject.get(job.project_key) ?? [];
    ids.push(job.job_id);
    byProject.set(job.project_key, ids);
  }
  return [...byProject.entries()]
    .filter(([, ids]) => ids.length > 1)
    .map(([project_key, job_ids]) => ({ project_key, job_ids }));
}

export function quarantineLegacyJobsInOpenTransaction(
  db: Database,
  input: {
    jobs: readonly LegacyNonterminalJobSnapshot[];
    now: string;
    processLiveness?: ReadonlyMap<string, boolean | null>;
  },
): void {
  if (!db.inTransaction) {
    throw new LegacyJobMigrationError(
      "legacy_activation_transaction_required",
      "legacy quarantine must run inside the authority activation transaction",
    );
  }
  const incompatible = legacyProjectsWithMultipleNonterminalJobs(input.jobs);
  if (incompatible.length > 0) {
    throw new LegacyJobMigrationError(
      "legacy_project_has_multiple_nonterminal_jobs",
      `project ${incompatible[0]!.project_key} has multiple legacy nonterminal jobs`,
    );
  }
  for (const job of input.jobs) {
    quarantineLegacyJob(db, job, input.now, input.processLiveness?.get(job.job_id) ?? null);
  }
}

export class LegacyJobMigrationError extends Error {
  constructor(
    readonly code:
      | "legacy_project_has_multiple_nonterminal_jobs"
      | "legacy_activation_transaction_required"
      | "legacy_quarantine_state_conflict",
    message: string,
  ) {
    super(`${code}: ${message}`);
    this.name = "LegacyJobMigrationError";
  }
}

function quarantineLegacyJob(
  db: Database,
  job: LegacyNonterminalJobSnapshot,
  now: string,
  processAlive: boolean | null,
): void {
  if (db.query("SELECT 1 FROM session_memory_anchor_jobs WHERE job_id = ?").get(job.job_id)) {
    throw new LegacyJobMigrationError(
      "legacy_quarantine_state_conflict",
      `legacy job ${job.job_id} already has companion anchor state`,
    );
  }
  if (db.query("SELECT 1 FROM project_session_mutation_fences WHERE project_key = ?").get(job.project_key)) {
    throw new LegacyJobMigrationError(
      "legacy_quarantine_state_conflict",
      `project ${job.project_key} already has a mutation fence`,
    );
  }

  db.query(
    `INSERT INTO session_memory_anchor_jobs
      (job_id, project_key, phase, owner_epoch, reason_code, heartbeat_at, created_at, updated_at)
     VALUES (?, ?, 'needs_followup', 1, ?, ?, ?, ?)`,
  ).run(
    job.job_id,
    job.project_key,
    LEGACY_QUARANTINE_REASON,
    now,
    job.created_at,
    now,
  );
  db.query(
    `INSERT INTO session_memory_anchor_attempts
      (id, job_id, attempt_number, owner_epoch, attempt_kind, provider, provider_session_id,
       process_id, status, started_at, finished_at, details_json, created_at, updated_at)
     VALUES (?, ?, 1, 1, 'legacy', ?, ?, ?, 'needs_followup', ?, ?, ?, ?, ?)`,
  ).run(
    `legacy:${job.job_id}:1`,
    job.job_id,
    job.provider,
    job.provider_session_id,
    job.process_id,
    job.started_at,
    now,
    JSON.stringify({
      migrated_from_status: job.status,
      original_updated_at: job.updated_at,
      original_followup_state_json: job.followup_state_json,
      original_error_json: job.error_json,
      process_liveness_diagnostic: processAlive,
    }),
    job.created_at,
    now,
  );
  db.query(
    `INSERT INTO project_session_mutation_fences
      (project_key, owner_id, owner_kind, phase, owner_epoch, heartbeat_at, acquired_at,
       terminal_receipt_id)
     VALUES (?, ?, 'anchor_job', 'needs_followup', 1, ?, ?, NULL)`,
  ).run(job.project_key, job.job_id, now, now);

  const followupState = {
    ...parseObject(job.followup_state_json),
    smc_quarantine: {
      reason_code: LEGACY_QUARANTINE_REASON,
      quarantined_at: now,
      original_status: job.status,
    },
  };
  const updated = withMigrateLegacyAnchorAdmission(db, {
    projectKey: job.project_key,
    targetJobId: job.job_id,
  }, () => db.query(
      `UPDATE ingest_jobs
       SET status = 'needs_followup', error_json = ?, followup_state_json = ?, updated_at = ?
       WHERE id = ? AND project_key = ? AND status = ? AND updated_at = ?`,
    ).run(
      JSON.stringify({ code: LEGACY_QUARANTINE_REASON }),
      JSON.stringify(followupState),
      now,
      job.job_id,
      job.project_key,
      job.status,
      job.updated_at,
    ));
  if (updated.changes !== 1) {
    throw new LegacyJobMigrationError(
      "legacy_quarantine_state_conflict",
      `legacy job ${job.job_id} changed during quarantine`,
    );
  }
}

function toLegacySnapshot(job: IngestJobRow): LegacyJobSnapshot {
  return {
    job_id: job.id,
    project_key: job.project_key,
    status: job.status,
    provider: job.provider,
    provider_session_id: job.provider_session_id,
    process_id: processId(job.followup_state_json),
    started_at: job.started_at,
    created_at: job.created_at,
    updated_at: job.updated_at,
    followup_state_json: job.followup_state_json,
    error_json: job.error_json,
  };
}

function isLegacyNonterminalJob(job: LegacyJobSnapshot): job is LegacyNonterminalJobSnapshot {
  return job.status === "starting" || job.status === "running" || job.status === "needs_followup";
}

function processId(value: string | null): number | null {
  const pid = parseObject(value).pid;
  return typeof pid === "number" && Number.isInteger(pid) && pid > 0 ? pid : null;
}

function parseObject(value: string | null): Record<string, unknown> {
  if (!value) return {};
  try {
    const parsed = JSON.parse(value) as unknown;
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? parsed as Record<string, unknown>
      : {};
  } catch {
    return {};
  }
}
