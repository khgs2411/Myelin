import type { Cli, CommandResult } from "./registry.ts";
import { fail, ok } from "./registry.ts";
import { openMemoryDb } from "../memory/db.ts";
import { EmbeddingProviderFactory } from "../memory/embedding-provider-factory.ts";
import type { MemoryCandidateStatus, MemoryScope } from "../memory/ingest-types.ts";
import { MemoryCandidateService } from "../memory/memory-candidate-service.ts";
import { SessionMemoryIndexService } from "../memory/session-memory-index-service.ts";
import { repoRoot } from "../runtime/fs.ts";
import { DEFAULT_EMBEDDING_BATCH_SIZE, loadConfig, MAX_EMBEDDING_BATCH_SIZE, selectActiveEmbeddingContract } from "../runtime/config.ts";
import { queryMemory } from "../query/engine.ts";

export function registerMemoryCommands(cli: Cli): void {
  cli.command(["memory", "candidates"], (args) => candidates(args));
  cli.command(["memory", "candidate", "show"], (args) => candidateShow(args));
  cli.command(["memory", "index", "session"], (args) => indexSession(args));
  cli.command(["memory", "query"], async (args) => {
    const parsed = parseArgs(args);
    if (parsed.error) return fail(parsed.error);

    const response = await queryMemory({
      root: repoRoot().root,
      projectKey: parsed.projectKey,
      question: parsed.question,
      limit: parsed.limit,
      includeRoute: parsed.debug,
      branch: parsed.branch,
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
  const provider = new EmbeddingProviderFactory(config).create();
  const db = openMemoryDb(root);
  try {
    const service = new SessionMemoryIndexService({
      db,
      contract,
      provider,
    });
    const response = await service.indexPending({
      projectKey: parsed.projectKey,
      limit: parsed.limit,
      batchSize: parsed.batchSize ?? config.embedding.batchSize,
      retryFailed: parsed.retryFailed,
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

function candidates(args: string[]): CommandResult {
  const parsed = parseCandidateListArgs(args);
  if (parsed.error) return fail(parsed.error);

  const result = candidateService().list({
    projectKey: parsed.projectKey,
    status: parsed.status,
    scope: parsed.scope,
  });
  if (parsed.json) return ok(JSON.stringify(result, null, 2));
  if (result.candidates.length === 0) return ok(`No memory candidates for ${parsed.projectKey}.`);
  return ok(result.candidates.map((row) => `${row.id} [${row.status}] ${row.scope}: ${row.summary}`).join("\n"));
}

function candidateShow(args: string[]): CommandResult {
  const parsed = parseCandidateShowArgs(args);
  if (parsed.error) return fail(parsed.error);

  try {
    const result = candidateService().show(parsed.id);
    const row = result.candidate;
    return parsed.json ? ok(JSON.stringify(result, null, 2)) : ok(`${row.id} [${row.status}] ${row.scope}\n${row.summary}`);
  } catch (error) {
    return fail(error instanceof Error ? error.message : String(error));
  }
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
        status = candidateService().normalizeStatus(args[++index] ?? "");
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
  limit: number;
  json: boolean;
  debug: boolean;
  branch?: string;
  error?: string;
} {
  let projectKey = "";
  let question = "";
  let limit = 5;
  let json = false;
  let debug = false;
  let branch: string | undefined;

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === "--json") {
      json = true;
    } else if (arg === "--debug") {
      debug = true;
    } else if (arg === "--branch") {
      const value = args[++index];
      if (!value) return { projectKey, question, limit, json, debug, branch, error: "--branch requires a value" };
      branch = value;
    } else if (arg === "--limit") {
      const value = args[++index];
      const parsed = Number(value);
      if (!Number.isInteger(parsed) || parsed <= 0) {
        return { projectKey, question, limit, json, debug, branch, error: "--limit must be a positive integer" };
      }
      limit = parsed;
    } else if (arg.startsWith("-")) {
      return { projectKey, question, limit, json, debug, branch, error: `Unknown memory query option: ${arg}` };
    } else if (!projectKey) {
      projectKey = arg;
    } else if (!question) {
      question = arg;
    } else {
      question = `${question} ${arg}`;
    }
  }

  if (!projectKey || !question) {
    return {
      projectKey,
      question,
      limit,
      json,
      debug,
      branch,
      error: "Usage: myelin memory query <key> <question> [--limit N] [--branch current|<name>] [--json] [--debug]",
    };
  }
  return { projectKey, question, limit, json, debug, branch };
}

function candidateService(): MemoryCandidateService {
  return new MemoryCandidateService(repoRoot().root);
}
