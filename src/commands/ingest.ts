import type { Cli } from "./registry.ts";
import { fail, ok } from "./registry.ts";
import {
  IngestService,
  type IngestProvider,
  type IngestServiceDeps,
  type StartIngestResult,
} from "../ingest/ingest-service.ts";
import {
  IngestJobAdminService,
  ingestJobErrorCode,
  type IngestJobAdminServiceDeps,
} from "../ingest/job-admin-service.ts";
import { INGEST_JOB_STATUSES, type IngestJobRow, type IngestJobStatus } from "../memory/ingest-types.ts";
import type { LaunchContext } from "../runtime/launch-context.ts";

export type IngestCommandDeps = IngestServiceDeps & IngestJobAdminServiceDeps & { context: LaunchContext };

export function registerIngestCommands(cli: Cli, deps: IngestCommandDeps): void {
  cli.command(["ingest", "jobs", "resolve"], (args) => resolveJobs(args, deps));
  cli.command(["ingest", "jobs"], (args) => jobs(args, deps));
  cli.command(["ingest", "status"], (args) => status(args, deps));
  cli.command(["ingest", "worker"], (args) => worker(args, deps));
  cli.command(["ingest"], (args) => start(args, deps));
}

function jobs(args: string[], deps: IngestCommandDeps) {
  const parsed = parseJobsArgs(args);
  if (parsed.error) return fail(parsed.error);

  const result = new IngestJobAdminService(deps.context.myelinRoot, deps).list({
    projectKey: parsed.projectKey,
    status: parsed.status,
    limit: parsed.limit,
  });
  if (parsed.json) return ok(JSON.stringify(result, null, 2));
  if (result.jobs.length === 0) return ok(`No ingest jobs for ${parsed.projectKey}.`);
  return ok(result.jobs.map(formatIngestJob).join("\n"));
}

function resolveJobs(args: string[], deps: IngestCommandDeps) {
  const parsed = parseResolveJobsArgs(args);
  if (parsed.error) return fail(parsed.error);

  const result = new IngestJobAdminService(deps.context.myelinRoot, deps).resolveFailed({
    projectKey: parsed.projectKey,
    ids: parsed.ids,
    errorCode: parsed.errorCode,
    reason: parsed.reason,
    dryRun: parsed.dryRun,
  });
  if (parsed.json) return ok(JSON.stringify(result, null, 2));
  const verb = result.dry_run ? "Would resolve" : "Resolved";
  if (result.resolved.length === 0) return ok(`${verb} 0 failed ingest jobs for ${parsed.projectKey}.`);
  return ok(`${verb} ${result.resolved.length} failed ingest job${result.resolved.length === 1 ? "" : "s"} for ${parsed.projectKey}.`);
}

async function start(args: string[], deps: IngestCommandDeps) {
  const parsed = parseStartArgs(args);
  if (parsed.error) return fail(parsed.error);

  try {
    const result = await new IngestService(deps.context.myelinRoot, deps).start({
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

async function status(args: string[], deps: IngestCommandDeps) {
  const parsed = parseStatusArgs(args);
  if (parsed.error) return fail(parsed.error);

  try {
    const result = await new IngestService(deps.context.myelinRoot, deps).status({
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

  try {
    await new IngestService(deps.context.myelinRoot, deps).runWorker(jobId);
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

function parseJobsArgs(args: string[]): {
  projectKey: string;
  status?: IngestJobStatus;
  limit: number;
  json: boolean;
  error?: string;
} {
  let projectKey = "";
  let status: IngestJobStatus | undefined;
  let limit = 50;
  let json = false;

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === "--json") json = true;
    else if (arg === "--status") {
      const parsed = parseIngestJobStatus(args[++index]);
      if (!parsed) return { projectKey, status, limit, json, error: "--status must be one of: starting, running, needs_followup, completed, failed" };
      status = parsed;
    } else if (arg === "--limit") {
      const parsed = parsePositiveInteger(args[++index]);
      if (!parsed) return { projectKey, status, limit, json, error: "--limit must be a positive integer" };
      limit = parsed;
    } else if (arg.startsWith("-")) {
      return { projectKey, status, limit, json, error: `Unknown ingest jobs option: ${arg}` };
    } else if (!projectKey) {
      projectKey = arg;
    } else {
      return { projectKey, status, limit, json, error: `Unexpected ingest jobs argument: ${arg}` };
    }
  }

  if (!projectKey) {
    return {
      projectKey,
      status,
      limit,
      json,
      error: "Usage: myelin ingest jobs <project-key> [--status starting|running|needs_followup|completed|failed] [--limit N] [--json]",
    };
  }
  return { projectKey, status, limit, json };
}

function parseResolveJobsArgs(args: string[]): {
  projectKey: string;
  ids: string[];
  errorCode?: string;
  reason: string;
  dryRun: boolean;
  json: boolean;
  error?: string;
} {
  let projectKey = "";
  const ids: string[] = [];
  let errorCode: string | undefined;
  let reason = "";
  let dryRun = false;
  let json = false;
  let all = false;

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === "--json") json = true;
    else if (arg === "--dry-run") dryRun = true;
    else if (arg === "--all") all = true;
    else if (arg === "--id") {
      const value = args[++index];
      if (!value) return { projectKey, ids, errorCode, reason, dryRun, json, error: "--id requires a value" };
      ids.push(value);
    } else if (arg === "--code") {
      const value = args[++index];
      if (!value) return { projectKey, ids, errorCode, reason, dryRun, json, error: "--code requires a value" };
      errorCode = value;
    } else if (arg === "--reason") {
      const value = args[++index];
      if (!value) return { projectKey, ids, errorCode, reason, dryRun, json, error: "--reason requires a value" };
      reason = value;
    } else if (arg.startsWith("-")) {
      return { projectKey, ids, errorCode, reason, dryRun, json, error: `Unknown ingest jobs resolve option: ${arg}` };
    } else if (!projectKey) {
      projectKey = arg;
    } else {
      return { projectKey, ids, errorCode, reason, dryRun, json, error: `Unexpected ingest jobs resolve argument: ${arg}` };
    }
  }

  if (!projectKey) {
    return {
      projectKey,
      ids,
      errorCode,
      reason,
      dryRun,
      json,
      error: "Usage: myelin ingest jobs resolve <project-key> (--id <job-id> | --all) --reason <text> [--code <error-code>] [--dry-run] [--json]",
    };
  }
  if (!reason) return { projectKey, ids, errorCode, reason, dryRun, json, error: "--reason is required" };
  if (!all && ids.length === 0) return { projectKey, ids, errorCode, reason, dryRun, json, error: "Use --id <job-id> or --all" };
  if (all && ids.length > 0) return { projectKey, ids, errorCode, reason, dryRun, json, error: "Use either --all or --id, not both" };
  return { projectKey, ids, errorCode, reason, dryRun, json };
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

function parseIngestJobStatus(value: string | undefined): IngestJobStatus | null {
  if (!value) return null;
  return (INGEST_JOB_STATUSES as readonly string[]).includes(value) ? (value as IngestJobStatus) : null;
}

function parsePositiveInteger(value: string | undefined): number | null {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
}

function formatIngestJob(job: IngestJobRow): string {
  const code = ingestJobErrorCode(job);
  const error = code ? ` error=${code}` : "";
  return `${job.id} [${job.status}] provider=${job.provider} created=${job.created_at}${error}`;
}
