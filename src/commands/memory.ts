import type { Cli, CommandResult } from "./registry.ts";
import { fail, ok } from "./registry.ts";
import { createRuntimeInboxItem, runtimeInboxRatings, type RuntimeInboxRating } from "../inbox/runtime-inbox-items.ts";
import { openMemoryDb } from "../memory/db.ts";
import { EmbeddingProviderFactory } from "../memory/embedding-provider-factory.ts";
import {
  SESSION_MEMORY_STATUSES,
  type MemoryCandidateStatus,
  type MemoryScope,
  type SessionMemoryStatus,
} from "../memory/ingest-types.ts";
import { MemoryCandidateService } from "../memory/memory-candidate-service.ts";
import { MemoryReviewService, type MemoryReviewItem } from "../memory/memory-review-service.ts";
import { ProjectMemoryRetrievalIndexService } from "../memory/project-memory-retrieval-index-service.ts";
import { SessionMemoryInspectionService, type SessionMemoryInspectRow } from "../memory/session-memory-inspection-service.ts";
import type { SessionMemoryLinkRow } from "../memory/session-memory-links.ts";
import { SessionMemoryIndexService } from "../memory/session-memory-index-service.ts";
import {
  ProjectMemoryCandidateIntakeService,
  type ProjectInboxIntakeSummary,
} from "../project/project-memory-candidate-intake-service.ts";
import { ProjectService } from "../project/project-service.ts";
import type { LaunchContext } from "../runtime/launch-context.ts";
import { stableJson } from "../runtime/json.ts";
import { DEFAULT_EMBEDDING_BATCH_SIZE, loadConfig, MAX_EMBEDDING_BATCH_SIZE } from "../runtime/config.ts";
import type { ProcessRunner } from "../runtime/llm-client.ts";
import { queryMemory } from "../query/engine.ts";
import {
  loadProjectMemoryGoldenQuestions,
  runProjectMemoryQuestionEval,
} from "../query/project-memory-question-eval.ts";

export type MemoryCommandDeps = {
  context: LaunchContext;
  now?: () => Date;
  creator?: string;
  runner?: ProcessRunner;
  env?: NodeJS.ProcessEnv;
};

export function registerMemoryCommands(cli: Cli, deps: MemoryCommandDeps): void {
  const root = deps.context.myelinRoot;
  cli.command(["memory", "inbox", "create"], (args) => memoryInboxCreate(args, deps));
  cli.command(["memory", "inbox", "intake"], (args) => memoryInboxIntake(args, deps));
  cli.command(["memory", "candidates"], (args) => candidates(args, root));
  cli.command(["memory", "candidate", "show"], (args) => candidateShow(args, root));
  cli.command(["memory", "session", "list"], (args) => sessionList(args, root));
  cli.command(["memory", "session", "show"], (args) => sessionShow(args, root));
  cli.command(["memory", "session", "links"], (args) => sessionLinks(args, root));
  cli.command(["memory", "review"], (args) => memoryReview(args, root));
  cli.command(["memory", "index", "session"], (args) => indexSession(args, root));
  cli.command(["memory", "index", "project"], (args) => indexProject(args, root));
  cli.command(["memory", "maintain", "project"], (args) => maintainProject(args, deps));
  cli.command(["memory", "eval", "project"], (args) => evalProjectMemory(args, root));
  cli.command(["memory", "query"], async (args) => {
    const parsed = parseArgs(args);
    if (parsed.error) return fail(parsed.error);

    const response = await queryMemory({
      root,
      projectKey: parsed.projectKey,
      question: parsed.question,
      limit: parsed.limit,
      includeRoute: parsed.debug,
      branch: parsed.branch,
      layer: parsed.layer,
      maxInlineChars: parsed.maxInlineChars,
    });
    if (parsed.json) return ok(JSON.stringify(response, null, 2));
    if (response.degraded) return fail(response.answer);
    return ok(response.answer);
  });
}

