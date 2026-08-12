import type { Database } from "bun:sqlite";

// Frozen version-15 behavior. This fixture intentionally uses only the SQL and
// ordering available to a pre-firewall launcher/worker and must remain usable by
// the later legacy-runtime retirement chunk.
export const FROZEN_PRE_FIREWALL_RUNTIME_SQL = Object.freeze({
  persistSpawnedPid: `
    UPDATE ingest_jobs
    SET status = 'running', started_at = ?, updated_at = ?, followup_state_json = ?
    WHERE id = ? AND status IN ('starting', 'running')`,
  markWorkerRunning: `
    UPDATE ingest_jobs
    SET status = 'running', started_at = ?, updated_at = ?
    WHERE id = ?`,
  leaseEvent: `
    INSERT INTO experience_event_tombstones
      (id, original_event_id, project_key, ingest_job_id, claimed_at, state,
       source_metadata_json, retained_evidence_json, output_references_json)
    VALUES (?, ?, ?, ?, ?, 'claimed', '{}', '{}', '[]')`,
  insertCandidate: `
    INSERT INTO memory_candidates
      (id, project_key, scope, status, candidate_type, summary, source_event_refs_json,
       evidence_json, proposed_payload_json, confidence, risk, reason, created_at, updated_at)
    VALUES (?, ?, 'project', 'pending', 'continuity', 'provider output', ?, '{}', '{}',
      'high', 'low', 'frozen pre-firewall apply', ?, ?)`,
  finalizeTombstone: `
    UPDATE experience_event_tombstones
    SET state = 'output', finalized_at = ?, terminal_decision = 'output',
        output_references_json = ?
    WHERE id = ? AND ingest_job_id = ? AND state = 'claimed'`,
  deleteRawEvent: "DELETE FROM experience_events WHERE id = ?",
});

export function runFrozenPreFirewallLauncher(input: {
  db: Database;
  jobId: string;
  now: string;
  spawn: () => { pid: number | null; logPath: string };
  beforeSpawn?: () => void;
  afterSpawnBeforePidPersist?: (child: { pid: number | null; logPath: string }) => void;
}): { pid: number | null; logPath: string } {
  input.beforeSpawn?.();
  const child = input.spawn();
  input.afterSpawnBeforePidPersist?.(child);
  input.db.query(FROZEN_PRE_FIREWALL_RUNTIME_SQL.persistSpawnedPid).run(
    input.now,
    input.now,
    JSON.stringify({ pid: child.pid, log_path: child.logPath }),
    input.jobId,
  );
  return child;
}

export function runFrozenPreFirewallPidNullChild(input: {
  db: Database;
  jobId: string;
  now: string;
  onChildStartBeforeRunningPersist?: () => void;
}): void {
  const row = input.db.query(
    "SELECT status, followup_state_json FROM ingest_jobs WHERE id = ?",
  ).get(input.jobId) as { status: string; followup_state_json: string | null } | null;
  if (row?.status !== "starting" || row.followup_state_json !== null) {
    throw new Error("Frozen PID-null child requires an unpersisted starting job");
  }
  input.onChildStartBeforeRunningPersist?.();
  input.db.query(FROZEN_PRE_FIREWALL_RUNTIME_SQL.markWorkerRunning).run(
    input.now,
    input.now,
    input.jobId,
  );
}

export async function runFrozenPreFirewallProviderWorker(input: {
  db: Database;
  projectKey: string;
  jobId: string;
  eventId: string;
  tombstoneId: string;
  candidateId: string;
  now: string;
  provider: () => Promise<void>;
  afterProviderReturnBeforeApply?: () => void;
}): Promise<void> {
  input.db.query(FROZEN_PRE_FIREWALL_RUNTIME_SQL.markWorkerRunning).run(
    input.now,
    input.now,
    input.jobId,
  );
  input.db.query(FROZEN_PRE_FIREWALL_RUNTIME_SQL.leaseEvent).run(
    input.tombstoneId,
    input.eventId,
    input.projectKey,
    input.jobId,
    input.now,
  );

  await input.provider();
  input.afterProviderReturnBeforeApply?.();

  input.db.transaction(() => {
    const candidateRef = `memory_candidates/${input.candidateId}`;
    input.db.query(FROZEN_PRE_FIREWALL_RUNTIME_SQL.insertCandidate).run(
      input.candidateId,
      input.projectKey,
      JSON.stringify([input.tombstoneId]),
      input.now,
      input.now,
    );
    input.db.query(FROZEN_PRE_FIREWALL_RUNTIME_SQL.finalizeTombstone).run(
      input.now,
      JSON.stringify([candidateRef]),
      input.tombstoneId,
      input.jobId,
    );
    input.db.query(FROZEN_PRE_FIREWALL_RUNTIME_SQL.deleteRawEvent).run(input.eventId);
  }).immediate();
}
