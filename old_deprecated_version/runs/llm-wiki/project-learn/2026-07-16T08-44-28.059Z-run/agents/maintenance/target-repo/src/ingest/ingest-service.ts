import { createIngestJob, getIngestJob } from "./jobs.ts";
import { readIngestProjectStatus } from "./status.ts";
import {
  launchDetachedIngestWorker,
  readCurrentGitBranch,
  refreshDetachedIngestJobStatus,
  resolveIngestTargetRepo,
} from "./runtime.ts";
import { runIngestWorker } from "./worker.ts";
import { openMemoryDb } from "../memory/db.ts";
import { countExperienceEvents } from "../memory/experience.ts";
import type { IngestJobRow } from "../memory/ingest-types.ts";
import { loadConfig, MAX_INGEST_BATCH_SIZE } from "../runtime/config.ts";
import { createId } from "../runtime/ids.ts";
import { findProject } from "../runtime/projects.ts";
import type {
  IngestServiceDeps,
  IngestStatusResult,
  StartIngestInput,
  StartIngestResult,
} from "./ingest-service-contracts.ts";

export type {
  IngestProvider,
  IngestServiceDeps,
  IngestStatusResult,
  StartIngestInput,
  StartIngestResult,
} from "./ingest-service-contracts.ts";

export class IngestService {
  constructor(
    private readonly root: string,
    private readonly deps: IngestServiceDeps = {},
  ) {}

  async start(input: StartIngestInput): Promise<StartIngestResult> {
    assertPositiveInteger("ingest limit", input.limit);

    const db = openMemoryDb(this.root);
    const now = this.now();
    try {
      const config = await loadConfig(this.root);
      const batchSize = input.batchSize ?? config.ingest.batchSize;
      assertPositiveInteger("ingest batch size", batchSize, MAX_INGEST_BATCH_SIZE);
      const targetRepo = await resolveIngestTargetRepo(this.root, input.projectKey);
      const targetBranch = await readCurrentGitBranch(targetRepo, this.deps.runner);

      const queuedCount = countExperienceEvents(db, input.projectKey);
      const selectedCount = input.limit === undefined ? queuedCount : Math.min(input.limit, queuedCount);
      if (selectedCount === 0) {
        return {
          kind: "no_work",
          project_key: input.projectKey,
          queued_count: queuedCount,
          batch_size: batchSize,
          target_branch: targetBranch,
          jobs: [],
        };
      }

      const batchCount = Math.ceil(selectedCount / batchSize);
      const jobs: IngestJobRow[] = [];
      const launches: Array<Awaited<ReturnType<typeof launchDetachedIngestWorker>>> = [];

      for (let index = 0; index < batchCount; index += 1) {
        const batchIndex = index + 1;
        const batchLimit = Math.min(batchSize, selectedCount - index * batchSize);
        const job = createIngestJob(db, {
          id: `ingest_${createId()}`,
          project_key: input.projectKey,
          provider: input.provider,
          input: {
            limit: batchLimit,
            target_repo: targetRepo,
            target_branch: targetBranch,
            batch_size: batchSize,
            batch_index: batchIndex,
            batch_count: batchCount,
            worker_concurrency: config.ingest.workerConcurrency,
          },
          now,
        });

        const launched = await launchDetachedIngestWorker({
          db,
          root: this.root,
          projectKey: input.projectKey,
          jobId: job.id,
          now,
          env: {
            ...process.env,
            MYELIN_INGEST_START_DELAY_MS: String((index + 1) * config.ingest.workerStartDelayMs),
          },
          runner: this.deps.runner,
          spawn: this.deps.spawn,
          context: this.deps.context,
        });
        jobs.push(getIngestJob(db, job.id) ?? job);
        launches.push(launched);
      }

      const firstJob = jobs[0];
      if (!firstJob) throw new Error("Ingest started without creating a job");

      return {
        kind: "started",
        project_key: input.projectKey,
        queued_count: queuedCount,
        selected_count: selectedCount,
        batch_size: batchSize,
        batch_count: batchCount,
        target_branch: targetBranch,
        job: firstJob,
        jobs,
        launches,
      };
    } finally {
      db.close();
    }
  }

  async status(input: { jobId?: string; projectKey?: string }): Promise<IngestStatusResult> {
    const db = openMemoryDb(this.root);
    try {
      if (input.projectKey) {
        await findProject(this.root, input.projectKey);
        this.refreshRunningProjectIngestJobs(db, input.projectKey);
        return { kind: "project", status: readIngestProjectStatus(db, input.projectKey) };
      }

      const job = getIngestJob(db, input.jobId ?? "");
      if (!job) throw new Error(`Unknown ingest job: ${input.jobId}`);
      return {
        kind: "job",
        job: refreshDetachedIngestJobStatus({
          db,
          job,
          now: this.now(),
          isAlive: this.deps.isProcessAlive,
        }),
      };
    } finally {
      db.close();
    }
  }

  async runWorker(jobId: string): Promise<void> {
    await sleep(Number(process.env.MYELIN_INGEST_START_DELAY_MS ?? 0));

    const db = openMemoryDb(this.root);
    try {
      const job = getIngestJob(db, jobId);
      if (!job) throw new Error(`Unknown ingest job: ${jobId}`);
      const input = JSON.parse(job.input_json) as {
        target_repo?: string;
        limit?: number;
        batch_size?: number;
        batch_index?: number;
        batch_count?: number;
      };
      if (!input.target_repo) throw new Error(`Ingest job ${jobId} missing target_repo`);

      await (this.deps.runWorker ?? runIngestWorker)({
        root: this.root,
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
    } finally {
      db.close();
    }
  }

  private refreshRunningProjectIngestJobs(db: ReturnType<typeof openMemoryDb>, projectKey: string): void {
    const jobs = db
      .query("SELECT * FROM ingest_jobs WHERE project_key = ? AND status = 'running' ORDER BY created_at, id")
      .all(projectKey) as IngestJobRow[];
    for (const job of jobs) {
      refreshDetachedIngestJobStatus({
        db,
        job,
        now: this.now(),
        isAlive: this.deps.isProcessAlive,
      });
    }
  }

  private now(): string {
    return (this.deps.now ?? (() => new Date()))().toISOString();
  }
}

async function sleep(ms: number): Promise<void> {
  if (!Number.isFinite(ms) || ms <= 0) return;
  await new Promise((resolve) => setTimeout(resolve, ms));
}

function assertPositiveInteger(name: string, value: number | undefined, maximum?: number): void {
  if (value === undefined) return;
  if (!Number.isInteger(value) || value <= 0 || (maximum !== undefined && value > maximum)) {
    const expected = maximum === undefined ? "a positive integer" : `an integer between 1 and ${maximum}`;
    throw new Error(`Invalid ${name}: ${value}. Expected ${expected}`);
  }
}
