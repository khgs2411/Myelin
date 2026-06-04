import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { readFile, readdir } from "node:fs/promises";
import { basename, join, relative } from "node:path";
import { createRunDir } from "../runtime/artifacts.ts";
import { resolveInside } from "../runtime/fs.ts";
import { readJsonIfExists, stableJson, writeJson } from "../runtime/json.ts";
import { type JsonObject, type ProcessRunner, invokeLlm } from "../runtime/llm-client.ts";
import { findProject } from "../runtime/projects.ts";
import { readProjectStateIfExists, statePath, writeProjectState } from "../runtime/state.ts";
import { buildSchemaContext, checkSchema, validateSchemaContext } from "../schema/compiler.ts";

export type PipelineKind = "learn" | "ingest";

export type PipelineOptions = {
  dryRun?: boolean;
  review?: boolean;
  provider?: "codex" | "claude";
  modelOverride?: string;
  env?: NodeJS.ProcessEnv;
  runner?: ProcessRunner;
  now?: Date;
};

export type PipelineRunResult = {
  status: "completed" | "needs_review" | "failed";
  command: string;
  project_key: string;
  run_id: string;
  run_dir: string;
  stages: StageResult[];
  dry_run: boolean;
  review: boolean;
  schema_context_hash: string;
  changed_files: string[];
  validation: {
    ok: boolean;
    findings: string[];
  };
  stopped_reason?: string;
};

export type StageResult = {
  stage_id: string;
  kind: "llm" | "apply" | "validate";
  status: "completed" | "failed" | "skipped";
  artifact?: string;
  error?: string;
};

type StageDefinition = {
  id: string;
  stage: string;
  instructions: string;
  config: JsonObject;
};

const LEARN_STAGES = ["01-sense", "02-impact", "03-propose", "04-apply", "06-validate"];
const INGEST_STAGES = ["08-ingest", "04-apply", "06-validate"];

export async function runProjectPipeline(
  root: string,
  projectKey: string,
  kind: PipelineKind,
  options: PipelineOptions = {},
): Promise<PipelineRunResult> {
  const project = await findProject(root, projectKey);
  const startedAt = options.now ?? new Date();
  const runDir = await createRunDir(root, projectKey);
  const runId = basename(runDir);
  const stages = kind === "learn" ? LEARN_STAGES : INGEST_STAGES;
  const dryRun = Boolean(options.dryRun);
  const review = Boolean(options.review);
  const stageResults: StageResult[] = [];

  const schema = await ensureSchemaForPipeline(root, projectKey, kind, dryRun, startedAt);
  const runContext = {
    command: `project ${kind}`,
    project_key: projectKey,
    project_dir: relative(root, project.dir),
    run_id: runId,
    dry_run: dryRun,
    review,
    provisional_semantics: "Phase-0 pipeline orchestration; reconcile, self-correct, acceptance, and measure are deferred.",
    schema_context_hash: schema.hash,
  };
  await writeJson(join(runDir, "run-context.json"), runContext);

  let stoppedReason: string | undefined;
  for (const stageId of stages) {
    const definition = await loadStage(root, stageId);
    try {
      if (stageId === "04-apply") {
        const result = await runApplyStage(root, projectKey, runDir, dryRun, review, startedAt);
        stageResults.push(result);
      } else if (stageId === "06-validate") {
        const result = await runValidateStage(runDir);
        stageResults.push(result);
        if (result.status !== "completed") {
          stoppedReason = result.error ?? "validation failed";
          break;
        }
      } else {
        stageResults.push(await runLlmStage(root, projectKey, runDir, definition, options));
      }
    } catch (error) {
      stoppedReason = error instanceof Error ? error.message : String(error);
      stageResults.push({ stage_id: stageId, kind: stageKind(stageId), status: "failed", error: stoppedReason });
      break;
    }
  }

  const validation = await readJsonIfExists<{ ok?: boolean; findings?: unknown[] }>(join(runDir, "validation-findings.json"));
  const changedFiles = [...new Set([...(await collectChangedFiles(runDir)), "pipeline-result.json"])].sort();
  const failed = stageResults.some((stage) => stage.status === "failed");
  const status = failed ? "failed" : review ? "needs_review" : "completed";
  const result: PipelineRunResult = {
    status,
    command: `project ${kind}`,
    project_key: projectKey,
    run_id: runId,
    run_dir: relative(root, runDir),
    stages: stageResults,
    dry_run: dryRun,
    review,
    schema_context_hash: schema.hash,
    changed_files: changedFiles,
    validation: {
      ok: validation?.ok === true && !failed,
      findings: Array.isArray(validation?.findings) ? validation.findings.map(String) : [],
    },
    stopped_reason: stoppedReason,
  };

  await writeJson(join(runDir, "pipeline-result.json"), result);
  if (!dryRun && !review && !failed) {
    await writeProjectState(root, projectKey, "update-state.json", {
      project: projectKey,
      latest_run_dir: result.run_dir,
      last_completed_stage: "validate",
      stages: Object.fromEntries(stageResults.map((stage) => [stage.stage_id, { status: stage.status }])),
      updated_at: startedAt.toISOString(),
    });
  }
  return result;
}

