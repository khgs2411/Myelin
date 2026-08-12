import type { IngestJobRow } from "../memory/ingest-types.ts";
import type { LaunchContext } from "../runtime/launch-context.ts";
import type {
  DetachedSpawner,
  ProcessLivenessChecker,
  RuntimeProcessRunner,
  launchDetachedIngestWorker,
} from "./runtime.ts";
import type { IngestProjectStatus } from "./status.ts";
import type { runIngestWorker } from "./worker.ts";

export type IngestProvider = "codex" | "claude";

export type IngestServiceDeps = {
  now?: () => Date;
  runner?: RuntimeProcessRunner;
  spawn?: DetachedSpawner;
  isProcessAlive?: ProcessLivenessChecker;
  runWorker?: typeof runIngestWorker;
  context?: LaunchContext;
};

export type StartIngestInput = {
  projectKey: string;
  limit?: number;
  batchSize?: number;
  provider: IngestProvider;
};

export type StartIngestResult =
  | {
      kind: "no_work";
      project_key: string;
      queued_count: number;
      batch_size: number;
      target_branch: string | null;
      jobs: IngestJobRow[];
    }
  | {
      kind: "started";
      project_key: string;
      queued_count: number;
      selected_count: number;
      batch_size: number;
      batch_count: number;
      target_branch: string | null;
      job: IngestJobRow;
      jobs: IngestJobRow[];
      launches: Array<Awaited<ReturnType<typeof launchDetachedIngestWorker>>>;
    };

export type IngestStatusResult =
  | { kind: "project"; status: IngestProjectStatus }
  | { kind: "job"; job: IngestJobRow };
