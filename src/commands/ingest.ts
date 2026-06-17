import type { Cli } from "./registry.ts";
import { fail, ok } from "./registry.ts";
import {
  IngestService,
  type IngestProvider,
  type IngestServiceDeps,
  type StartIngestResult,
} from "../ingest/ingest-service.ts";
import { repoRoot } from "../runtime/fs.ts";

export type IngestCommandDeps = IngestServiceDeps;

export function registerIngestCommands(cli: Cli, deps: IngestCommandDeps = {}): void {
  cli.command(["ingest", "status"], (args) => status(args, deps));
  cli.command(["ingest", "worker"], (args) => worker(args, deps));
  cli.command(["ingest"], (args) => start(args, deps));
}

async function start(args: string[], deps: IngestCommandDeps) {
  const parsed = parseStartArgs(args);
  if (parsed.error) return fail(parsed.error);

  try {
    const result = await new IngestService(repoRoot().root, deps).start({
      projectKey: parsed.projectKey,
      limit: parsed.limit,
      batchSize: parsed.batchSize,
      provider: parsed.provider,
    });
    return renderStart(result, parsed.json);
  } catch (error) {
    return fail(error instanceof Error ? error.message : String(error));
  }
}

function status(args: string[], deps: IngestCommandDeps) {
  const parsed = parseStatusArgs(args);
  if (parsed.error) return fail(parsed.error);

  try {
    const result = new IngestService(repoRoot().root, deps).status({
      jobId: parsed.jobId,
      projectKey: parsed.projectKey,
    });
    if (result.kind === "project") {
      return parsed.json
        ? ok(JSON.stringify({ status: result.status }, null, 2))
        : ok(`${result.status.project_key}: ${result.status.completion_label}`);
    }

    return parsed.json
      ? ok(JSON.stringify({ job: result.job }, null, 2))
      : ok(`Ingest job ${result.job.id} [${result.job.status}] project=${result.job.project_key} provider=${result.job.provider}`);
  } catch (error) {
    return fail(error instanceof Error ? error.message : String(error));
  }
}

async function worker(args: string[], deps: IngestCommandDeps) {
  const jobId = args[0];
  if (!jobId || args.length > 1) return fail("Usage: myelin ingest worker <ingest-job-id>");

  const root = process.env.MYELIN_ROOT ?? repoRoot().root;
  try {
    await new IngestService(root, deps).runWorker(jobId);
    return ok(`Completed ingest worker ${jobId}.`);
  } catch (error) {
    return fail(error instanceof Error ? error.message : String(error));
  }
}

function renderStart(result: StartIngestResult, json: boolean) {
  if (json) {
    return ok(JSON.stringify(stripKind(result), null, 2));
  }

  const warning = result.target_branch && result.target_branch !== "master"
    ? `\nWarning: ingesting with target repo on ${result.target_branch}. Captured rows may include multiple branches; branch context is preserved per row.`
    : "";
  if (result.kind === "no_work") return ok(`No queued Experience Log rows for ${result.project_key}.${warning}`);
  return ok(
    `Started ${result.jobs.length} ingest job${result.jobs.length === 1 ? "" : "s"} for ${result.project_key}.` +
      `\nqueued: ${result.queued_count}; selected: ${result.selected_count}; batch size: ${result.batch_size}${warning}`,
  );
}

function stripKind<T extends { kind: string }>(value: T): Omit<T, "kind"> {
  const { kind: _kind, ...rest } = value;
  return rest;
}

function parseStartArgs(args: string[]): {
  projectKey: string;
  limit?: number;
  batchSize?: number;
  json: boolean;
  provider: IngestProvider;
  error?: string;
} {
  let projectKey = "";
  let limit: number | undefined;
  let batchSize: number | undefined;
  let json = false;
  let provider: IngestProvider = "codex";

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === "--json") json = true;
    else if (arg === "--limit") {
      const value = Number(args[++index]);
      if (!Number.isInteger(value) || value <= 0) {
        return { projectKey, json, provider, error: "--limit must be a positive integer" };
      }
      limit = value;
    } else if (arg === "--batch-size") {
      const value = Number(args[++index]);
      if (!Number.isInteger(value) || value <= 0 || value > 500) {
        return { projectKey, limit, batchSize, json, provider, error: "--batch-size must be an integer between 1 and 500" };
      }
      batchSize = value;
    } else if (arg === "--provider") {
      const value = args[++index];
      if (value !== "codex" && value !== "claude") {
        return { projectKey, limit, batchSize, json, provider, error: "--provider must be codex or claude" };
      }
      provider = value;
    } else if (arg.startsWith("-")) {
      return { projectKey, limit, batchSize, json, provider, error: `Unknown ingest option: ${arg}` };
    } else if (!projectKey) {
      projectKey = arg;
    } else {
      return { projectKey, limit, batchSize, json, provider, error: `Unexpected ingest argument: ${arg}` };
    }
  }

  if (!projectKey) {
    return {
      projectKey,
      limit,
      batchSize,
      json,
      provider,
      error: "Usage: myelin ingest <project-key> [--limit N] [--batch-size N] [--json]",
    };
  }
  return { projectKey, limit, batchSize, json, provider };
}

function parseStatusArgs(args: string[]): { jobId?: string; projectKey?: string; json: boolean; error?: string } {
  let jobId = "";
  let projectKey = "";
  let json = false;

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === "--json") json = true;
    else if (arg === "--project") projectKey = args[++index] ?? "";
    else if (arg.startsWith("-")) return { jobId, projectKey, json, error: `Unknown ingest status option: ${arg}` };
    else if (!jobId) jobId = arg;
    else return { jobId, projectKey, json, error: `Unexpected ingest status argument: ${arg}` };
  }

  if (!jobId && !projectKey) {
    return {
      jobId,
      projectKey,
      json,
      error: "Usage: myelin ingest status <ingest-job-id> [--json] OR myelin ingest status --project <project-key> [--json]",
    };
  }
  return { jobId: jobId || undefined, projectKey: projectKey || undefined, json };
}