async function evalProjectMemory(args: string[], root: string): Promise<CommandResult> {
  const parsed = parseEvalProjectMemoryArgs(args);
  if (parsed.error) return fail(parsed.error);

  try {
    const questions = await loadProjectMemoryGoldenQuestions({
      project_key: parsed.projectKey,
      fixture_path: parsed.fixturePath,
    });
    const result = await runProjectMemoryQuestionEval({
      root,
      project_key: parsed.projectKey,
      questions,
      limit: parsed.limit,
      max_inline_chars: parsed.maxInlineChars,
    });
    if (parsed.json) return result.failed === 0 ? ok(stableJson(result)) : fail(stableJson(result));
    const message =
      `Project Memory question eval for ${parsed.projectKey}: ` +
      `${result.passed}/${result.total} passed, ${result.failed} failed, ` +
      `${result.primary_rank_1}/${result.total} primary rank-1, ${result.acceptable_top_5}/${result.total} acceptable top-5.`;
    return result.failed === 0 ? ok(message) : fail(message);
  } catch (error) {
    return fail(error instanceof Error ? error.message : String(error));
  }
}

type ParsedMemoryInboxCreateArgs = {
  projectKey: string;
  layer: string;
  title: string;
  body: string;
  rationale: string;
  evidenceRefs: string[];
  targetHint: string | null;
  confidence?: RuntimeInboxRating;
  risk?: RuntimeInboxRating;
  json: boolean;
  error?: string;
};

type ParsedMemoryInboxIntakeArgs = {
  projectKey: string;
  json: boolean;
  error?: string;
};

type ParsedMaintainProjectArgs = {
  projectKey: string;
  dryRun: boolean;
  review: boolean;
  json: boolean;
  provider?: "codex" | "claude";
  modelOverride?: string;
  error?: string;
};

type ParsedMemoryReviewArgs = {
  projectKey: string;
  limit: number;
  status?: string;
  json: boolean;
  error?: string;
};

async function memoryReview(args: string[], root: string): Promise<CommandResult> {
  const parsed = parseMemoryReviewArgs(args);
  if (parsed.error) return fail(parsed.error);

  try {
    const result = await new MemoryReviewService(root).reviewProject({
      projectKey: parsed.projectKey,
      limit: parsed.limit,
      status: parsed.status,
    });
    if (parsed.json) return ok(stableJson(result));
    if (result.items.length === 0) return ok(`No reviewable memory outcomes for ${result.project_key}.`);
    return ok([
      `Reviewable memory outcomes for ${result.project_key}: ${result.reviewable_count} (${result.returned_count} shown)`,
      ...result.items.map(formatMemoryReviewItem),
    ].join("\n"));
  } catch (error) {
    return fail(error instanceof Error ? error.message : String(error));
  }
}

function parseMemoryReviewArgs(args: string[]): ParsedMemoryReviewArgs {
  let projectKey = "";
  let limit = 100;
  let status: string | undefined;
  let json = false;

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === "--json") json = true;
    else if (arg === "--status") {
      status = args[++index];
      if (!status) return { projectKey, limit, status, json, error: "--status requires a value" };
    }
    else if (arg === "--limit") {
      const parsed = Number(args[++index]);
      if (!Number.isInteger(parsed) || parsed <= 0) {
        return { projectKey, limit, status, json, error: "--limit must be a positive integer" };
      }
      limit = parsed;
    } else if (arg.startsWith("-")) {
      return { projectKey, limit, status, json, error: `Unknown memory review option: ${arg}` };
    } else if (!projectKey) {
      projectKey = arg;
    } else {
      return { projectKey, limit, status, json, error: `Unexpected memory review argument: ${arg}` };
    }
  }

  if (!projectKey) return { projectKey, limit, status, json, error: "Usage: myelin memory review <project-key> [--status <status>] [--limit N] [--json]" };
  return { projectKey, limit, status, json };
}

function formatMemoryReviewItem(item: MemoryReviewItem): string {
  if (item.kind === "project_memory_disposition") {
    return `- project_memory ${item.status} ${item.source_kind}:${item.source_ref} (${item.json_path}) - ${item.reason}`;
  }
  if (item.kind === "project_memory_run") {
    return `- project_memory_run ${item.status} ${item.run_dir} (${item.json_path}) - ${item.reason}`;
  }
  if (item.kind === "ingest_job") {
    return `- ingest_job ${item.status} ${item.id} (${item.sqlite_table})${item.reason ? ` - ${item.reason}` : ""}`;
  }
  if (item.kind === "experience_tombstone") {
    return `- tombstone ${item.status} ${item.id} (${item.sqlite_table}) original=${item.original_event_id}`;
  }
  if (item.kind === "memory_candidate") {
    return `- candidate ${item.status} ${item.scope}:${item.id} (${item.sqlite_table}) - ${item.reason}`;
  }
  return `- handoff ${item.status} ${item.scope}:${item.id} (${item.sqlite_table}) - ${item.reason}`;
}

