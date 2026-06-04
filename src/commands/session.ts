import type { Cli, CommandResult } from "./registry.ts";
import { fail, ok } from "./registry.ts";
import { repoRoot } from "../runtime/fs.ts";
import { findProject } from "../runtime/projects.ts";
import { openMemoryDb, type MemoryDb } from "../memory/db.ts";
import {
  closeSession, getSession, logEvent, openSessions, recentSessions, startSession,
  SESSION_KINDS, type SessionKind,
} from "../memory/sessions.ts";

export function registerSessionCommands(cli: Cli): void {
  cli.command(["session", "start"], (args) => withDb((db) => start(db, args)));
  cli.command(["session", "log"], (args) => withDb((db) => log(db, args)));
  cli.command(["session", "close"], (args) => withDb((db) => close(db, args)));
  cli.command(["session", "recent"], (args) => withDb((db) => recent(db, args)));
  cli.command(["session", "show"], (args) => withDb((db) => show(db, args)));
}

async function withDb(fn: (db: MemoryDb) => Promise<CommandResult>): Promise<CommandResult> {
  const db = openMemoryDb(repoRoot().root);
  try {
    return await fn(db);
  } finally {
    db.close();
  }
}

async function start(db: MemoryDb, args: string[]): Promise<CommandResult> {
  const p = parse(args, { title: true });
  if (p.error) return fail(p.error);
  if (!p.projectKey) return fail("Usage: myelin session start <key> [--title \"...\"] [--json]");
  try {
    await findProject(repoRoot().root, p.projectKey);
  } catch (error) {
    return fail(errMsg(error));
  }
  const s = startSession(db, p.projectKey, p.title ?? null);
  return emit(p.json, { session_id: s.id, project_key: s.project_key, status: s.status, started_at: s.started_at, title: s.title },
    `Started session ${s.id} for ${s.project_key}.`);
}

async function log(db: MemoryDb, args: string[]): Promise<CommandResult> {
  const p = parse(args, { kind: true, session: true, message: true });
  if (p.error) return fail(p.error);
  if (!p.projectKey || !p.message) return fail("Usage: myelin session log <key> <message> [--kind note|decision|finding|followup] [--session <id>] [--json]");
  const projectErr = await ensureProject(p.projectKey);
  if (projectErr) return fail(projectErr);
  const target = resolveTarget(db, p.projectKey, p.session);
  if ("error" in target) return fail(target.error);
  const kind = (p.kind ?? "note") as SessionKind;
  if (!SESSION_KINDS.includes(kind)) return fail(`--kind must be one of: ${SESSION_KINDS.join(", ")}`);
  try {
    const r = logEvent(db, target.id, kind, p.message);
    return emit(p.json, { session_id: target.id, event_id: r.event_id, kind, ts: r.ts }, `Logged ${kind} to ${target.id}.`);
  } catch (error) {
    return fail(errMsg(error));
  }
}

async function close(db: MemoryDb, args: string[]): Promise<CommandResult> {
  const p = parse(args, { summary: true, session: true });
  if (p.error) return fail(p.error);
  if (!p.projectKey) return fail("Usage: myelin session close <key> [--summary \"...\"] [--session <id>] [--json]");
  const projectErr = await ensureProject(p.projectKey);
  if (projectErr) return fail(projectErr);
  const target = resolveTarget(db, p.projectKey, p.session);
  if ("error" in target) return fail(target.error);
  try {
    const s = closeSession(db, target.id, p.summary ?? null);
    return emit(p.json, { session_id: s.id, status: s.status, ended_at: s.ended_at, summary: s.summary }, `Closed session ${s.id}.`);
  } catch (error) {
    return fail(errMsg(error));
  }
}

