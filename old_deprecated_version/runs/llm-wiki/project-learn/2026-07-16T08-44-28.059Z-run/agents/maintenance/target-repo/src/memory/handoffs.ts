import type { Database } from "bun:sqlite";
import { normalizeCandidateStatus, type QueueLifecycleUpdateResult } from "./candidates.ts";
import type { HandoffInstructionRow, HandoffScope, MemoryCandidateStatus } from "./ingest-types.ts";

const HANDOFF_TABLES: Record<HandoffScope, string> = {
  project: "project_handoff_instructions",
  practice: "practice_handoff_instructions",
  personal: "personal_handoff_instructions",
};

export type CreateHandoffInstructionInput = {
  id: string;
  target_scope: HandoffScope;
  project_key: string;
  status: MemoryCandidateStatus;
  objective: string;
  prompt_text: string;
  source_session_memory_ids: string[];
  source_event_refs: string[];
  suggested_actions: string[];
  reason: string;
  confidence: string;
  risk: string;
  now: string;
};

export function createHandoffInstruction(db: Database, input: CreateHandoffInstructionInput): HandoffInstructionRow {
  const table = HANDOFF_TABLES[input.target_scope];
  db.query(
    `INSERT INTO ${table}
      (id, project_key, status, objective, prompt_text, source_session_memory_ids_json,
       source_event_refs_json, suggested_actions_json, reason, confidence, risk, created_at, updated_at, processed_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL)`,
  ).run(
    input.id,
    input.project_key,
    input.status,
    input.objective,
    input.prompt_text,
    JSON.stringify(input.source_session_memory_ids),
    JSON.stringify(input.source_event_refs),
    JSON.stringify(input.suggested_actions),
    input.reason,
    input.confidence,
    input.risk,
    input.now,
    input.now,
  );

  return db.query(`SELECT * FROM ${table} WHERE id = ?`).get(input.id) as HandoffInstructionRow;
}

export function listHandoffInstructions(
  db: Database,
  input: { target_scope: HandoffScope; project_key: string; status?: string },
): HandoffInstructionRow[] {
  const table = HANDOFF_TABLES[input.target_scope];
  const status = input.status ? normalizeCandidateStatus(input.status) : null;
  if (status) {
    return db
      .query(`SELECT * FROM ${table} WHERE project_key = ? AND status = ? ORDER BY created_at DESC, id DESC`)
      .all(input.project_key, status) as HandoffInstructionRow[];
  }
  return db
    .query(`SELECT * FROM ${table} WHERE project_key = ? ORDER BY created_at DESC, id DESC`)
    .all(input.project_key) as HandoffInstructionRow[];
}

export function markProjectHandoffInstructionProcessed(
  db: Database,
  input: { project_key: string; id: string; now: string },
): QueueLifecycleUpdateResult {
  const row = db
    .query("SELECT * FROM project_handoff_instructions WHERE id = ? AND project_key = ?")
    .get(input.id, input.project_key) as HandoffInstructionRow | null;
  if (!row) return { status: "missing", id: input.id };
  if (row.status === "processed" || row.status === "rejected") {
    return { status: "already_terminal", id: input.id, current_status: row.status };
  }
  if (row.status !== "pending" && row.status !== "needs_review") {
    return { status: "skipped", id: input.id, current_status: row.status, reason: "unsupported handoff status" };
  }

  const result = db
    .query(
      `UPDATE project_handoff_instructions
       SET status = 'processed',
           processed_at = ?,
           updated_at = ?
       WHERE id = ?
         AND project_key = ?
         AND status IN ('pending', 'needs_review')`,
    )
    .run(input.now, input.now, input.id, input.project_key);

  if (result.changes > 0) return { status: "processed", id: input.id };

  const current = db
    .query("SELECT status FROM project_handoff_instructions WHERE id = ? AND project_key = ?")
    .get(input.id, input.project_key) as { status: string } | null;
  if (!current) return { status: "missing", id: input.id };
  if (current.status === "processed" || current.status === "rejected") {
    return { status: "already_terminal", id: input.id, current_status: current.status };
  }
  return { status: "skipped", id: input.id, current_status: current.status, reason: "handoff status changed before update" };
}