async function maintainProject(args: string[], deps: MemoryCommandDeps): Promise<CommandResult> {
  const parsed = parseMaintainProjectArgs(args);
  if (parsed.error) return fail(parsed.error);

  try {
    const result = await new ProjectService(deps.context.myelinRoot).runProjectMaintenance({
      projectKey: parsed.projectKey,
      dryRun: parsed.dryRun,
      review: parsed.review,
      provider: parsed.provider,
      modelOverride: parsed.modelOverride,
      env: deps.env,
      runner: deps.runner,
      now: deps.now?.(),
    });
    if (parsed.json) return result.status === "failed" ? fail(stableJson(result)) : ok(stableJson(result));

    const lines = [
      `Project Memory maintenance ${result.status} for ${result.project_key}.`,
      `mode: ${result.mode}`,
      `run: ${result.run_dir}`,
      `validation: ${result.validation_ok ? "passed" : "failed"}`,
      `stopped_before_writes: ${result.stopped_before_writes}`,
    ];
    if (result.applied_page_ids?.length) lines.push(`applied pages: ${result.applied_page_ids.join(", ")}`);
    if (result.applied_item_ids?.length) lines.push(`applied items: ${result.applied_item_ids.join(", ")}`);
    if (result.changed_files?.length) lines.push(`changed files: ${result.changed_files.join(", ")}`);
    if (result.status === "completed_with_pending_index") lines.push("pending retrieval index: yes");
    if (result.stopped_reason) lines.push(`stopped: ${result.stopped_reason}`);
    return result.status === "failed" ? fail(lines.join("\n")) : ok(lines.join("\n"));
  } catch (error) {
    return fail(error instanceof Error ? error.message : String(error));
  }
}

function parseMaintainProjectArgs(args: string[]): ParsedMaintainProjectArgs {
  let projectKey = "";
  let dryRun = false;
  let review = false;
  let json = false;
  let provider: "codex" | "claude" | undefined;
  let modelOverride: string | undefined;

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === "--dry-run") dryRun = true;
    else if (arg === "--review") review = true;
    else if (arg === "--json") json = true;
    else if (arg === "--provider") {
      const value = args[++index];
      if (value !== "codex" && value !== "claude") return { projectKey, dryRun, review, json, error: "--provider must be codex or claude" };
      provider = value;
    } else if (arg === "--model") {
      modelOverride = args[++index];
      if (!modelOverride) return { projectKey, dryRun, review, json, error: "--model requires a value" };
    } else if (arg.startsWith("-")) {
      return { projectKey, dryRun, review, json, error: `Unknown memory maintain project option: ${arg}` };
    } else if (!projectKey) {
      projectKey = arg;
    } else {
      return { projectKey, dryRun, review, json, error: `Unexpected memory maintain project argument: ${arg}` };
    }
  }

  if (!projectKey) {
    return {
      projectKey,
      dryRun,
      review,
      json,
      error: "Usage: myelin memory maintain project <project-key> [--dry-run] [--review] [--provider <name>] [--model <model>] [--json]",
    };
  }
  return { projectKey, dryRun, review, json, provider, modelOverride };
}