async function recent(db: MemoryDb, args: string[]): Promise<CommandResult> {
  const p = parse(args, { limit: true });
  if (p.error) return fail(p.error);
  if (!p.projectKey) return fail("Usage: myelin session recent <key> [--limit N] [--json]");
  const projectErr = await ensureProject(p.projectKey);
  if (projectErr) return fail(projectErr);
  const limit = p.limit ?? 5;
  const sessions = recentSessions(db, p.projectKey, limit).map((s) => ({
    id: s.id, title: s.title, status: s.status, started_at: s.started_at, ended_at: s.ended_at, summary: s.summary, event_count: s.event_count,
  }));
  if (p.json) return ok(JSON.stringify({ project_key: p.projectKey, sessions }, null, 2));
  if (sessions.length === 0) return ok(`No sessions recorded for ${p.projectKey}.`);
  return ok(sessions.map((s) => `${s.id} [${s.status}] ${s.started_at} (${s.event_count} events) ${s.summary ?? ""}`.trim()).join("\n"));
}

async function show(db: MemoryDb, args: string[]): Promise<CommandResult> {
  const p = parse(args, {});
  if (p.error) return fail(p.error);
  if (!p.projectKey) return fail("Usage: myelin session show <session-id> [--json]");
  const found = getSession(db, p.projectKey); // first positional is the session id here
  if (!found) return fail(`Unknown session: ${p.projectKey}`);
  if (p.json) return ok(JSON.stringify({ session: found.session, events: found.events }, null, 2));
  const header = `${found.session.id} [${found.session.status}] ${found.session.project_key}`;
  const lines = found.events.map((e) => `  ${e.ts} ${e.kind}: ${e.message}`);
  return ok([header, ...lines].join("\n"));
}

function resolveTarget(db: MemoryDb, projectKey: string, explicit?: string): { id: string } | { error: string } {
  if (explicit) {
    const found = getSession(db, explicit);
    if (!found) return { error: `Unknown session: ${explicit}` };
    if (found.session.project_key !== projectKey) return { error: `Session ${explicit} does not belong to ${projectKey}` };
    if (found.session.status === "closed") return { error: `Session ${explicit} is closed` };
    return { id: explicit };
  }
  const open = openSessions(db, projectKey);
  if (open.length === 0) return { error: `No open session for ${projectKey}. Run: myelin session start ${projectKey}` };
  if (open.length > 1) return { error: `Multiple open sessions for ${projectKey}: ${open.map((s) => s.id).join(", ")}. Pass --session <id>.` };
  return { id: open[0].id };
}

async function ensureProject(projectKey: string): Promise<string | null> {
  try {
    await findProject(repoRoot().root, projectKey);
    return null;
  } catch (error) {
    return errMsg(error);
  }
}

type Parsed = {
  projectKey: string; message: string; title?: string; summary?: string;
  kind?: string; session?: string; limit?: number; json: boolean; error?: string;
};

function parse(args: string[], allow: { title?: boolean; summary?: boolean; kind?: boolean; session?: boolean; limit?: boolean; message?: boolean }): Parsed {
  const out: Parsed = { projectKey: "", message: "", json: false };
  for (let i = 0; i < args.length; i += 1) {
    const a = args[i];
    if (a === "--json") out.json = true;
    else if (a === "--title" && allow.title) out.title = args[++i];
    else if (a === "--summary" && allow.summary) out.summary = args[++i];
    else if (a === "--kind" && allow.kind) out.kind = args[++i];
    else if (a === "--session" && allow.session) out.session = args[++i];
    else if (a === "--limit" && allow.limit) {
      const n = Number(args[++i]);
      if (!Number.isInteger(n) || n <= 0) return { ...out, error: "--limit must be a positive integer" };
      out.limit = n;
    } else if (a.startsWith("-")) return { ...out, error: `Unknown option: ${a}` };
    else if (!out.projectKey) out.projectKey = a;
    else if (allow.message) out.message = out.message ? `${out.message} ${a}` : a;
    else return { ...out, error: `Unexpected argument: ${a}` };
  }
  return out;
}

function emit(json: boolean, payload: Record<string, unknown>, text: string): CommandResult {
  return ok(json ? JSON.stringify(payload, null, 2) : text);
}

function errMsg(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
