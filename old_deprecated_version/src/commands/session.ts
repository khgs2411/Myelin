import type { Cli, CommandResult } from "./registry.ts";
import { fail, ok } from "./registry.ts";
import type { LaunchContext } from "../runtime/launch-context.ts";
import { SessionService } from "../session/session-service.ts";

export type SessionCommandDeps = { context: LaunchContext };

export function registerSessionCommands(cli: Cli, deps: SessionCommandDeps): void {
  const root = deps.context.myelinRoot;
  cli.command(["session", "start"], (args) => start(args, root));
  cli.command(["session", "log"], (args) => log(args, root));
  cli.command(["session", "close"], (args) => close(args, root));
  cli.command(["session", "recent"], (args) => recent(args, root));
  cli.command(["session", "show"], (args) => show(args, root));
}

async function start(args: string[], root: string): Promise<CommandResult> {
  const p = parse(args, { title: true });
  if (p.error) return fail(p.error);
  if (!p.projectKey) return fail("Usage: myelin session start <key> [--title \"...\"] [--json]");
  try {
    const result = await service(root).start(p.projectKey, p.title);
    return emit(p.json, result, `Started session ${result.session_id} for ${result.project_key}.`);
  } catch (error) {
    return fail(errMsg(error));
  }
}

async function log(args: string[], root: string): Promise<CommandResult> {
  const p = parse(args, { kind: true, session: true, message: true });
  if (p.error) return fail(p.error);
  if (!p.projectKey || !p.message) return fail("Usage: myelin session log <key> <message> [--kind note|decision|finding|followup] [--session <id>] [--json]");
  try {
    const result = await service(root).log({ projectKey: p.projectKey, message: p.message, kind: p.kind, sessionId: p.session });
    return emit(p.json, result, `Logged ${result.kind} to ${result.session_id}.`);
  } catch (error) {
    return fail(errMsg(error));
  }
}

async function close(args: string[], root: string): Promise<CommandResult> {
  const p = parse(args, { summary: true, session: true });
  if (p.error) return fail(p.error);
  if (!p.projectKey) return fail("Usage: myelin session close <key> [--summary \"...\"] [--session <id>] [--json]");
  try {
    const result = await service(root).close({ projectKey: p.projectKey, summary: p.summary, sessionId: p.session });
    return emit(p.json, result, `Closed session ${result.session_id}.`);
  } catch (error) {
    return fail(errMsg(error));
  }
}

async function recent(args: string[], root: string): Promise<CommandResult> {
  const p = parse(args, { limit: true });
  if (p.error) return fail(p.error);
  if (!p.projectKey) return fail("Usage: myelin session recent <key> [--limit N] [--json]");
  try {
    const result = await service(root).recent(p.projectKey, p.limit ?? 5);
    if (p.json) return ok(JSON.stringify(result, null, 2));
    if (result.sessions.length === 0) return ok(`No sessions recorded for ${p.projectKey}.`);
    return ok(result.sessions.map((s) => `${s.id} [${s.status}] ${s.started_at} (${s.event_count} events) ${s.summary ?? ""}`.trim()).join("\n"));
  } catch (error) {
    return fail(errMsg(error));
  }
}

async function show(args: string[], root: string): Promise<CommandResult> {
  const p = parse(args, {});
  if (p.error) return fail(p.error);
  if (!p.projectKey) return fail("Usage: myelin session show <session-id> [--json]");
  try {
    const found = await service(root).show(p.projectKey); // first positional is the session id here
    if (p.json) return ok(JSON.stringify({ session: found.session, events: found.events }, null, 2));
    const header = `${found.session.id} [${found.session.status}] ${found.session.project_key}`;
    const lines = found.events.map((e) => `  ${e.ts} ${e.kind}: ${e.message}`);
    return ok([header, ...lines].join("\n"));
  } catch (error) {
    return fail(errMsg(error));
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

function service(root: string): SessionService {
  return new SessionService(root);
}

function errMsg(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