async function memoryInboxCreate(args: string[], deps: MemoryCommandDeps): Promise<CommandResult> {
  const parsed = parseMemoryInboxCreateArgs(args);
  if (parsed.error) return fail(parsed.error);
  if (!parsed.confidence) return fail("--confidence must be one of: low, medium, high");
  if (!parsed.risk) return fail("--risk must be one of: low, medium, high");

  const result = await createRuntimeInboxItem(deps.context.myelinRoot, {
    projectKey: parsed.projectKey,
    targetLayer: parsed.layer,
    title: parsed.title,
    body: parsed.body,
    rationale: parsed.rationale,
    evidenceRefs: parsed.evidenceRefs,
    targetHint: parsed.targetHint,
    confidence: parsed.confidence,
    risk: parsed.risk,
    creator: deps.creator ?? "operator",
    now: deps.now?.(),
  });

  if (parsed.json) return result.status === "created" ? ok(stableJson(result)) : fail(stableJson(result));
  if (result.status !== "created") {
    return fail(result.reason);
  }
  return ok(
    [
      `Runtime inbox item created for ${result.item.project_key}.`,
      `id: ${result.item.id}`,
      `source ref: ${result.source_ref}`,
      `path: ${result.path}`,
      `confidence: ${result.item.confidence}`,
      `risk: ${result.item.risk}`,
    ].join("\n"),
  );
}

function parseMemoryInboxCreateArgs(args: string[]): ParsedMemoryInboxCreateArgs {
  let projectKey = "";
  let layer = "";
  let title = "";
  let body = "";
  let rationale = "";
  const evidenceRefs: string[] = [];
  let targetHint: string | null = null;
  let confidence: RuntimeInboxRating | undefined;
  let risk: RuntimeInboxRating | undefined;
  let json = false;

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === "--json") json = true;
    else if (arg === "--layer") layer = args[++index] ?? "";
    else if (arg === "--title") title = args[++index] ?? "";
    else if (arg === "--body") body = args[++index] ?? "";
    else if (arg === "--rationale") rationale = args[++index] ?? "";
    else if (arg === "--evidence-ref") evidenceRefs.push(args[++index] ?? "");
    else if (arg === "--target-hint") targetHint = args[++index] ?? "";
    else if (arg === "--confidence") {
      const value = args[++index];
      if (!isRuntimeInboxRating(value)) {
        return createArgsError(
          projectKey,
          layer,
          title,
          body,
          rationale,
          evidenceRefs,
          targetHint,
          confidence,
          risk,
          json,
          "--confidence must be one of: low, medium, high",
        );
      }
      confidence = value;
    } else if (arg === "--risk") {
      const value = args[++index];
      if (!isRuntimeInboxRating(value)) {
        return createArgsError(
          projectKey,
          layer,
          title,
          body,
          rationale,
          evidenceRefs,
          targetHint,
          confidence,
          risk,
          json,
          "--risk must be one of: low, medium, high",
        );
      }
      risk = value;
    } else if (arg.startsWith("-")) {
      return createArgsError(
        projectKey,
        layer,
        title,
        body,
        rationale,
        evidenceRefs,
        targetHint,
        confidence,
        risk,
        json,
        `Unknown memory inbox create option: ${arg}`,
      );
    } else if (!projectKey) {
      projectKey = arg;
    } else {
      return createArgsError(
        projectKey,
        layer,
        title,
        body,
        rationale,
        evidenceRefs,
        targetHint,
        confidence,
        risk,
        json,
        `Unexpected memory inbox create argument: ${arg}`,
      );
    }
  }

  if (!confidence) {
    return createArgsError(
      projectKey,
      layer,
      title,
      body,
      rationale,
      evidenceRefs,
      targetHint,
      confidence,
      risk,
      json,
      "--confidence must be one of: low, medium, high",
    );
  }
  if (!risk) {
    return createArgsError(
      projectKey,
      layer,
      title,
      body,
      rationale,
      evidenceRefs,
      targetHint,
      confidence,
      risk,
      json,
      "--risk must be one of: low, medium, high",
    );
  }
  if (!projectKey || !layer || !title || !body || !rationale) {
    return createArgsError(
      projectKey,
      layer,
      title,
      body,
      rationale,
      evidenceRefs,
      targetHint,
      confidence,
      risk,
      json,
      "Usage: myelin memory inbox create <project-key> --layer project --title <title> --body <text> --rationale <text> --confidence low|medium|high --risk low|medium|high [--evidence-ref <ref>] [--target-hint <hint>] [--json]",
    );
  }
  if (evidenceRefs.some((ref) => ref.trim().length === 0)) {
    return createArgsError(
      projectKey,
      layer,
      title,
      body,
      rationale,
      evidenceRefs,
      targetHint,
      confidence,
      risk,
      json,
      "--evidence-ref requires a non-empty value",
    );
  }
  return { projectKey, layer, title, body, rationale, evidenceRefs, targetHint, confidence, risk, json };
}

