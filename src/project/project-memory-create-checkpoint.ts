import { createHash } from "node:crypto";
import { copyFile, mkdir, readdir, readFile } from "node:fs/promises";
import { dirname, join, relative, resolve } from "node:path";
import { fingerprintTargetRepositorySnapshot } from "../runtime/file-authoring-agent.ts";
import { resolveInside } from "../runtime/fs.ts";
import { readJson, readJsonIfExists, stableJson, writeJson } from "../runtime/json.ts";
import type { ProjectCuratorRunPaths } from "../runtime/project-run-infrastructure.ts";
import type { ProjectMemoryCreateModeResult } from "./project-memory-agent-create-service.ts";
import type { ProjectMemoryCuratorRunResult } from "./project-memory-curator-contracts.ts";
import type { ProjectMemoryPacket } from "./project-memory-packet.ts";
import { projectPath } from "../runtime/fs.ts";

export const PROJECT_MEMORY_CREATE_CHECKPOINT_REF = "create-checkpoint.json" as const;
export const PROJECT_MEMORY_CREATE_CHECKPOINT_CONTRACT_VERSION = 1 as const;

type CheckpointArtifact = { path: string; sha256: string };

export type ProjectMemoryCreateCheckpoint = {
  schema_version: 1;
  runtime_contract_version: typeof PROJECT_MEMORY_CREATE_CHECKPOINT_CONTRACT_VERSION;
  project_key: string;
  source_run_dir: string;
  created_at: string;
  repo_path: string;
  target_repo_fingerprint: string;
  schema_context_hash: string;
  input_packet_sha256: string;
  pending_sources_sha256: string;
  create_artifacts: CheckpointArtifact[];
  draft_wiki_files: string[];
};

export async function writeProjectMemoryCreateCheckpoint(input: {
  root: string;
  projectKey: string;
  run: ProjectCuratorRunPaths;
  repoPath: string;
  packet: ProjectMemoryPacket;
  create: ProjectMemoryCreateModeResult;
  schemaContextHash: string;
  now: Date;
}): Promise<ProjectMemoryCreateCheckpoint> {
  const paths = await checkpointArtifactPaths(input.run.absolute_run_dir, input.create);
  const checkpoint: ProjectMemoryCreateCheckpoint = {
    schema_version: 1,
    runtime_contract_version: PROJECT_MEMORY_CREATE_CHECKPOINT_CONTRACT_VERSION,
    project_key: input.projectKey,
    source_run_dir: input.run.relative_run_dir,
    created_at: input.now.toISOString(),
    repo_path: resolve(input.repoPath),
    target_repo_fingerprint: await fingerprintTargetRepositorySnapshot(input.repoPath, input.projectKey),
    schema_context_hash: input.schemaContextHash,
    input_packet_sha256: hashJson(input.packet),
    pending_sources_sha256: hashJson(input.packet.pending),
    create_artifacts: await Promise.all(paths.map(async (path) => ({ path, sha256: await hashFile(resolveInside(input.run.absolute_run_dir, path)) }))),
    draft_wiki_files: paths.filter((path) => path.startsWith("pre-maintenance-wiki/")),
  };
  await writeJson(resolveInside(input.run.absolute_run_dir, PROJECT_MEMORY_CREATE_CHECKPOINT_REF), checkpoint);
  return checkpoint;
}

