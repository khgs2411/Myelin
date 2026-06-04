import type { Database } from "bun:sqlite";
import { createId } from "../runtime/ids.ts";

export type SessionKind = "note" | "decision" | "finding" | "followup";
export const SESSION_KINDS: SessionKind[] = ["note", "decision", "finding", "followup"];

export type SessionRow = {
  id: string;
  project_key: string;
  title: string | null;
  status: "open" | "closed";
  started_at: string;
  ended_at: string | null;
  summary: string | null;
};

export type SessionEventRow = { ts: string; kind: SessionKind; message: string };
export type RecentSession = SessionRow & { event_count: number };

const ORDER = "ORDER BY started_at DESC, id DESC";

export function startSession(db: Database, projectKey: string, title: string | null = null, now: Date = new Date()): SessionRow {
  const id = createId(now);
  db.query(
    "INSERT INTO sessions (id, project_key, title, status, started_at, ended_at, summary) VALUES (?, ?, ?, 'open', ?, NULL, NULL)",
  ).run(id, projectKey, title, now.toISOString());
  return getRow(db, id)!;
}

export function logEvent(db: Database, sessionId: string, kind: SessionKind, message: string, now: Date = new Date()): { event_id: number; ts: string } {
  if (!SESSION_KINDS.includes(kind)) throw new Error(`Invalid event kind: ${kind}`);
  const row = getRow(db, sessionId);
  if (!row) throw new Error(`Unknown session: ${sessionId}`);
  if (row.status === "closed") throw new Error(`Session ${sessionId} is closed`);
  const ts = now.toISOString();
  const result = db.query("INSERT INTO session_events (session_id, ts, kind, message) VALUES (?, ?, ?, ?)").run(sessionId, ts, kind, message);
  return { event_id: Number(result.lastInsertRowid), ts };
}

export function closeSession(db: Database, sessionId: string, summary: string | null = null, now: Date = new Date()): SessionRow {
  const row = getRow(db, sessionId);
  if (!row) throw new Error(`Unknown session: ${sessionId}`);
  if (row.status === "closed") throw new Error(`Session ${sessionId} is already closed`);
  db.query("UPDATE sessions SET status = 'closed', ended_at = ?, summary = ? WHERE id = ?").run(now.toISOString(), summary, sessionId);
  return getRow(db, sessionId)!;
}

export function openSessions(db: Database, projectKey: string): SessionRow[] {
  return db.query(`SELECT * FROM sessions WHERE project_key = ? AND status = 'open' ${ORDER}`).all(projectKey) as SessionRow[];
}

export function recentSessions(db: Database, projectKey: string, limit = 5): RecentSession[] {
  return db.query(
    `SELECT s.*, (SELECT count(*) FROM session_events e WHERE e.session_id = s.id) AS event_count
     FROM sessions s WHERE s.project_key = ? ${ORDER} LIMIT ?`,
  ).all(projectKey, limit) as RecentSession[];
}

export function getSession(db: Database, sessionId: string): { session: SessionRow; events: SessionEventRow[] } | null {
  const session = getRow(db, sessionId);
  if (!session) return null;
  const events = db.query("SELECT ts, kind, message FROM session_events WHERE session_id = ? ORDER BY ts ASC, id ASC").all(sessionId) as SessionEventRow[];
  return { session, events };
}

function getRow(db: Database, sessionId: string): SessionRow | null {
  return (db.query("SELECT * FROM sessions WHERE id = ?").get(sessionId) as SessionRow | null) ?? null;
}