function createArgsError(
  projectKey: string,
  layer: string,
  title: string,
  body: string,
  rationale: string,
  evidenceRefs: string[],
  targetHint: string | null,
  confidence: RuntimeInboxRating | undefined,
  risk: RuntimeInboxRating | undefined,
  json: boolean,
  error: string,
): ParsedMemoryInboxCreateArgs {
  return {
    projectKey,
    layer,
    title,
    body,
    rationale,
    evidenceRefs,
    targetHint,
    confidence,
    risk,
    json,
    error,
  };
}

function isRuntimeInboxRating(value: string | undefined): value is RuntimeInboxRating {
  return (runtimeInboxRatings as readonly string[]).includes(value ?? "");
}

async function memoryInboxIntake(args: string[], deps: MemoryCommandDeps): Promise<CommandResult> {
  const parsed = parseMemoryInboxIntakeArgs(args);
  if (parsed.error) return fail(parsed.error);

  const result = await new ProjectMemoryCandidateIntakeService(deps.context.myelinRoot).intakeProjectInbox(
    parsed.projectKey,
    deps.now?.() ?? new Date(),
  );
  if (parsed.json) return result.blocking ? fail(stableJson(result)) : ok(stableJson(result));
  const message = formatMemoryInboxIntakeSummary(result);
  return result.blocking ? fail(message) : ok(message);
}

function parseMemoryInboxIntakeArgs(args: string[]): ParsedMemoryInboxIntakeArgs {
  let projectKey = "";
  let json = false;

  for (const arg of args) {
    if (arg === "--json") json = true;
    else if (arg.startsWith("-")) return { projectKey, json, error: `Unknown memory inbox intake option: ${arg}` };
    else if (!projectKey) projectKey = arg;
    else return { projectKey, json, error: `Unexpected memory inbox intake argument: ${arg}` };
  }

  if (!projectKey) return { projectKey, json, error: "Usage: myelin memory inbox intake <project-key> [--json]" };
  return { projectKey, json };
}

function formatMemoryInboxIntakeSummary(result: ProjectInboxIntakeSummary): string {
  return [
    `Runtime inbox intake for ${result.project_key}.`,
    `created: ${result.created_candidate_ids.length}`,
    `existing: ${result.existing_candidate_ids.length}`,
    `terminal duplicates: ${result.terminal_duplicate_candidate_ids.length}`,
    `skipped: ${result.skipped_source_refs.length}`,
    `unsupported: ${result.unsupported_source_refs.length}`,
    `invalid: ${result.invalid_source_refs.length}`,
    `degraded: ${result.degraded ? "yes" : "no"}`,
    result.degraded_reasons.length > 0 ? `degraded reasons: ${result.degraded_reasons.join("; ")}` : "",
  ]
    .filter(Boolean)
    .join("\n");
}

function sessionList(args: string[], root: string): CommandResult {
  const parsed = parseSessionListArgs(args);
  if (parsed.error) return fail(parsed.error);

  const result = sessionInspectionService(root).list({
    projectKey: parsed.projectKey,
    status: parsed.status,
    limit: parsed.limit,
  });
  if (parsed.json) return ok(JSON.stringify(result, null, 2));
  if (result.memories.length === 0) return ok(`No session memories for ${parsed.projectKey}.`);
  return ok(result.memories.map(formatSessionMemorySummary).join("\n"));
}

function sessionShow(args: string[], root: string): CommandResult {
  const parsed = parseSessionShowArgs(args);
  if (parsed.error) return fail(parsed.error);

  try {
    const result = sessionInspectionService(root).show(parsed.id);
    if (parsed.json) return ok(JSON.stringify(result, null, 2));
    return ok(formatSessionMemoryDetail(result.memory));
  } catch (error) {
    return fail(error instanceof Error ? error.message : String(error));
  }
}

function sessionLinks(args: string[], root: string): CommandResult {
  const parsed = parseSessionLinksArgs(args);
  if (parsed.error) return fail(parsed.error);

  const result = sessionInspectionService(root).links({
    projectKey: parsed.projectKey,
    memoryId: parsed.memoryId,
    limit: parsed.limit,
  });
  if (parsed.json) return ok(JSON.stringify(result, null, 2));
  if (result.links.length === 0) return ok(`No session memory links for ${parsed.projectKey}.`);
  return ok(result.links.map(formatSessionMemoryLink).join("\n"));
}