export async function verifyProjectMemoryCreateCheckpoint(input: {
  root: string;
  projectKey: string;
  sourceRunDir: string;
  sourceAbsoluteRunDir: string;
  repoPath: string;
  packet: ProjectMemoryPacket;
  schemaContextHash: string;
}): Promise<{ checkpoint: ProjectMemoryCreateCheckpoint; create: ProjectMemoryCreateModeResult }> {
  const checkpoint = await readJson<ProjectMemoryCreateCheckpoint>(
    resolveInside(input.sourceAbsoluteRunDir, PROJECT_MEMORY_CREATE_CHECKPOINT_REF),
  );
  assertCheckpointShape(checkpoint);
  if (checkpoint.project_key !== input.projectKey) throw resumeError("checkpoint project key does not match");
  if (checkpoint.source_run_dir !== input.sourceRunDir) throw resumeError("checkpoint source run does not match");
  if (checkpoint.repo_path !== resolve(input.repoPath)) throw resumeError("registered repository identity changed");
  if (checkpoint.schema_context_hash !== input.schemaContextHash) throw resumeError("schema context changed");
  if (checkpoint.input_packet_sha256 !== hashJson(input.packet)) throw resumeError("input packet changed");
  if (checkpoint.pending_sources_sha256 !== hashJson(input.packet.pending)) throw resumeError("pending source set changed");
  const fingerprint = await fingerprintTargetRepositorySnapshot(input.repoPath, input.projectKey);
  if (checkpoint.target_repo_fingerprint !== fingerprint) throw resumeError("target repository snapshot changed");

  const result = await readJson<ProjectMemoryCuratorRunResult>(resolveInside(input.sourceAbsoluteRunDir, "curator-run-result.json"));
  if (result.status !== "failed" || !result.stopped_before_writes || result.run_kind !== "create_then_maintenance") {
    throw resumeError("source run is not an unpromoted failed create_then_maintenance run");
  }
  if (await Bun.file(resolveInside(input.sourceAbsoluteRunDir, "project-memory-apply-journal.json")).exists()) {
    throw resumeError("source run has a canonical apply journal");
  }
  const state = await readJsonIfExists<{ source_run_dir?: string }>(projectPath(input.root, input.projectKey, "state", "project-memory.json"));
  if (state?.source_run_dir === input.sourceRunDir) throw resumeError("source run already promoted canonical Project Memory");

  const actualDraftFiles = (await listFiles(resolveInside(input.sourceAbsoluteRunDir, "pre-maintenance-wiki")))
    .map((path) => relative(input.sourceAbsoluteRunDir, path).replaceAll("\\", "/"))
    .sort();
  if (stableJson(actualDraftFiles) !== stableJson([...checkpoint.draft_wiki_files].sort())) {
    throw resumeError("pre-maintenance wiki file set changed");
  }
  for (const artifact of checkpoint.create_artifacts) {
    const observed = await hashFile(resolveInside(input.sourceAbsoluteRunDir, artifact.path));
    if (observed !== artifact.sha256) throw resumeError(`create artifact changed: ${artifact.path}`);
  }
  const create = await readJson<ProjectMemoryCreateModeResult>(
    resolveInside(input.sourceAbsoluteRunDir, "documentation-create-result.json"),
  );
  if (create.status !== "completed") throw resumeError("create result is incomplete");
  return { checkpoint, create };
}

export async function copyProjectMemoryCreateCheckpointArtifacts(input: {
  sourceAbsoluteRunDir: string;
  targetRun: ProjectCuratorRunPaths;
  checkpoint: ProjectMemoryCreateCheckpoint;
  create: ProjectMemoryCreateModeResult;
}): Promise<ProjectMemoryCreateModeResult> {
  for (const artifact of input.checkpoint.create_artifacts) {
    const source = resolveInside(input.sourceAbsoluteRunDir, artifact.path);
    const destination = resolveInside(input.targetRun.absolute_run_dir, artifact.path);
    await mkdir(dirname(destination), { recursive: true });
    await copyFile(source, destination);
  }
  const create = {
    ...input.create,
    draft_wiki_dir: resolveInside(input.targetRun.absolute_run_dir, "pre-maintenance-wiki"),
  };
  await writeJson(resolveInside(input.targetRun.absolute_run_dir, "documentation-create-result.json"), create);
  return create;
}

async function checkpointArtifactPaths(
  absoluteRunDir: string,
  create: ProjectMemoryCreateModeResult,
): Promise<string[]> {
  const paths = new Set<string>([
    "documentation-create-result.json",
    create.subject_manifest_ref,
    create.planner_report_ref,
    ...create.subject_report_refs,
    ...create.file_authoring_run_refs,
    create.repository_identity_ref,
  ]);
  for (const path of await listFiles(resolveInside(absoluteRunDir, "pre-maintenance-wiki"))) {
    paths.add(relative(absoluteRunDir, path).replaceAll("\\", "/"));
  }
  return [...paths].sort();
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
  return files.sort();
}

function assertCheckpointShape(value: ProjectMemoryCreateCheckpoint): void {
  if (!value || typeof value !== "object") throw resumeError("checkpoint is not an object");
  if (value.schema_version !== 1) throw resumeError("checkpoint schema version is incompatible");
  if (value.runtime_contract_version !== PROJECT_MEMORY_CREATE_CHECKPOINT_CONTRACT_VERSION) {
    throw resumeError("checkpoint runtime contract version is incompatible");
  }
  if (!Array.isArray(value.create_artifacts) || !Array.isArray(value.draft_wiki_files)) {
    throw resumeError("checkpoint artifact manifest is malformed");
  }
}

function hashJson(value: unknown): string {
  return `sha256:${createHash("sha256").update(stableJson(value), "utf8").digest("hex")}`;
}

async function hashFile(path: string): Promise<string> {
  return `sha256:${createHash("sha256").update(await readFile(path)).digest("hex")}`;
}

function resumeError(reason: string): Error {
  return new Error(`Project learn resume preflight failed: ${reason}. Run a fresh \`myelin project learn\` instead.`);
}
