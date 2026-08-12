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
import { loadConfig } from "../runtime/config.ts";
import { runSMCAbandonCommand, runSMCGrantCommand, runSMCResumeCommand } from "./smc.ts";

export type IngestCommandDeps = IngestServiceDeps & IngestJobAdminServiceDeps & { context: LaunchContext };

const INGEST_MACHINE_CONTRACT_VERSIONS = [
  "myelin.ingest.jobs.v1",
  "myelin.ingest.jobs-resolution.v1",
  "myelin.ingest.start.v1",
  "myelin.ingest.status.v1",
] as const;
type IngestMachineContractVersion = (typeof INGEST_MACHINE_CONTRACT_VERSIONS)[number];

const INGEST_FAILURE_REASON_CODES = [
  "ingest_jobs_invalid_arguments",
  "ingest_jobs_resolution_invalid_arguments",
  "ingest_start_invalid_arguments",
  "ingest_start_failed",
  "ingest_status_invalid_arguments",
  "ingest_status_failed",
] as const;
type IngestFailureReasonCode = (typeof INGEST_FAILURE_REASON_CODES)[number];

export function registerIngestCommands(cli: Cli, deps: IngestCommandDeps): void {
  cli.command(["ingest", "abandon"], (args) => runSMCAbandonCommand(args, deps));
  cli.command(["ingest", "grant"], (args) => runSMCGrantCommand(args, deps));
  cli.command(["ingest", "resume"], (args) => runSMCResumeCommand(args, deps));
  cli.command(["ingest", "jobs", "resolve"], (args) => resolveJobs(args, deps));
  cli.command(["ingest", "jobs"], (args) => jobs(args, deps));
  cli.command(["ingest", "status"], (args) => status(args, deps));
  cli.command(["ingest", "worker"], (args) => worker(args, deps));
  cli.command(["ingest"], (args) => start(args, deps));
}

function jobs(args: string[], deps: IngestCommandDeps) {
  const parsed = parseJobsArgs(args);
  if (parsed.error) return ingestFailure(parsed.json, "myelin.ingest.jobs.v1", "ingest_jobs_invalid_arguments", parsed.error);

  const result = new IngestJobAdminService(deps.context.myelinRoot, deps).list({
    projectKey: parsed.projectKey,
    status: parsed.status,
    limit: parsed.limit,
  });
  if (parsed.json) return ok(JSON.stringify({
    contract_version: "myelin.ingest.jobs.v1",
    jobs: result.jobs.map(projectAdminJob),
  }, null, 2));
  if (result.jobs.length === 0) return ok(`No ingest jobs for ${parsed.projectKey}.`);
  return ok(result.jobs.map(formatIngestJob).join("\n"));
}

function resolveJobs(args: string[], deps: IngestCommandDeps) {
  const parsed = parseResolveJobsArgs(args);
  if (parsed.error) {
    return ingestFailure(parsed.json, "myelin.ingest.jobs-resolution.v1", "ingest_jobs_resolution_invalid_arguments", parsed.error);
  }

  const result = new IngestJobAdminService(deps.context.myelinRoot, deps).resolveFailed({
    projectKey: parsed.projectKey,
    ids: parsed.ids,
    errorCode: parsed.errorCode,
    reason: parsed.reason,
    dryRun: parsed.dryRun,
  });
  if (parsed.json) return ok(JSON.stringify({
    contract_version: "myelin.ingest.jobs-resolution.v1",
    dry_run: result.dry_run,
    resolved: result.resolved.map(projectJob),
  }, null, 2));
  const verb = result.dry_run ? "Would resolve" : "Resolved";
  if (result.resolved.length === 0) return ok(`${verb} 0 failed ingest jobs for ${parsed.projectKey}.`);
  return ok(`${verb} ${result.resolved.length} failed ingest job${result.resolved.length === 1 ? "" : "s"} for ${parsed.projectKey}.`);
}

async function start(args: string[], deps: IngestCommandDeps) {
  if (args.length === 1 && (args[0] === "--help" || args[0] === "-h")) return ok(INGEST_HELP);
  const parsed = parseStartArgs(args);
  if (parsed.error) return ingestFailure(parsed.json, "myelin.ingest.start.v1", "ingest_start_invalid_arguments", parsed.error);

  try {
    const config = await loadConfig(deps.context.myelinRoot);
    const result = await new IngestService(deps.context.myelinRoot, {
      ...deps,
      smcPlanConfig: deps.smcPlanConfig ?? config.sessionMaintenance.planConfig ?? undefined,
    }).start({
      projectKey: parsed.projectKey,
      limit: parsed.limit,
      evidenceChunkSize: parsed.evidenceChunkSize,
      provider: parsed.provider,
    });
    return renderStart(result, parsed.json, parsed.compatibilityAlias);
  } catch (error) {
    return ingestFailure(parsed.json, "myelin.ingest.start.v1", "ingest_start_failed", errorMessage(error));
  }
}