function parseSessionListArgs(args: string[]): {
  projectKey: string;
  status?: SessionMemoryStatus;
  limit: number;
  json: boolean;
  error?: string;
} {
  let projectKey = "";
  let status: SessionMemoryStatus | undefined;
  let limit = 50;
  let json = false;

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === "--json") json = true;
    else if (arg === "--status") {
      const value = args[++index];
      const parsed = parseSessionMemoryStatus(value);
      if (!parsed) return { projectKey, status, limit, json, error: "--status must be one of: active, superseded, retracted" };
      status = parsed;
    } else if (arg === "--limit") {
      const value = args[++index];
      const parsed = parsePositiveInteger(value);
      if (!parsed) return { projectKey, status, limit, json, error: "--limit must be a positive integer" };
      limit = parsed;
    } else if (arg.startsWith("-")) {
      return { projectKey, status, limit, json, error: `Unknown memory session list option: ${arg}` };
    } else if (!projectKey) {
      projectKey = arg;
    } else {
      return { projectKey, status, limit, json, error: `Unexpected memory session list argument: ${arg}` };
    }
  }

  if (!projectKey) {
    return {
      projectKey,
      status,
      limit,
      json,
      error: "Usage: myelin memory session list <project-key> [--status active|superseded|retracted] [--limit N] [--json]",
    };
  }
  return { projectKey, status, limit, json };
}

function parseSessionShowArgs(args: string[]): { id: string; json: boolean; error?: string } {
  let id = "";
  let json = false;

  for (const arg of args) {
    if (arg === "--json") json = true;
    else if (arg.startsWith("-")) return { id, json, error: `Unknown memory session show option: ${arg}` };
    else if (!id) id = arg;
    else return { id, json, error: `Unexpected memory session show argument: ${arg}` };
  }

  if (!id) return { id, json, error: "Usage: myelin memory session show <memory-id> [--json]" };
  return { id, json };
}

function parseSessionLinksArgs(args: string[]): {
  projectKey: string;
  memoryId?: string;
  limit: number;
  json: boolean;
  error?: string;
} {
  let projectKey = "";
  let memoryId: string | undefined;
  let limit = 100;
  let json = false;

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === "--json") json = true;
    else if (arg === "--memory") {
      const value = args[++index];
      if (!value) return { projectKey, memoryId, limit, json, error: "--memory requires a value" };
      memoryId = value;
    } else if (arg === "--limit") {
      const value = args[++index];
      const parsed = parsePositiveInteger(value);
      if (!parsed) return { projectKey, memoryId, limit, json, error: "--limit must be a positive integer" };
      limit = parsed;
    } else if (arg.startsWith("-")) {
      return { projectKey, memoryId, limit, json, error: `Unknown memory session links option: ${arg}` };
    } else if (!projectKey) {
      projectKey = arg;
    } else {
      return { projectKey, memoryId, limit, json, error: `Unexpected memory session links argument: ${arg}` };
    }
  }

  if (!projectKey) {
    return {
      projectKey,
      memoryId,
      limit,
      json,
      error: "Usage: myelin memory session links <project-key> [--memory <memory-id>] [--limit N] [--json]",
    };
  }
  return { projectKey, memoryId, limit, json };
}

function parseSessionMemoryStatus(value: string | undefined): SessionMemoryStatus | null {
  if (!value) return null;
  return (SESSION_MEMORY_STATUSES as readonly string[]).includes(value) ? (value as SessionMemoryStatus) : null;
}

function parsePositiveInteger(value: string | undefined): number | null {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
}

function formatSessionMemorySummary(memory: SessionMemoryInspectRow): string {
  const title = memory.title ? `${memory.title}: ` : "";
  const lifecycle =
    memory.status === "active"
      ? ""
      : ` -> ${memory.status}${memory.superseded_by ? ` by ${memory.superseded_by}` : ""}`;
  return `${memory.id} [${memory.status}] ${memory.memory_kind}${lifecycle}: ${title}${memory.summary}`;
}

