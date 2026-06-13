import type { Cli } from "./registry.ts";
import { fail, ok } from "./registry.ts";
import { createIngestJob, getIngestJob } from "../ingest/jobs.ts";
import {
  launchDetachedIngestWorker,
  refreshDetachedIngestJobStatus,
  resolveIngestTargetRepo,
  type DetachedSpawner,
  type ProcessLivenessChecker,
  type RuntimeProcessRunner,
} from "../ingest/runtime.ts";
import { runIngestWorker } from "../ingest/worker.ts";
import { openMemoryDb } from "../memory/db.ts";
import { repoRoot } from "../runtime/fs.ts";
import { createId } from "../runtime/ids.ts";

type IngestProvider = "codex" | "claude";

export type IngestCommandDeps = {
  now?: () => Date;
  runner?: RuntimeProcessRunner;
  spawn?: DetachedSpawner;
  isProcessAlive?: ProcessLivenessChecker;
  runWorker?: typeof runIngestWorker;
};

export function registerIngestCommands(cli: Cli, deps: IngestCommandDeps = {}): void {
  cli.command(["ingest", "status"], (args) => status(args, deps));
  cli.command(["ingest", "worker"], (args) => worker(args, deps));
  cli.command(["ingest"], (args) => start(args, deps));
}

async function start(args: string[], deps: IngestCommandDeps) {
  const parsed = parseStartArgs(args);
  if (parsed.error) return fail(parsed.error);

  const root = repoRoot().root;
  const db = openMemoryDb(root);
  const now = (deps.now ?? (() => new Date()))().toISOString();

  try {
    const targetRepo = await resolveIngestTargetRepo(root, parsed.projectKey);
    const job = createIngestJob(db, {
      id: `ingest_${createId()}`,
      project_key: parsed.projectKey,
      provider: parsed.provider,
      input: { limit: parsed.limit, target_repo: targetRepo },
      now,
    });

    const launched = await launchDetachedIngestWorker({
      db,
      root,
      projectKey: parsed.projectKey,
      jobId: job.id,
      now,
      runner: deps.runner,
      spawn: deps.spawn,
    });
    const current = getIngestJob(db, job.id) ?? job;

    if (parsed.json) return ok(JSON.stringify({ job: current }, null, 2));
    if (launched.status === "failed") {
      return fail(`Ingest job ${job.id} failed: target repo is on ${launched.branch}, expected master.`);
    }
    return ok(`Started ingest job ${job.id} for ${job.project_key}.\nlog: ${launched.logPath}`);
  } catch (error) {
    return fail(error instanceof Error ? error.message : String(error));
  } finally {
    db.close();
  }
}

function status(args: string[], deps: IngestCommandDeps) {
  const parsed = parseStatusArgs(args);
  if (parsed.error) return fail(parsed.error);

  const db = openMemoryDb(repoRoot().root);
  try {
    const job = getIngestJob(db, parsed.jobId);
    if (!job) return fail(`Unknown ingest job: ${parsed.jobId}`);
    const current = refreshDetachedIngestJobStatus({
      db,
      job,
      now: (deps.now ?? (() => new Date()))().toISOString(),
      isAlive: deps.isProcessAlive,
    });
    return parsed.json
      ? ok(JSON.stringify({ job: current }, null, 2))
      : ok(`Ingest job ${current.id} [${current.status}] project=${current.project_key} provider=${current.provider}`);
  } finally {
    db.close();
  }
}

async function worker(args: string[], deps: IngestCommandDeps) {
  const jobId = args[0];
  if (!jobId || args.length > 1) return fail("Usage: myelin ingest worker <ingest-job-id>");

  const root = process.env.MYELIN_ROOT ?? repoRoot().root;
  const db = openMemoryDb(root);
  try {
    const job = getIngestJob(db, jobId);
    if (!job) return fail(`Unknown ingest job: ${jobId}`);
    const input = JSON.parse(job.input_json) as { target_repo?: string; limit?: number };
    if (!input.target_repo) return fail(`Ingest job ${jobId} missing target_repo`);

    await (deps.runWorker ?? runIngestWorker)({
      root,
      projectKey: job.project_key,
      jobId: job.id,
      targetRepo: input.target_repo,
      provider: job.provider === "claude" ? "claude" : "codex",
      providerSessionId: job.provider_session_id,
      limit: input.limit,
    });
    return ok(`Completed ingest worker ${jobId}.`);
  } catch (error) {
    return fail(error instanceof Error ? error.message : String(error));
  } finally {
    db.close();
  }
}

function parseStartArgs(args: string[]): {
  projectKey: string;
  limit?: number;
  json: boolean;
  provider: IngestProvider;
  error?: string;
} {
  let projectKey = "";
  let limit: number | undefined;
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
    } else if (arg === "--provider") {
      const value = args[++index];
      if (value !== "codex" && value !== "claude") {
        return { projectKey, json, provider, error: "--provider must be codex or claude" };
      }
      provider = value;
    } else if (arg.startsWith("-")) {
      return { projectKey, json, provider, error: `Unknown ingest option: ${arg}` };
    } else if (!projectKey) {
      projectKey = arg;
    } else {
      return { projectKey, json, provider, error: `Unexpected ingest argument: ${arg}` };
    }
  }

  if (!projectKey) {
    return { projectKey, json, provider, error: "Usage: myelin ingest <project-key> [--limit N] [--json]" };
  }
  return { projectKey, limit, json, provider };
}

function parseStatusArgs(args: string[]): { jobId: string; json: boolean; error?: string } {
  let jobId = "";
  let json = false;

  for (const arg of args) {
    if (arg === "--json") json = true;
    else if (arg.startsWith("-")) return { jobId, json, error: `Unknown ingest status option: ${arg}` };
    else if (!jobId) jobId = arg;
    else return { jobId, json, error: `Unexpected ingest status argument: ${arg}` };
  }

  if (!jobId) return { jobId, json, error: "Usage: myelin ingest status <ingest-job-id> [--json]" };
  return { jobId, json };
}
