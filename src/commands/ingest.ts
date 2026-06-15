import type { Cli } from "./registry.ts";
import { fail, ok } from "./registry.ts";
import { createIngestJob, getIngestJob, updateIngestJobStatus } from "../ingest/jobs.ts";
import {
  assertMasterBranch,
  launchDetachedIngestWorker,
  refreshDetachedIngestJobStatus,
  resolveIngestTargetRepo,
  type DetachedSpawner,
  type ProcessLivenessChecker,
  type RuntimeProcessRunner,
} from "../ingest/runtime.ts";
import { runIngestWorker } from "../ingest/worker.ts";
import { openMemoryDb } from "../memory/db.ts";
import { countExperienceEvents } from "../memory/experience.ts";
import { loadConfig } from "../runtime/config.ts";
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
    const config = await loadConfig(root);
    const batchSize = parsed.batchSize ?? config.ingest.batchSize;
    const targetRepo = await resolveIngestTargetRepo(root, parsed.projectKey);
    const branch = await assertMasterBranch(targetRepo, deps.runner);

    if (!branch.ok) {
      const job = createIngestJob(db, {
        id: `ingest_${createId()}`,
        project_key: parsed.projectKey,
        provider: parsed.provider,
        input: { limit: parsed.limit, target_repo: targetRepo, batch_size: batchSize },
        now,
      });
      const failed = updateIngestJobStatus(db, {
        id: job.id,
        status: "failed",
        updated_at: now,
        finished_at: now,
        error: {
          code: "target_branch_mismatch",
          expected_branch: "master",
          actual_branch: branch.branch,
          target_repo: targetRepo,
        },
      });
      if (parsed.json) return ok(JSON.stringify({ job: failed, jobs: [failed] }, null, 2));
      return fail(`Ingest job ${job.id} failed: target repo is on ${branch.branch}, expected master.`);
    }

    const queuedCount = countExperienceEvents(db, parsed.projectKey);
    const selectedCount = parsed.limit === undefined ? queuedCount : Math.min(parsed.limit, queuedCount);
    if (selectedCount === 0) {
      const response = { project_key: parsed.projectKey, queued_count: queuedCount, batch_size: batchSize, jobs: [] };
      return parsed.json ? ok(JSON.stringify(response, null, 2)) : ok(`No queued Experience Log rows for ${parsed.projectKey}.`);
    }

    const batchCount = Math.ceil(selectedCount / batchSize);
    const jobs = [];
    const launches = [];

    for (let index = 0; index < batchCount; index += 1) {
      const batchIndex = index + 1;
      const batchLimit = Math.min(batchSize, selectedCount - index * batchSize);
      const job = createIngestJob(db, {
        id: `ingest_${createId()}`,
        project_key: parsed.projectKey,
        provider: parsed.provider,
        input: {
          limit: batchLimit,
          target_repo: targetRepo,
          batch_size: batchSize,
          batch_index: batchIndex,
          batch_count: batchCount,
        },
        now,
      });

      const launched = await launchDetachedIngestWorker({
        db,
        root,
        projectKey: parsed.projectKey,
        jobId: job.id,
        now,
        env: {
          ...process.env,
          MYELIN_INGEST_START_DELAY_MS: String((index + 1) * 750),
        },
        runner: deps.runner,
        spawn: deps.spawn,
      });
      jobs.push(getIngestJob(db, job.id) ?? job);
      launches.push(launched);
    }

    const response = {
      project_key: parsed.projectKey,
      queued_count: queuedCount,
      selected_count: selectedCount,
      batch_size: batchSize,
      batch_count: batchCount,
      job: jobs[0],
      jobs,
      launches,
    };
    if (parsed.json) return ok(JSON.stringify(response, null, 2));
    return ok(
      `Started ${jobs.length} ingest job${jobs.length === 1 ? "" : "s"} for ${parsed.projectKey}.` +
        `\nqueued: ${queuedCount}; selected: ${selectedCount}; batch size: ${batchSize}`,
    );
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

  await sleep(Number(process.env.MYELIN_INGEST_START_DELAY_MS ?? 0));

  const root = process.env.MYELIN_ROOT ?? repoRoot().root;
  const db = openMemoryDb(root);
  try {
    const job = getIngestJob(db, jobId);
    if (!job) return fail(`Unknown ingest job: ${jobId}`);
    const input = JSON.parse(job.input_json) as {
      target_repo?: string;
      limit?: number;
      batch_size?: number;
      batch_index?: number;
      batch_count?: number;
    };
    if (!input.target_repo) return fail(`Ingest job ${jobId} missing target_repo`);

    await (deps.runWorker ?? runIngestWorker)({
      root,
      projectKey: job.project_key,
      jobId: job.id,
      targetRepo: input.target_repo,
      provider: job.provider === "claude" ? "claude" : "codex",
      providerSessionId: job.provider_session_id,
      limit: input.limit,
      batchSize: input.batch_size,
      batchIndex: input.batch_index,
      batchCount: input.batch_count,
    });
    return ok(`Completed ingest worker ${jobId}.`);
  } catch (error) {
    return fail(error instanceof Error ? error.message : String(error));
  } finally {
    db.close();
  }
}

async function sleep(ms: number): Promise<void> {
  if (!Number.isFinite(ms) || ms <= 0) return;
  await new Promise((resolve) => setTimeout(resolve, ms));
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
