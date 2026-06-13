import type { Cli, CommandResult } from "./registry.ts";
import { fail, ok } from "./registry.ts";
import { getMemoryCandidate, listMemoryCandidates, normalizeCandidateStatus } from "../memory/candidates.ts";
import { openMemoryDb, type MemoryDb } from "../memory/db.ts";
import type { MemoryCandidateStatus, MemoryScope } from "../memory/ingest-types.ts";
import { repoRoot } from "../runtime/fs.ts";
import { queryMemory } from "../query/engine.ts";

export function registerMemoryCommands(cli: Cli): void {
  cli.command(["memory", "candidates"], (args) => withMemoryDb((db) => candidates(db, args)));
  cli.command(["memory", "candidate", "show"], (args) => withMemoryDb((db) => candidateShow(db, args)));
  cli.command(["memory", "query"], async (args) => {
    const parsed = parseArgs(args);
    if (parsed.error) return fail(parsed.error);

    const response = await queryMemory({
      root: repoRoot().root,
      projectKey: parsed.projectKey,
      question: parsed.question,
      includeRoute: parsed.debug,
    });
    if (parsed.json) return ok(JSON.stringify(response, null, 2));
    if (response.degraded) return fail(response.answer);
    return ok(response.answer);
  });
}

function withMemoryDb(fn: (db: MemoryDb) => CommandResult): CommandResult {
  const db = openMemoryDb(repoRoot().root);
  try {
    return fn(db);
  } finally {
    db.close();
  }
}

function candidates(db: MemoryDb, args: string[]): CommandResult {
  const parsed = parseCandidateListArgs(args);
  if (parsed.error) return fail(parsed.error);

  const rows = listMemoryCandidates(db, {
    project_key: parsed.projectKey,
    status: parsed.status,
    scope: parsed.scope,
  });
  if (parsed.json) return ok(JSON.stringify({ project_key: parsed.projectKey, candidates: rows }, null, 2));
  if (rows.length === 0) return ok(`No memory candidates for ${parsed.projectKey}.`);
  return ok(rows.map((row) => `${row.id} [${row.status}] ${row.scope}: ${row.summary}`).join("\n"));
}

function candidateShow(db: MemoryDb, args: string[]): CommandResult {
  const parsed = parseCandidateShowArgs(args);
  if (parsed.error) return fail(parsed.error);

  const row = getMemoryCandidate(db, parsed.id);
  if (!row) return fail(`Unknown memory candidate: ${parsed.id}`);
  return parsed.json ? ok(JSON.stringify({ candidate: row }, null, 2)) : ok(`${row.id} [${row.status}] ${row.scope}\n${row.summary}`);
}

function parseCandidateListArgs(args: string[]): {
  projectKey: string;
  status?: MemoryCandidateStatus;
  scope?: MemoryScope;
  json: boolean;
  error?: string;
} {
  let projectKey = "";
  let status: MemoryCandidateStatus | undefined;
  let scope: MemoryScope | undefined;
  let json = false;

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === "--json") json = true;
    else if (arg === "--status") {
      try {
        status = normalizeCandidateStatus(args[++index] ?? "");
      } catch (error) {
        return { projectKey, status, scope, json, error: error instanceof Error ? error.message : String(error) };
      }
    } else if (arg === "--scope") {
      const value = args[++index];
      if (value !== "session" && value !== "project" && value !== "practice" && value !== "personal") {
        return { projectKey, status, scope, json, error: "--scope must be one of: session, project, practice, personal" };
      }
      scope = value;
    } else if (arg.startsWith("-")) {
      return { projectKey, status, scope, json, error: `Unknown memory candidates option: ${arg}` };
    } else if (!projectKey) {
      projectKey = arg;
    } else {
      return { projectKey, status, scope, json, error: `Unexpected memory candidates argument: ${arg}` };
    }
  }

  if (!projectKey) {
    return {
      projectKey,
      status,
      scope,
      json,
      error:
        "Usage: myelin memory candidates <project-key> [--status pending|needs-review|processed|rejected] [--scope session|project|practice|personal] [--json]",
    };
  }
  return { projectKey, status, scope, json };
}

function parseCandidateShowArgs(args: string[]): { id: string; json: boolean; error?: string } {
  let id = "";
  let json = false;

  for (const arg of args) {
    if (arg === "--json") json = true;
    else if (arg.startsWith("-")) return { id, json, error: `Unknown memory candidate show option: ${arg}` };
    else if (!id) id = arg;
    else return { id, json, error: `Unexpected memory candidate show argument: ${arg}` };
  }

  if (!id) return { id, json, error: "Usage: myelin memory candidate show <candidate-id> [--json]" };
  return { id, json };
}

function parseArgs(args: string[]): {
  projectKey: string;
  question: string;
  json: boolean;
  debug: boolean;
  error?: string;
} {
  let projectKey = "";
  let question = "";
  let json = false;
  let debug = false;

  for (const arg of args) {
    if (arg === "--json") {
      json = true;
    } else if (arg === "--debug") {
      debug = true;
    } else if (arg.startsWith("-")) {
      return { projectKey, question, json, debug, error: `Unknown memory query option: ${arg}` };
    } else if (!projectKey) {
      projectKey = arg;
    } else if (!question) {
      question = arg;
    } else {
      question = `${question} ${arg}`;
    }
  }

  if (!projectKey || !question) {
    return { projectKey, question, json, debug, error: "Usage: myelin memory query <key> <question> [--json] [--debug]" };
  }
  return { projectKey, question, json, debug };
}