async function status(args: string[], deps: IngestCommandDeps) {
  const parsed = parseStatusArgs(args);
  if (parsed.error) return ingestFailure(parsed.json, "myelin.ingest.status.v1", "ingest_status_invalid_arguments", parsed.error);

  try {
    const result = await new IngestService(deps.context.myelinRoot, deps).status({
      jobId: parsed.jobId,
      projectKey: parsed.projectKey,
    });
    if (result.kind === "project") {
      return parsed.json
        ? ok(JSON.stringify({ contract_version: "myelin.ingest.status.v1", kind: "project", status: result.status }, null, 2))
        : ok(`${result.status.project_key}: ${result.status.completion_label}`);
    }

    return parsed.json
      ? ok(JSON.stringify({
          contract_version: "myelin.ingest.status.v1",
          kind: "job",
          job: projectJob(result.job),
          anchor: result.anchor,
        }, null, 2))
      : ok(`Ingest job ${result.job.id} [${result.job.status}] project=${result.job.project_key} provider=${result.job.provider}`);
  } catch (error) {
    return ingestFailure(parsed.json, "myelin.ingest.status.v1", "ingest_status_failed", errorMessage(error));
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

function renderStart(result: StartIngestResult, json: boolean, compatibilityAlias: "batch_size" | null) {
  if (json) {
    const value = {
      contract_version: "myelin.ingest.start.v1",
      ok: result.kind !== "blocked",
      reason_code: result.kind === "blocked"
        ? result.code
        : result.kind === "no_work"
          ? "smc_no_work"
          : null,
      kind: result.kind,
      project_key: result.project_key,
      job_id: result.kind === "started" ? result.job.id : result.kind === "blocked" ? result.job_id : null,
      queued_count: result.queued_count,
      reconciled_count: result.reconciled_count,
      selected_count: result.kind === "started" || result.kind === "blocked" ? result.selected_count : 0,
      evidence_chunk_size: result.evidence_chunk_size ?? null,
      target_branch: result.target_branch,
      trigger: {
        reason: result.kind === "started"
          ? inputObject(result.job).trigger_reason ?? "manual"
          : result.workload.audit_count > 0 && result.workload.evidence_count === 0
            ? "manual_audit"
            : "manual",
        workload: result.workload,
      },
      compatibility: {
        deprecated_alias_used: compatibilityAlias,
        omitted_legacy_fields: ["batch_size", "batch_count", "jobs"],
      },
    };
    return (result.kind === "blocked" ? fail : ok)(JSON.stringify(value, null, 2));
  }

  const warning = result.target_branch && result.target_branch !== "master"
    ? `\nWarning: ingesting with target repo on ${result.target_branch}. Captured rows may include multiple branches; branch context is preserved per row.`
    : "";
  const reconciliation = result.reconciled_count > 0
    ? `\nReconciled ${result.reconciled_count} terminally tombstoned replay row${result.reconciled_count === 1 ? "" : "s"}.`
    : "";
  if (result.kind === "no_work") {
    return ok(`No Session Memory curation work is due for ${result.project_key}.${reconciliation}${warning}`);
  }
  if (result.kind === "blocked") {
    return fail(
      `Session Memory maintenance is blocked for ${result.project_key}: ${result.code}.` +
        `\nqueued content: ${result.queued_count}; selected rows: ${result.selected_count}.`,
    );
  }
  return ok(
    `Started Session Memory maintenance job ${result.job.id} for ${result.project_key}.` +
      `\nqueued content: ${result.queued_count}; selected rows: ${result.selected_count}; evidence chunk size: ${result.evidence_chunk_size}` +
      `${reconciliation}${warning}`,
  );
}

function parseStartArgs(args: string[]): {
  projectKey: string;
  limit?: number;
  evidenceChunkSize?: number;
  json: boolean;
  provider?: IngestProvider;
  compatibilityAlias: "batch_size" | null;
  error?: string;
} {
  let projectKey = "";
  let limit: number | undefined;
  let evidenceChunkSize: number | undefined;
  let json = args.includes("--json");
  let provider: IngestProvider | undefined;
  let compatibilityAlias: "batch_size" | null = null;

  if (hasMissingOptionValue(args, ["--limit", "--evidence-chunk-size", "--batch-size", "--provider"])) {
    return { projectKey, limit, evidenceChunkSize, json, provider, compatibilityAlias, error: "An ingest option is missing its value" };
  }

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === "--json") json = true;
    else if (arg === "--limit") {
      const value = Number(args[++index]);
      if (!Number.isInteger(value) || value <= 0) {
        return { projectKey, json, provider, compatibilityAlias, error: "--limit must be a positive integer" };
      }
      limit = value;
    } else if (arg === "--evidence-chunk-size" || arg === "--batch-size") {
      if (arg === "--batch-size") compatibilityAlias = "batch_size";
      const value = Number(args[++index]);
      if (!Number.isInteger(value) || value <= 0 || value > 500) {
        return {
          projectKey,
          limit,
          evidenceChunkSize,
          json,
          provider,
          compatibilityAlias,
          error: `${arg} must be an integer between 1 and 500`,
        };
      }
      evidenceChunkSize = value;
    } else if (arg === "--provider") {
      const value = args[++index];
      if (value !== "codex" && value !== "claude") {
        return { projectKey, limit, evidenceChunkSize, json, provider, compatibilityAlias, error: "--provider must be codex or claude" };
      }
      provider = value;
    } else if (arg.startsWith("-")) {
      return { projectKey, limit, evidenceChunkSize, json, provider, compatibilityAlias, error: `Unknown ingest option: ${arg}` };
    } else if (!projectKey) {
      projectKey = arg;
    } else {
      return { projectKey, limit, evidenceChunkSize, json, provider, compatibilityAlias, error: `Unexpected ingest argument: ${arg}` };
    }
  }

  if (!projectKey) {
    return {
      projectKey,
      limit,
      evidenceChunkSize,
      json,
      provider,
      compatibilityAlias,
      error: "Usage: myelin ingest <project-key> [--limit N] [--evidence-chunk-size N] [--provider codex|claude] [--json]",
    };
  }
  return { projectKey, limit, evidenceChunkSize, json, provider, compatibilityAlias };
}