async function ensureSchemaForPipeline(
  root: string,
  projectKey: string,
  kind: PipelineKind,
  dryRun: boolean,
  now: Date,
): Promise<{ hash: string }> {
  if (kind !== "learn") {
    const context = await readJsonIfExists<unknown>(statePath(root, projectKey, "schema-context.json"));
    const parsed = await validateSchemaContext(context);
    return { hash: sha256(stableJson(parsed)) };
  }

  const existing = await readJsonIfExists<unknown>(statePath(root, projectKey, "schema-context.json"));
  if (!existing) {
    const built = await buildSchemaContext(root, projectKey, { builtAt: now, dryRun });
    return { hash: sha256(stableJson(built.context)) };
  }

  const checked = await checkSchema(root, projectKey);
  if (!checked.ok) {
    const built = await buildSchemaContext(root, projectKey, { builtAt: now, dryRun });
    if (dryRun) return { hash: sha256(stableJson(built.context)) };
    const rechecked = await checkSchema(root, projectKey);
    if (!rechecked.ok) throw new Error(`schema check failed before learn: ${rechecked.errors.join("; ")}`);
  }

  const context = await readJsonIfExists<unknown>(statePath(root, projectKey, "schema-context.json"));
  const parsed = await validateSchemaContext(context);
  return { hash: sha256(stableJson(parsed)) };
}

async function loadStage(root: string, stageId: string): Promise<StageDefinition> {
  const stageRoot = resolveInside(root, "stages", stageId);
  const instructions = await readFile(join(stageRoot, "instructions.md"), "utf8");
  const config = (await readJsonIfExists<JsonObject>(join(stageRoot, "config.json"))) ?? {};
  return { id: stageId, stage: String(config.stage ?? stageId), instructions, config };
}

async function runLlmStage(
  root: string,
  projectKey: string,
  runDir: string,
  definition: StageDefinition,
  options: PipelineOptions,
): Promise<StageResult> {
  const prompt = [
    definition.instructions,
    "",
    "Return ONLY this JSON object on stdout. Do not write files.",
    stableJson({
      project_key: projectKey,
      stage_id: definition.id,
      stage_config: definition.config,
      run_dir: runDir,
    }),
  ].join("\n");
  const result = await invokeLlm({
    root,
    workload: "pipeline",
    stageId: definition.id,
    prompt,
    provider: options.provider,
    modelOverride: options.modelOverride,
    env: options.env,
    cwd: root,
    runner: options.runner,
  });
  const artifact = `${definition.stage}-result.json`;
  await writeJson(join(runDir, artifact), {
    stage_id: definition.id,
    stage: definition.stage,
    response: result.response,
    tokens_consumed: result.tokens_consumed,
  });
  return { stage_id: definition.id, kind: "llm", status: "completed", artifact };
}

async function runApplyStage(
  root: string,
  projectKey: string,
  runDir: string,
  dryRun: boolean,
  review: boolean,
  now: Date,
): Promise<StageResult> {
  const proposal = await readJsonIfExists<{ response?: JsonObject }>(join(runDir, "propose-result.json"));
  const risk = classifyProposalRisk(proposal?.response, review);
  const artifact = "apply-result.json";
  await writeJson(join(runDir, artifact), {
    stage: "apply",
    applied: !dryRun && !risk.requires_review,
    dry_run: dryRun,
    risk,
    changed_files: [],
    provenance: {
      schema_context: "run-context.json",
      proposal: proposal ? "propose-result.json" : null,
    },
  });
  if (!dryRun && !risk.requires_review) {
    await writeProjectState(root, projectKey, "freshness.json", {
      status: "current",
      updated_at: now.toISOString(),
      source_run_dir: relative(root, runDir),
    });
  }
  return { stage_id: "04-apply", kind: "apply", status: "completed", artifact };
}

async function runValidateStage(runDir: string): Promise<StageResult> {
  const apply = await readJsonIfExists<{ risk?: { requires_review?: boolean } }>(join(runDir, "apply-result.json"));
  const findings: string[] = [];
  if (!apply) findings.push("apply-result.json is missing");
  if (apply?.risk?.requires_review) findings.push("run requires human review before durable apply");
  const ok = findings.length === 0;
  const artifact = "validation-findings.json";
  await writeJson(join(runDir, artifact), {
    stage: "validate",
    ok,
    findings,
    deferred: ["reconcile", "self-correct", "acceptance", "measure"],
  });
  return ok
    ? { stage_id: "06-validate", kind: "validate", status: "completed", artifact }
    : { stage_id: "06-validate", kind: "validate", status: "failed", artifact, error: findings.join("; ") };
}

function classifyProposalRisk(proposal: JsonObject | undefined, review: boolean): { classification: string; requires_review: boolean; reasons: string[] } {
  const reasons = review ? ["explicit --review"] : [];
  if (proposal) {
    const text = stableJson(proposal).toLowerCase();
    for (const marker of ["delete", "destructive", "supersede", "decision", "low-confidence", "conflict", "broad rewrite"]) {
      if (text.includes(marker)) reasons.push(`proposal mentions ${marker}`);
    }
  }
  return {
    classification: reasons.length > 0 ? "review" : "routine",
    requires_review: reasons.length > 0,
    reasons,
  };
}

async function collectChangedFiles(runDir: string): Promise<string[]> {
  if (!existsSync(runDir)) return [];
  const files = await readdir(runDir);
  return files.filter((file) => file.endsWith(".json")).sort();
}

function stageKind(stageId: string): StageResult["kind"] {
  if (stageId === "04-apply") return "apply";
  if (stageId === "06-validate") return "validate";
  return "llm";
}

function sha256(text: string): string {
  return createHash("sha256").update(text, "utf8").digest("hex");
}
