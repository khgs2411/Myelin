import type { Cli, CommandResult } from "./registry.ts";
import { fail, ok } from "./registry.ts";
import { getMemoryCandidate, listMemoryCandidates, normalizeCandidateStatus } from "../memory/candidates.ts";
import { openMemoryDb, type MemoryDb } from "../memory/db.ts";
import { createGeminiEmbeddingProvider, createStubEmbeddingProvider } from "../memory/embedding-provider.ts";
import type { MemoryCandidateStatus, MemoryScope } from "../memory/ingest-types.ts";
import { indexSessionMemories } from "../memory/session-memory-indexer.ts";
import { repoRoot } from "../runtime/fs.ts";
import { DEFAULT_EMBEDDING_BATCH_SIZE, loadConfig, MAX_EMBEDDING_BATCH_SIZE, selectActiveEmbeddingContract } from "../runtime/config.ts";
import { queryMemory } from "../query/engine.ts";

export function registerMemoryCommands(cli: Cli): void {
  cli.command(["memory", "candidates"], (args) => withMemoryDb((db) => candidates(db, args)));
  cli.command(["memory", "candidate", "show"], (args) => withMemoryDb((db) => candidateShow(db, args)));
  cli.command(["memory", "index", "session"], (args) => indexSession(args));
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

async function indexSession(args: string[]): Promise<CommandResult> {
  const parsed = parseIndexSessionArgs(args);
  if (parsed.error) return fail(parsed.error);

  const root = repoRoot().root;
  const config = await loadConfig(root);
  const contract = selectActiveEmbeddingContract(config, "retrieval_document");
  const provider = config.embedding.stubResponsesDir
    ? createStubEmbeddingProvider(config.embedding.stubResponsesDir)
    : createGeminiEmbeddingProvider({ apiKey: config.values.GOOGLE_API_KEY ?? config.values.GEMINI_API_KEY });
  const db = openMemoryDb(root);
  try {
    const response = await indexSessionMemories(db, {
      project_key: parsed.projectKey,
      contract,
      provider,
      limit: parsed.limit,
      batch_size: parsed.batchSize ?? config.embedding.batchSize,
      retry_failed: parsed.retryFailed,
    });
    if (parsed.json) return ok(JSON.stringify(response, null, 2));
    const message =
      `Session memory index for ${parsed.projectKey}: ` +
      `${response.indexed} indexed, ${response.failed} failed, ${response.pending_remaining} pending.`;
    return response.degraded ? fail(`${message}\n${response.degraded_reason ?? "Indexing degraded."}`) : ok(message);
  } finally {
    db.close();
  }
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

function parseIndexSessionArgs(args: string[]): {
  projectKey: string;
  limit: number;
  batchSize?: number;
  retryFailed: boolean;
  json: boolean;
  error?: string;
} {
  let projectKey = "";
  let limit = DEFAULT_EMBEDDING_BATCH_SIZE;
  let batchSize: number | undefined;
  let retryFailed = false;
  let json = false;

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === "--json") json = true;
    else if (arg === "--retry-failed") retryFailed = true;
    else if (arg === "--limit") {
      const value = args[++index];
      const parsed = Number(value);
      if (!Number.isInteger(parsed) || parsed <= 0) {
        return { projectKey, limit, batchSize, retryFailed, json, error: "--limit must be a positive integer" };
      }
      limit = parsed;
    } else if (arg === "--batch-size") {
      const value = args[++index];
      const parsed = Number(value);
      if (!Number.isInteger(parsed) || parsed <= 0 || parsed > MAX_EMBEDDING_BATCH_SIZE) {
        return {
          projectKey,
          limit,
          batchSize,
          retryFailed,
          json,
          error: `--batch-size must be an integer between 1 and ${MAX_EMBEDDING_BATCH_SIZE}`,
        };
      }
      batchSize = parsed;
    } else if (arg.startsWith("-")) {
      return { projectKey, limit, batchSize, retryFailed, json, error: `Unknown memory index session option: ${arg}` };
    } else if (!projectKey) {
      projectKey = arg;
    } else {
      return { projectKey, limit, batchSize, retryFailed, json, error: `Unexpected memory index session argument: ${arg}` };
    }
  }

  if (!projectKey) {
    return {
      projectKey,
      limit,
      batchSize,
      retryFailed,
      json,
      error: "Usage: myelin memory index session <project-key> [--limit N] [--batch-size N] [--retry-failed] [--json]",
    };
  }
  return { projectKey, limit, batchSize, retryFailed, json };
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
