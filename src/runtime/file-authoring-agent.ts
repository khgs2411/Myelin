import { createHash } from "node:crypto";
import { cp, mkdir, readdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { delimiter, dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import type { Provider, Workload } from "./config.ts";
import { resolveInvocation } from "./llm-client.ts";
import type { ProcessRunner } from "./llm-contracts.ts";
import { runProcess } from "./process.ts";

export const FILE_AUTHORING_AGENT_RESULT = "file-authoring-agent-result.json" as const;
export const FILE_AUTHORING_STUB_OUTPUTS_DIR = "FILE_AUTHORING_STUB_OUTPUTS_DIR" as const;

export type FileAuthoringOutputRoot = {
  name: string;
  relativePath: string;
};

export type FileAuthoringAgentInput = {
  root: string;
  projectKey: string;
  stageId: string;
  prompt: string;
  runDir: string;
  targetRepoDir: string;
  workspaceDir: string;
  outputRoots: FileAuthoringOutputRoot[];
  workload?: Workload;
  provider?: Provider;
  modelOverride?: string;
  env?: NodeJS.ProcessEnv;
  runner?: ProcessRunner;
  timeoutMs?: number;
};

export type FileAuthoringDiscoveredOutput = {
  root_name: string;
  relative_path: string;
  absolute_path: string;
  size_bytes: number;
};

export type FileAuthoringAgentResult = {
  schema_version: 1;
  project_key: string;
  stage_id: string;
  status: "completed" | "failed";
  provider_mode: "live" | "stub" | "test";
  provider: Provider;
  model?: string;
  sandbox: "workspace-write";
  cwd: string;
  target_repo_snapshot: string;
  allowed_output_roots: FileAuthoringOutputRoot[];
  discovered_outputs: FileAuthoringDiscoveredOutput[];
  result_ref: typeof FILE_AUTHORING_AGENT_RESULT;
  error?: string;
};

type ResolvedFileAuthoringInvocation = Awaited<ReturnType<typeof resolveInvocation>>;
type ResolvedOutputRoot = FileAuthoringOutputRoot & { absolutePath: string };
type WorkspaceSnapshot = Map<string, { sha256: string; size: number }>;

export async function runFileAuthoringAgent(input: FileAuthoringAgentInput): Promise<FileAuthoringAgentResult> {
  const env = input.env ?? process.env;
  await mkdir(input.workspaceDir, { recursive: true });

  let targetRepoSnapshot = "";
  let resolved: ResolvedFileAuthoringInvocation | null = null;
  const stubRoot = env[FILE_AUTHORING_STUB_OUTPUTS_DIR];

  try {
    targetRepoSnapshot = await prepareTargetRepoSnapshot(input);
    const allowed = input.outputRoots.map((root) => ({
      ...root,
      absolutePath: resolveInsideWorkspace(input.workspaceDir, root.relativePath),
    }));
    for (const root of allowed) await mkdir(root.absolutePath, { recursive: true });
    const before = await snapshotWorkspaceFiles(input.workspaceDir);

    resolved = await resolveInvocation(input.root, input.workload ?? "pipeline", input.provider, input.modelOverride, env);
    if (stubRoot) {
      await copyFixtureOutputs(stubRoot, input.stageId, input.workspaceDir);
    } else {
      await invokeLiveFileAuthoringAgent(input, resolved, env, targetRepoSnapshot);
    }

    await assertNoWritesOutsideAllowedRoots(input.workspaceDir, allowed, before);
    const discovered = await discoverOutputs(allowed);
    await removeTargetRepoSnapshot(targetRepoSnapshot);
    const result = agentResult(input, resolved, stubRoot ? "stub" : "live", "completed", discovered, "target-repo (removed after invocation)");
    await writeResult(input.workspaceDir, result);
    return result;
  } catch (error) {
    const fallback = resolved ?? { provider: input.provider ?? "codex" };
    await removeTargetRepoSnapshot(targetRepoSnapshot);
    const result = agentResult(input, fallback, stubRoot ? "stub" : "live", "failed", [], "target-repo (removed after invocation)", errorMessage(error));
    await writeResult(input.workspaceDir, result);
    return result;
  }
}

async function prepareTargetRepoSnapshot(input: FileAuthoringAgentInput): Promise<string> {
  const snapshotDir = resolveInsideWorkspace(input.workspaceDir, "target-repo");
  await mkdir(snapshotDir, { recursive: true });
  for (const source of await listFiles(input.targetRepoDir)) {
    if (isInsideOrEqual(input.workspaceDir, source)) continue;
    const rel = relative(input.targetRepoDir, source);
    if (shouldSkipTargetSnapshotPath(rel, input.projectKey)) continue;
    const destination = resolveInsideWorkspace(snapshotDir, rel);
    await mkdir(dirname(destination), { recursive: true });
    await writeFile(destination, await readFile(source));
  }
  return snapshotDir;
}

export function shouldSkipTargetSnapshotPath(relativePath: string, projectKey: string): boolean {
  const parts = relativePath.split(sep);
  const excludedSegments = new Set([
    ".git",
    ".adl",
    ".agents",
    ".codex",
    ".tmp",
    "node_modules",
    "state",
  ]);
  const hasGeneratedProjectRun = parts.some(
    (part, index) => part === "projects" && parts[index + 2] === "runs",
  );

  return (
    parts.some((part) => part === ".DS_Store" || part === ".mcp.json") ||
    parts.some((part) => (part === ".env" || part.startsWith(".env.")) && part !== ".env.example") ||
    parts.some((part) => excludedSegments.has(part)) ||
    hasGeneratedProjectRun ||
    relativePath.startsWith(`projects${sep}${projectKey}${sep}runs${sep}`)
  );
}

export async function fingerprintTargetRepositorySnapshot(
  targetRepoDir: string,
  projectKey: string,
): Promise<string> {
  const hash = createHash("sha256");
  const included = (await listFiles(targetRepoDir))
    .map((path) => ({ path, relativePath: relative(targetRepoDir, path) }))
    .filter(({ relativePath }) => !shouldSkipTargetSnapshotPath(relativePath, projectKey))
    .sort((a, b) => a.relativePath.localeCompare(b.relativePath));
  for (const file of included) {
    hash.update(file.relativePath.replaceAll("\\", "/"));
    hash.update("\0");
    hash.update(await readFile(file.path));
    hash.update("\0");
  }
  return `sha256:${hash.digest("hex")}`;
}

async function invokeLiveFileAuthoringAgent(
  input: FileAuthoringAgentInput,
  resolved: ResolvedFileAuthoringInvocation,
  env: NodeJS.ProcessEnv,
  targetRepoSnapshot: string,
): Promise<void> {
  if (resolved.provider !== "codex") throw new Error("file-authoring agents currently require codex provider");
  const command = [env.CODEX_BIN ?? "codex", "exec", "--skip-git-repo-check", "--sandbox", "workspace-write"];
  if (resolved.model) command.push("--model", resolved.model);
  if (resolved.reasoningEffort) command.push("-c", `model_reasoning_effort="${resolved.reasoningEffort}"`);
  command.push("-");

  const runner = input.runner ?? runProcess;
  const inheritedCeilings = env.GIT_CEILING_DIRECTORIES?.trim();
  const invocationEnv = {
    ...env,
    GIT_CEILING_DIRECTORIES: [input.workspaceDir, inheritedCeilings].filter(Boolean).join(delimiter),
  };
  const output = await runner(command, {
    cwd: input.workspaceDir,
    stdin: [
      input.prompt,
      "",
      `Target repository snapshot: ${targetRepoSnapshot}`,
      "Read repository files from target-repo/. Write only to the explicit output roots named in the prompt.",
    ].join("\n"),
    env: invocationEnv,
    timeoutMs: input.timeoutMs,
  });
  if (output.exitCode !== 0) throw new Error(`file-authoring agent failed: ${output.stderr || output.stdout}`);
}

async function copyFixtureOutputs(stubRoot: string, stageId: string, workspaceDir: string): Promise<void> {
  const fixtureDir = resolve(stubRoot, stageId);
  await cp(fixtureDir, workspaceDir, { recursive: true });
}

async function discoverOutputs(roots: ResolvedOutputRoot[]): Promise<FileAuthoringDiscoveredOutput[]> {
  const outputs: FileAuthoringDiscoveredOutput[] = [];
  for (const root of roots) {
    for (const file of await listFiles(root.absolutePath)) {
      outputs.push({
        root_name: root.name,
        relative_path: `${root.relativePath}/${relative(root.absolutePath, file).replaceAll("\\", "/")}`,
        absolute_path: file,
        size_bytes: (await stat(file)).size,
      });
    }
  }
  return outputs.sort((a, b) => a.relative_path.localeCompare(b.relative_path));
}

async function snapshotWorkspaceFiles(workspaceDir: string): Promise<WorkspaceSnapshot> {
  const snapshot: WorkspaceSnapshot = new Map();
  for (const file of await listFiles(workspaceDir)) {
    const rel = relative(workspaceDir, file).replaceAll("\\", "/");
    snapshot.set(rel, { sha256: await sha256File(file), size: (await stat(file)).size });
  }
  return snapshot;
}

async function assertNoWritesOutsideAllowedRoots(
  workspaceDir: string,
  allowedRoots: ResolvedOutputRoot[],
  before: WorkspaceSnapshot,
): Promise<void> {
  const after = await snapshotWorkspaceFiles(workspaceDir);
  for (const [relativePath, metadata] of after) {
    const previous = before.get(relativePath);
    const changed = !previous || previous.sha256 !== metadata.sha256 || previous.size !== metadata.size;
    if (!changed) continue;
    const absolutePath = join(workspaceDir, relativePath);
    const allowed = allowedRoots.some((root) => isInsideOrEqual(root.absolutePath, absolutePath));
    if (!allowed) throw new Error(`agent wrote outside allowed output roots: ${relativePath}`);
  }
}

async function listFiles(path: string): Promise<string[]> {
  let entries;
  try {
    entries = await readdir(path, { withFileTypes: true });
  } catch (error) {
    if (error && typeof error === "object" && "code" in error && error.code === "ENOENT") return [];
    throw error;
  }

  const files: string[] = [];
  for (const entry of entries) {
    const next = join(path, entry.name);
    if (entry.isDirectory()) files.push(...await listFiles(next));
    else if (entry.isFile()) files.push(next);
  }
  return files;
}

function resolveInsideWorkspace(workspaceDir: string, relativePath: string): string {
  const absolute = resolve(workspaceDir, relativePath);
  const rel = relative(workspaceDir, absolute);
  if (rel.startsWith("..") || rel === ".." || isAbsolute(rel)) {
    throw new Error(`output root ${relativePath} resolves outside file-authoring workspace`);
  }
  return absolute;
}

function isInsideOrEqual(parent: string, child: string): boolean {
  const rel = relative(parent, child);
  return rel === "" || (!rel.startsWith("..") && rel !== ".." && !isAbsolute(rel));
}

async function sha256File(path: string): Promise<string> {
  return createHash("sha256").update(await readFile(path)).digest("hex");
}

async function writeResult(workspaceDir: string, result: FileAuthoringAgentResult): Promise<void> {
  await writeFile(join(workspaceDir, FILE_AUTHORING_AGENT_RESULT), `${JSON.stringify(result, null, 2)}\n`, "utf8");
}

async function removeTargetRepoSnapshot(path: string): Promise<void> {
  if (!path) return;
  await rm(path, { recursive: true, force: true });
}

function agentResult(
  input: FileAuthoringAgentInput,
  resolved: Pick<ResolvedFileAuthoringInvocation, "provider" | "model">,
  providerMode: "live" | "stub" | "test",
  status: "completed" | "failed",
  discoveredOutputs: FileAuthoringDiscoveredOutput[],
  targetRepoSnapshot: string,
  error?: string,
): FileAuthoringAgentResult {
  return {
    schema_version: 1,
    project_key: input.projectKey,
    stage_id: input.stageId,
    status,
    provider_mode: providerMode,
    provider: resolved.provider,
    model: resolved.model,
    sandbox: "workspace-write",
    cwd: input.workspaceDir,
    target_repo_snapshot: targetRepoSnapshot,
    allowed_output_roots: input.outputRoots,
    discovered_outputs: discoveredOutputs,
    result_ref: FILE_AUTHORING_AGENT_RESULT,
    error,
  };
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
