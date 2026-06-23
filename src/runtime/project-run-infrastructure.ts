import { createHash } from "node:crypto";
import { writeFile } from "node:fs/promises";
import { join, relative } from "node:path";
import { buildSchemaContext, checkSchema, validateSchemaContext } from "../schema/compiler.ts";
import { createRunDir, timestampRunId } from "./artifacts.ts";
import { ensureParentDir, resolveInside } from "./fs.ts";
import { readJsonIfExists, stableJson, writeJson } from "./json.ts";
import { invokeLlm, type LlmResult, type ProcessRunner } from "./llm-client.ts";
import type { Provider } from "./config.ts";
import { statePath } from "./state.ts";

export type ProjectCuratorRunPaths = {
  root: string;
  project_key: string;
  run_id: string;
  absolute_run_dir: string;
  relative_run_dir: string;
};

export type ProjectLearnSchemaContextResult = {
  hash: string;
  wrote: boolean;
};

export type EnsureProjectLearnSchemaContextOptions = {
  dryRun: boolean;
  now: Date;
};

export type InvokeProjectCuratorInput = {
  root: string;
  prompt: string;
  stageId: "curator-create" | "curator-maintain" | string;
  provider?: Provider;
  modelOverride?: string;
  env?: NodeJS.ProcessEnv;
  runner?: ProcessRunner;
};

export async function createProjectCuratorRun(
  root: string,
  projectKey: string,
  now = new Date(),
): Promise<ProjectCuratorRunPaths> {
  const runId = timestampRunId(now);
  const absoluteRunDir = await createRunDir(root, projectKey, runId, "project-learn");
  return {
    root,
    project_key: projectKey,
    run_id: runId,
    absolute_run_dir: absoluteRunDir,
    relative_run_dir: relative(root, absoluteRunDir).replaceAll("\\", "/"),
  };
}

export async function writeRunArtifact(
  run: ProjectCuratorRunPaths,
  artifact: string,
  value: unknown,
): Promise<string> {
  const path = resolveInside(run.absolute_run_dir, artifact);
  await writeJson(path, value);
  return artifact;
}

export async function writeMarkdownArtifact(
  run: ProjectCuratorRunPaths,
  artifact: string,
  markdown: string,
): Promise<string> {
  const path = resolveInside(run.absolute_run_dir, artifact);
  await ensureParentDir(path);
  await writeFile(path, markdown.endsWith("\n") ? markdown : `${markdown}\n`, "utf8");
  return artifact;
}

export async function ensureProjectLearnSchemaContext(
  root: string,
  projectKey: string,
  options: EnsureProjectLearnSchemaContextOptions,
): Promise<ProjectLearnSchemaContextResult> {
  const contextPath = statePath(root, projectKey, "schema-context.json");
  const existing = await readJsonIfExists<unknown>(contextPath);
  if (!existing) {
    const built = await buildSchemaContext(root, projectKey, { dryRun: options.dryRun, builtAt: options.now });
    return { hash: sha256(stableJson(built.context)), wrote: built.wrote };
  }

  const checked = await checkSchema(root, projectKey);
  if (!checked.ok) {
    const built = await buildSchemaContext(root, projectKey, { dryRun: options.dryRun, builtAt: options.now });
    if (options.dryRun) return { hash: sha256(stableJson(built.context)), wrote: false };

    const rechecked = await checkSchema(root, projectKey);
    if (!rechecked.ok) throw new Error(`schema check failed before project learn: ${rechecked.errors.join("; ")}`);
    return { hash: sha256(stableJson(built.context)), wrote: built.wrote };
  }

  const parsed = await validateSchemaContext(existing);
  return { hash: sha256(stableJson(parsed)), wrote: false };
}

export async function invokeProjectCurator(input: InvokeProjectCuratorInput): Promise<LlmResult> {
  return invokeLlm({
    root: input.root,
    workload: "pipeline",
    stageId: input.stageId,
    prompt: input.prompt,
    provider: input.provider,
    modelOverride: input.modelOverride,
    env: input.env,
    cwd: input.root,
    runner: input.runner,
  });
}

function sha256(text: string): string {
  return createHash("sha256").update(text, "utf8").digest("hex");
}