function inputObject(job: IngestJobRow): Record<string, unknown> {
  try {
    const parsed = JSON.parse(job.input_json) as unknown;
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed as Record<string, unknown> : {};
  } catch {
    return {};
  }
}

function projectJob(job: IngestJobRow) {
  return {
    id: job.id,
    project_key: job.project_key,
    provider: job.provider,
    provider_session_id: job.provider_session_id,
    status: job.status,
    error_code: ingestJobErrorCode(job),
    created_at: job.created_at,
    updated_at: job.updated_at,
    started_at: job.started_at,
    finished_at: job.finished_at,
    terminal_summary: job.terminal_summary,
  };
}

function projectAdminJob(job: ReturnType<IngestJobAdminService["list"]>["jobs"][number]) {
  return {
    ...projectJob(job),
    anchor: job.anchor,
    permanently_denied_legacy_identity: job.permanently_denied_legacy_identity,
  };
}

const INGEST_HELP = `Usage: myelin ingest <project-key> [options]\n\nOptions:\n  --limit N\n  --evidence-chunk-size N\n  --batch-size N  Deprecated compatibility alias for --evidence-chunk-size\n  --provider codex|claude\n  --json\n\nRecovery:\n  myelin ingest resume <project-key> <job-id> --owner-epoch N [--attempt-id ID] [--provider codex|claude] [--json]\n  myelin ingest abandon <project-key> <job-id> --owner-epoch N --receipt-id ID --request-id ID --operator-id ID --reason TEXT [--json]\n  myelin ingest grant <project-key> <job-id> --owner-epoch N --manifest-digest sha256:... --grant-id ID --budget max_turns|max_queries|max_cumulative_returned_result_bytes|max_provider_envelope_bytes|max_affected_work_set_size --amount N --operator-id ID --reason TEXT [--json]`;

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
  let json = args.includes("--json");

  if (hasMissingOptionValue(args, ["--status", "--limit"])) {
    return { projectKey, status, limit, json, error: "An ingest jobs option is missing its value" };
  }

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
  let json = args.includes("--json");
  let all = false;

  if (hasMissingOptionValue(args, ["--id", "--code", "--reason"])) {
    return { projectKey, ids, errorCode, reason, dryRun, json, error: "An ingest jobs resolve option is missing its value" };
  }

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
  let json = args.includes("--json");

  if (hasMissingOptionValue(args, ["--project"])) {
    return { jobId, projectKey, json, error: "--project requires a value" };
  }

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

function hasMissingOptionValue(args: readonly string[], options: readonly string[]): boolean {
  const valued = new Set(options);
  return args.some((arg, index) => valued.has(arg) && (!args[index + 1] || args[index + 1]!.startsWith("--")));
}

function formatIngestJob(job: IngestJobRow): string {
  const code = ingestJobErrorCode(job);
  const error = code ? ` error=${code}` : "";
  return `${job.id} [${job.status}] provider=${job.provider} created=${job.created_at}${error}`;
}

function ingestFailure(
  json: boolean,
  contractVersion: IngestMachineContractVersion,
  reasonCode: IngestFailureReasonCode,
  detail: string,
) {
  return fail(json
    ? JSON.stringify({
        contract_version: contractVersion,
        ok: false,
        kind: "blocked",
        reason_code: reasonCode,
        detail,
      }, null, 2)
    : detail);
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
