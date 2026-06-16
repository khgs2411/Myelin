import { openMemoryDb, type MemoryDb } from "../memory/db.ts";
import {
  closeSession,
  getSession,
  logEvent,
  openSessions,
  recentSessions,
  SESSION_KINDS,
  startSession,
  type SessionEventRow,
  type SessionKind,
  type SessionRow,
} from "../memory/sessions.ts";
import { findProject } from "../runtime/projects.ts";

export type StartSessionResult = {
  session_id: string;
  project_key: string;
  status: SessionRow["status"];
  started_at: string;
  title: string | null;
};

export type LogSessionResult = {
  session_id: string;
  event_id: number;
  kind: SessionKind;
  ts: string;
};

export type CloseSessionResult = {
  session_id: string;
  status: SessionRow["status"];
  ended_at: string | null;
  summary: string | null;
};

export type RecentSessionResult = {
  project_key: string;
  sessions: Array<{
    id: string;
    title: string | null;
    status: SessionRow["status"];
    started_at: string;
    ended_at: string | null;
    summary: string | null;
    event_count: number;
  }>;
};

export type ShowSessionResult = {
  session: SessionRow;
  events: SessionEventRow[];
};

export class SessionService {
  constructor(private readonly root: string) {}

  async start(projectKey: string, title?: string): Promise<StartSessionResult> {
    await this.ensureProject(projectKey);
    return this.withDb((db) => {
      const session = startSession(db, projectKey, title ?? null);
      return {
        session_id: session.id,
        project_key: session.project_key,
        status: session.status,
        started_at: session.started_at,
        title: session.title,
      };
    });
  }

  async log(input: {
    projectKey: string;
    message: string;
    kind?: string;
    sessionId?: string;
  }): Promise<LogSessionResult> {
    await this.ensureProject(input.projectKey);
    const kind = (input.kind ?? "note") as SessionKind;
    if (!SESSION_KINDS.includes(kind)) throw new Error(`--kind must be one of: ${SESSION_KINDS.join(", ")}`);

    return this.withDb((db) => {
      const target = this.resolveTarget(db, input.projectKey, input.sessionId);
      const logged = logEvent(db, target.id, kind, input.message);
      return { session_id: target.id, event_id: logged.event_id, kind, ts: logged.ts };
    });
  }

  async close(input: { projectKey: string; summary?: string; sessionId?: string }): Promise<CloseSessionResult> {
    await this.ensureProject(input.projectKey);
    return this.withDb((db) => {
      const target = this.resolveTarget(db, input.projectKey, input.sessionId);
      const session = closeSession(db, target.id, input.summary ?? null);
      return {
        session_id: session.id,
        status: session.status,
        ended_at: session.ended_at,
        summary: session.summary,
      };
    });
  }

  async recent(projectKey: string, limit = 5): Promise<RecentSessionResult> {
    await this.ensureProject(projectKey);
    return this.withDb((db) => ({
      project_key: projectKey,
      sessions: recentSessions(db, projectKey, limit).map((session) => ({
        id: session.id,
        title: session.title,
        status: session.status,
        started_at: session.started_at,
        ended_at: session.ended_at,
        summary: session.summary,
        event_count: session.event_count,
      })),
    }));
  }

  async show(sessionId: string): Promise<ShowSessionResult> {
    return this.withDb((db) => {
      const found = getSession(db, sessionId);
      if (!found) throw new Error(`Unknown session: ${sessionId}`);
      return found;
    });
  }

  private async ensureProject(projectKey: string): Promise<void> {
    await findProject(this.root, projectKey);
  }

  private withDb<T>(fn: (db: MemoryDb) => T): T {
    const db = openMemoryDb(this.root);
    try {
      return fn(db);
    } finally {
      db.close();
    }
  }

  private resolveTarget(db: MemoryDb, projectKey: string, explicit?: string): { id: string } {
    if (explicit) {
      const found = getSession(db, explicit);
      if (!found) throw new Error(`Unknown session: ${explicit}`);
      if (found.session.project_key !== projectKey) throw new Error(`Session ${explicit} does not belong to ${projectKey}`);
      if (found.session.status === "closed") throw new Error(`Session ${explicit} is closed`);
      return { id: explicit };
    }

    const open = openSessions(db, projectKey);
    if (open.length === 0) throw new Error(`No open session for ${projectKey}. Run: myelin session start ${projectKey}`);
    if (open.length > 1) {
      throw new Error(`Multiple open sessions for ${projectKey}: ${open.map((session) => session.id).join(", ")}. Pass --session <id>.`);
    }
    return { id: open[0].id };
  }
}
