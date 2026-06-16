import { createIngestJob, getIngestJob, updateIngestJobStatus } from "./jobs.ts";
import { readIngestProjectStatus, type IngestProjectStatus } from "./status.ts";
import {
  assertMasterBranch,
  launchDetachedIngestWorker,
  refreshDetachedIngestJobStatus,
  resolveIngestTargetRepo,
  type DetachedSpawner,
  type ProcessLivenessChecker,
  type RuntimeProcessRunner,
} from "./runtime.ts";
import { runIngestWorker } from "./worker.ts";
import { openMemoryDb } from "../memory/db.ts";
import { countExperienceEvents } from "../memory/experience.ts";
import type { IngestJobRow } from "../memory/ingest-types.ts";
import { loadConfig } from "../runtime/config.ts";
import { createId } from "../runtime/ids.ts";

export type IngestProvider = "codex" | "claude";

export type IngestServiceDeps = {
  now?: () => Date;
  runner?: RuntimeProcessRunner;
  spawn?: DetachedSpawner;
  isProcessAlive?: ProcessLivenessChecker;
  runWorker?: typeof runIngestWorker;
};

export type StartIngestInput = {
  projectKey: string;
  limit?: number;
  batchSize?: number;
  provider: IngestProvider;
};

export type StartIngestResult =
  | {
      kind: "branch_mismatch";
      project_key: string;
      job: IngestJobRow;
      jobs: IngestJobRow[];
      branch: string;
    }
  | {
      kind: "no_work";
      project_key: string;
      queued_count: number;
      batch_size: number;
      jobs: IngestJobRow[];
    }
  | {
      kind: "started";
      project_key: string;
      queued_count: number;
      selected_count: number;
      batch_size: number;
      batch_count: number;
      job: IngestJobRow;
      jobs: IngestJobRow[];
      launches: Array<Awaited<ReturnType<typeof launchDetachedIngestWorker>>>;
    };

export type IngestStatusResult =
  | { kind: "project"; status: IngestProjectStatus }
  | { kind: "job"; job: IngestJobRow };

export class IngestService {
  constructor(
    private readonly root: string,
    private readonly deps: IngestServiceDeps = {},
  ) {}

  async start(input: StartIngestInput): Promise<StartIngestResult> {
    const db = openMemoryDb(this.root);
    const now = this.now();
    try {
      const config = await loadConfig(this.root);
      const batchSize = input.batchSize ?? config.ingest.batchSize;
      const targetRepo = await resolveIngestTargetRepo(this.root, input.projectKey);
      const branch = await assertMasterBranch(targetRepo, this.deps.runner);

      if (!branch.ok) {
        const job = createIngestJob(db, {
          id: `ingest_${createId()}`,
          project_key: input.projectKey,
          provider: input.provider,
          input: { limit: input.limit, target_repo: targetRepo, batch_size: batchSize },
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
        return {
          kind: "branch_mismatch",
          project_key: input.projectKey,
          job: failed,
          jobs: [failed],
          branch: branch.branch,
        };
      }

      const queuedCount = countExperienceEvents(db, input.projectKey);
      const selectedCount = input.limit === undefined ? queuedCount : Math.min(input.limit, queuedCount);
      if (selectedCount === 0) {
        return {
          kind: "no_work",
          project_key: input.projectKey,
          queued_count: queuedCount,
          batch_size: batchSize,
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
        });
        jobs.push(getIngestJob(db, job.id) ?? job);
        launches.push(launched);
      }

      return {
        kind: "started",
        project_key: input.projectKey,
        queued_count: queuedCount,
        selected_count: selectedCount,
        batch_size: batchSize,
        batch_count: batchCount,
        job: jobs[0],
        jobs,
        launches,
      };
    } finally {
      db.close();
    }
  }

  status(input: { jobId?: string; projectKey?: string }): IngestStatusResult {
    const db = openMemoryDb(this.root);
    try {
      if (input.projectKey) {
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