function formatSessionMemoryDetail(memory: SessionMemoryInspectRow): string {
  const lines = [
    `${memory.id} [${memory.status}] ${memory.memory_kind}`,
    memory.title ? `title: ${memory.title}` : null,
    `summary: ${memory.summary}`,
    memory.superseded_by ? `superseded by: ${memory.superseded_by}` : null,
    memory.lifecycle_reason ? `lifecycle reason: ${memory.lifecycle_reason}` : null,
    `source refs: ${JSON.parse(memory.source_event_refs_json).join(", ")}`,
  ].filter((line): line is string => Boolean(line));
  if (memory.contexts.length > 0) {
    lines.push(
      `contexts: ${memory.contexts
        .map((context) => [context.git_branch, context.repo_path].filter(Boolean).join(" @ "))
        .join("; ")}`,
    );
  }
  return lines.join("\n");
}

function formatSessionMemoryLink(link: SessionMemoryLinkRow): string {
  return `${link.source_memory_id} ${link.relationship} ${link.target_memory_id}: ${link.reason}`;
}

async function indexSession(args: string[], root: string): Promise<CommandResult> {
  const parsed = parseIndexSessionArgs(args);
  if (parsed.error) return fail(parsed.error);

  const config = await loadConfig(root);
  const selection = await new EmbeddingProviderFactory(config).initialize("retrieval_document");
  const db = openMemoryDb(root);
  try {
    const service = new SessionMemoryIndexService({
      db,
      contract: selection.contract,
      provider: selection.client,
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

async function indexProject(args: string[], root: string): Promise<CommandResult> {
  const parsed = parseIndexProjectArgs(args);
  if (parsed.error) return fail(parsed.error);

  const config = await loadConfig(root);
  const response = await new ProjectMemoryRetrievalIndexService({ root }).indexProject({
    projectKey: parsed.projectKey,
    limit: parsed.limit,
    batchSize: parsed.batchSize ?? config.embedding.batchSize,
    retryFailed: parsed.retryFailed,
  });
  if (parsed.json) return ok(stableJson(response));
  const message =
    `Project Memory retrieval index for ${parsed.projectKey}: ` +
    `selected ${response.selected}, indexed ${response.indexed}, failed ${response.failed}, pending ${response.pending_remaining}.`;
  return response.degraded ? fail(`${message}\n${response.degraded_reason ?? "Indexing degraded."}`) : ok(message);
}

function candidates(args: string[], root: string): CommandResult {
  const parsed = parseCandidateListArgs(args, root);
  if (parsed.error) return fail(parsed.error);

  const result = candidateService(root).list({
    projectKey: parsed.projectKey,
    status: parsed.status,
    scope: parsed.scope,
  });
  if (parsed.json) return ok(JSON.stringify(result, null, 2));
  if (result.candidates.length === 0) return ok(`No memory candidates for ${parsed.projectKey}.`);
  return ok(result.candidates.map((row) => `${row.id} [${row.status}] ${row.scope}: ${row.summary}`).join("\n"));
}

function candidateShow(args: string[], root: string): CommandResult {
  const parsed = parseCandidateShowArgs(args);
  if (parsed.error) return fail(parsed.error);

  try {
    const result = candidateService(root).show(parsed.id);
    const row = result.candidate;
    return parsed.json ? ok(JSON.stringify(result, null, 2)) : ok(`${row.id} [${row.status}] ${row.scope}\n${row.summary}`);
  } catch (error) {
    return fail(error instanceof Error ? error.message : String(error));
  }
}

function parseCandidateListArgs(args: string[], root: string): {
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
        status = candidateService(root).normalizeStatus(args[++index] ?? "");
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

function parseIndexProjectArgs(args: string[]): {
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
      return { projectKey, limit, batchSize, retryFailed, json, error: `Unknown memory index project option: ${arg}` };
    } else if (!projectKey) {
      projectKey = arg;
    } else {
      return { projectKey, limit, batchSize, retryFailed, json, error: `Unexpected memory index project argument: ${arg}` };
    }
  }

  if (!projectKey) {
    return {
      projectKey,
      limit,
      batchSize,
      retryFailed,
      json,
      error: "Usage: myelin memory index project <project-key> [--limit N] [--batch-size N] [--retry-failed] [--json]",
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
  layer?: "session" | "project";
  maxInlineChars: number;
  error?: string;
} {
  let projectKey = "";
  let question = "";
  let limit = 5;
  let json = false;
  let debug = false;
  let branch: string | undefined;
  let layer: "session" | "project" | undefined;
  let maxInlineChars = 4000;

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === "--json") {
      json = true;
    } else if (arg === "--debug") {
      debug = true;
    } else if (arg === "--branch") {
      const value = args[++index];
      if (!value) return { projectKey, question, limit, json, debug, branch, layer, maxInlineChars, error: "--branch requires a value" };
      branch = value;
    } else if (arg === "--layer") {
      const value = args[++index];
      if (value !== "session" && value !== "project") {
        return { projectKey, question, limit, json, debug, branch, layer, maxInlineChars, error: "--layer must be one of: session, project" };
      }
      layer = value;
    } else if (arg === "--max-inline-chars") {
      const value = args[++index];
      const parsed = Number(value);
      if (!Number.isInteger(parsed) || parsed < 0) {
        return { projectKey, question, limit, json, debug, branch, layer, maxInlineChars, error: "--max-inline-chars must be a non-negative integer" };
      }
      maxInlineChars = parsed;
    } else if (arg === "--limit") {
      const value = args[++index];
      const parsed = Number(value);
      if (!Number.isInteger(parsed) || parsed <= 0) {
        return { projectKey, question, limit, json, debug, branch, layer, maxInlineChars, error: "--limit must be a positive integer" };
      }
      limit = parsed;
    } else if (arg.startsWith("-")) {
      return { projectKey, question, limit, json, debug, branch, layer, maxInlineChars, error: `Unknown memory query option: ${arg}` };
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
      layer,
      maxInlineChars,
      error: "Usage: myelin memory query <key> <question> [--limit N] [--layer session|project] [--max-inline-chars N] [--branch current|<name>] [--json] [--debug]",
    };
  }
  return { projectKey, question, limit, json, debug, branch, layer, maxInlineChars };
}

function parseEvalProjectMemoryArgs(args: string[]): {
  projectKey: string;
  fixturePath?: string;
  limit: number;
  maxInlineChars: number;
  json: boolean;
  error?: string;
} {
  let projectKey = "";
  let fixturePath: string | undefined;
  let limit = 5;
  let maxInlineChars = 4000;
  let json = false;

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === "--json") {
      json = true;
    } else if (arg === "--fixture") {
      const value = args[++index];
      if (!value) return { projectKey, fixturePath, limit, maxInlineChars, json, error: "--fixture requires a value" };
      fixturePath = value;
    } else if (arg === "--limit") {
      const value = args[++index];
      const parsed = Number(value);
      if (!Number.isInteger(parsed) || parsed <= 0) {
        return { projectKey, fixturePath, limit, maxInlineChars, json, error: "--limit must be a positive integer" };
      }
      limit = parsed;
    } else if (arg === "--max-inline-chars") {
      const value = args[++index];
      const parsed = Number(value);
      if (!Number.isInteger(parsed) || parsed < 0) {
        return { projectKey, fixturePath, limit, maxInlineChars, json, error: "--max-inline-chars must be a non-negative integer" };
      }
      maxInlineChars = parsed;
    } else if (arg.startsWith("-")) {
      return { projectKey, fixturePath, limit, maxInlineChars, json, error: `Unknown memory eval project option: ${arg}` };
    } else if (!projectKey) {
      projectKey = arg;
    } else {
      return { projectKey, fixturePath, limit, maxInlineChars, json, error: `Unexpected memory eval project argument: ${arg}` };
    }
  }

  if (!projectKey) {
    return {
      projectKey,
      fixturePath,
      limit,
      maxInlineChars,
      json,
      error: "Usage: myelin memory eval project <project-key> [--fixture path] [--limit N] [--max-inline-chars N] [--json]",
    };
  }
  return { projectKey, fixturePath, limit, maxInlineChars, json };
}

function candidateService(root: string): MemoryCandidateService {
  return new MemoryCandidateService(root);
}

function sessionInspectionService(root: string): SessionMemoryInspectionService {
  return new SessionMemoryInspectionService(root);
}
