import type { Database } from "bun:sqlite";
import {
  INGEST_COMPLETION_LAYERS,
  type IngestCompletionLayer,
} from "../memory/ingest-types.ts";
import {
  countExperienceEvents,
  countLeasedExperienceEvents,
  countUnleasedExperienceEvents,
} from "../memory/experience.ts";

export type IngestProjectStatus = {
  project_key: string;
  completion_layer: IngestCompletionLayer;
  completion_label: string;
  counts: {
    active_events: number;
    unleased_events: number;
    leased_events: number;
    running_jobs: number;
    failed_jobs: number;
    terminal_tombstones: number;
    session_memories: number;
    memory_candidates: number;
    handoff_instructions: number;
    pending_session_memory_embeddings: number;
  };
};

export function ingestCompletionLabel(layer: IngestCompletionLayer): string {
  switch (layer) {
    case INGEST_COMPLETION_LAYERS.EXPERIENCE_LOG_DRAIN_PENDING:
      return "Experience Log drain pending";
    case INGEST_COMPLETION_LAYERS.EXPERIENCE_LOG_DRAIN_COMPLETE:
      return "Experience Log drain complete";
    case INGEST_COMPLETION_LAYERS.SESSION_MEMORY_WRITE_COMPLETE:
      return "Session Memory write complete";
    case INGEST_COMPLETION_LAYERS.SESSION_MEMORY_RETRIEVAL_PENDING:
      return "Session Memory retrieval pending";
  }
}

export function readIngestProjectStatus(db: Database, projectKey: string): IngestProjectStatus {
  const activeEvents = countExperienceEvents(db, projectKey);
  const unleasedEvents = countUnleasedExperienceEvents(db, projectKey);
  const leasedEvents = countLeasedExperienceEvents(db, projectKey);
  const runningJobs = scalarCount(
    db,
    "SELECT count(*) AS count FROM ingest_jobs WHERE project_key = ? AND status = 'running'",
    projectKey,
  );
  const failedJobs = scalarCount(
    db,
    "SELECT count(*) AS count FROM ingest_jobs WHERE project_key = ? AND status = 'failed'",
    projectKey,
  );
  const terminalTombstones = scalarCount(
    db,
    "SELECT count(*) AS count FROM experience_event_tombstones WHERE project_key = ? AND state IN ('output', 'no_output', 'failed', 'unfinished')",
    projectKey,
  );
  const sessionMemories = scalarCount(db, "SELECT count(*) AS count FROM session_memories WHERE project_key = ?", projectKey);
  const memoryCandidates = scalarCount(db, "SELECT count(*) AS count FROM memory_candidates WHERE project_key = ?", projectKey);
  const projectHandoffs = scalarCount(
    db,
    "SELECT count(*) AS count FROM project_handoff_instructions WHERE project_key = ?",
    projectKey,
  );
  const practiceHandoffs = scalarCount(
    db,
    "SELECT count(*) AS count FROM practice_handoff_instructions WHERE project_key = ?",
    projectKey,
  );
  const personalHandoffs = scalarCount(
    db,
    "SELECT count(*) AS count FROM personal_handoff_instructions WHERE project_key = ?",
    projectKey,
  );
  const pendingEmbeddings = scalarCount(
    db,
    `SELECT count(*) AS count
     FROM session_memories sm
     WHERE sm.project_key = ?
       AND sm.status = 'active'
       AND NOT EXISTS (
         SELECT 1
         FROM session_memory_embeddings e
         WHERE e.session_memory_id = sm.id
           AND e.status = 'indexed'
       )`,
    projectKey,
  );

  const outputCount = sessionMemories + memoryCandidates + projectHandoffs + practiceHandoffs + personalHandoffs;
  const completionLayer =
    activeEvents > 0 || leasedEvents > 0 || runningJobs > 0
      ? INGEST_COMPLETION_LAYERS.EXPERIENCE_LOG_DRAIN_PENDING
      : outputCount === 0
        ? INGEST_COMPLETION_LAYERS.EXPERIENCE_LOG_DRAIN_COMPLETE
        : pendingEmbeddings > 0
          ? INGEST_COMPLETION_LAYERS.SESSION_MEMORY_RETRIEVAL_PENDING
          : INGEST_COMPLETION_LAYERS.SESSION_MEMORY_WRITE_COMPLETE;

  return {
    project_key: projectKey,
    completion_layer: completionLayer,
    completion_label: ingestProjectStatusLabel(completionLayer, {
      activeEvents,
      leasedEvents,
      runningJobs,
      failedJobs,
    }),
    counts: {
      active_events: activeEvents,
      unleased_events: unleasedEvents,
      leased_events: leasedEvents,
      running_jobs: runningJobs,
      failed_jobs: failedJobs,
      terminal_tombstones: terminalTombstones,
      session_memories: sessionMemories,
      memory_candidates: memoryCandidates,
      handoff_instructions: projectHandoffs + practiceHandoffs + personalHandoffs,
      pending_session_memory_embeddings: pendingEmbeddings,
    },
  };
}

function ingestProjectStatusLabel(
  layer: IngestCompletionLayer,
  counts: { activeEvents: number; leasedEvents: number; runningJobs: number; failedJobs: number },
): string {
  if (layer !== INGEST_COMPLETION_LAYERS.EXPERIENCE_LOG_DRAIN_PENDING) return ingestCompletionLabel(layer);
  if (counts.runningJobs > 0) return "Experience Log drain running";
  if (counts.failedJobs > 0 && counts.leasedEvents > 0) return "Experience Log retry pending";
  if (counts.activeEvents > 0) return "Experience Log ingest pending";
  return ingestCompletionLabel(layer);
}

function scalarCount(db: Database, sql: string, value: string): number {
  const row = db.query(sql).get(value) as { count: number };
  return row.count;
}
