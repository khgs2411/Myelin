import { createHash } from "node:crypto";
import { cp, readdir, readFile } from "node:fs/promises";
import { dirname, join, relative, resolve } from "node:path";
import { fingerprintTargetRepositorySnapshot } from "../runtime/file-authoring-agent.ts";
import { projectPath, projectStatePath, resolveInside } from "../runtime/fs.ts";
import { readJson, readJsonIfExists, stableJson, writeJson } from "../runtime/json.ts";
import type { ProjectCuratorRunPaths } from "../runtime/project-run-infrastructure.ts";
import type { ProjectMemoryMaintenanceModeResult } from "./project-memory-agent-service-contracts.ts";
import type { ProjectMemoryCuratorRunResult } from "./project-memory-curator-contracts.ts";
import type { ProjectMemoryPacket } from "./project-memory-packet.ts";

export const PROJECT_MEMORY_REVIEW_CHECKPOINT_REF = "review-checkpoint.json" as const;
export const PROJECT_MEMORY_REVIEW_CHECKPOINT_CONTRACT_VERSION = 1 as const;

type CheckpointArtifact = { path: string; sha256: string };

export type ProjectMemoryReviewCheckpoint = {
  schema_version: 1;
  runtime_contract_version: typeof PROJECT_MEMORY_REVIEW_CHECKPOINT_CONTRACT_VERSION;
  project_key: string;
  source_run_dir: string;
  created_at: string;
  repo_path: string;
  target_repo_fingerprint: string;
  input_packet_sha256: string;
  reviewed_sources_sha256: string;
  canonical_wiki_artifacts: CheckpointArtifact[];
  review_artifacts: CheckpointArtifact[];
  draft_wiki_files: string[];
};

export async function writeProjectMemoryReviewCheckpoint(input: {
  root: string;
  projectKey: string;
  run: ProjectCuratorRunPaths;
  repoPath: string;
  packet: ProjectMemoryPacket;
  maintenance: ProjectMemoryMaintenanceModeResult;
  now: Date;
}): Promise<ProjectMemoryReviewCheckpoint> {
  const artifactPaths = await reviewArtifactPaths(input.run.absolute_run_dir, input.maintenance);
  const canonicalWikiPaths = await listFiles(projectPath(input.root, input.projectKey), ".md");
  const checkpoint: ProjectMemoryReviewCheckpoint = {
    schema_version: 1,
    runtime_contract_version: PROJECT_MEMORY_REVIEW_CHECKPOINT_CONTRACT_VERSION,
    project_key: input.projectKey,
    source_run_dir: input.run.relative_run_dir,
    created_at: input.now.toISOString(),
    repo_path: resolve(input.repoPath),
    target_repo_fingerprint: await fingerprintTargetRepositorySnapshot(input.repoPath, input.projectKey),
    input_packet_sha256: hashJson(input.packet),
    reviewed_sources_sha256: hashJson(reviewedSources(input.packet, input.maintenance)),
    canonical_wiki_artifacts: await Promise.all(canonicalWikiPaths.map(async (path) => ({
      path: relative(input.root, path).replaceAll("\\", "/"),
      sha256: await hashFile(path),
    }))),
    review_artifacts: await Promise.all(artifactPaths.map(async (path) => ({
      path,
      sha256: await hashFile(resolveInside(input.run.absolute_run_dir, path)),
    }))),
    draft_wiki_files: artifactPaths.filter((path) => path.startsWith("agents/maintenance/draft-wiki/")),
  };
  await writeJson(resolveInside(input.run.absolute_run_dir, PROJECT_MEMORY_REVIEW_CHECKPOINT_REF), checkpoint);
  return checkpoint;
}

export async function verifyProjectMemoryReviewCheckpoint(input: {
  root: string;
  projectKey: string;
  sourceRunDir: string;
  sourceAbsoluteRunDir: string;
  repoPath: string;
  currentPacket: ProjectMemoryPacket;
}): Promise<{
  checkpoint: ProjectMemoryReviewCheckpoint;
  maintenance: ProjectMemoryMaintenanceModeResult;
  sourcePacket: ProjectMemoryPacket;
}> {
  const checkpoint = await readJson<ProjectMemoryReviewCheckpoint>(
    resolveInside(input.sourceAbsoluteRunDir, PROJECT_MEMORY_REVIEW_CHECKPOINT_REF),
  );
  assertCheckpointShape(checkpoint);
  if (checkpoint.project_key !== input.projectKey) throw promotionError("checkpoint project key does not match");
  if (checkpoint.source_run_dir !== input.sourceRunDir) throw promotionError("checkpoint source run does not match");
  if (checkpoint.repo_path !== resolve(input.repoPath)) throw promotionError("registered repository identity changed");

  const result = await readJson<ProjectMemoryCuratorRunResult>(
    resolveInside(input.sourceAbsoluteRunDir, "curator-run-result.json"),
  );
  if (
    result.status !== "needs_review" ||
    result.project_key !== input.projectKey ||
    result.mode !== "maintain" ||
    result.run_kind !== "maintenance" ||
    !result.review ||
    !result.validation_ok ||
    !result.stopped_before_writes
  ) {
    throw promotionError("source run is not an unpromoted validated maintenance review");
  }
  if (result.artifacts.review_checkpoint !== PROJECT_MEMORY_REVIEW_CHECKPOINT_REF) {
    throw promotionError("source run does not declare a review checkpoint");
  }
  if (await Bun.file(resolveInside(input.sourceAbsoluteRunDir, "project-memory-apply-journal.json")).exists()) {
    throw promotionError("source run already has a canonical apply journal");
  }

  const state = await readJsonIfExists<{ reviewed_from_run?: string }>(
    projectStatePath(input.root, input.projectKey, "project-memory.json"),
  );
  if (state?.reviewed_from_run === input.sourceRunDir) throw promotionError("source review was already promoted");

  const observedRepoFingerprint = await fingerprintTargetRepositorySnapshot(input.repoPath, input.projectKey);
  if (checkpoint.target_repo_fingerprint !== observedRepoFingerprint) {
    throw promotionError("target repository snapshot changed after review");
  }

  const sourcePacket = await readJson<ProjectMemoryPacket>(resolveInside(input.sourceAbsoluteRunDir, "input-packet.json"));
  if (checkpoint.input_packet_sha256 !== hashJson(sourcePacket)) throw promotionError("review input packet changed");
  const maintenance = await readJson<ProjectMemoryMaintenanceModeResult>(
    resolveInside(input.sourceAbsoluteRunDir, "documentation-maintenance-result.json"),
  );
  if (maintenance.status === "failed" || maintenance.project_key !== input.projectKey) {
    throw promotionError("reviewed maintenance result is not promotable");
  }
  if (checkpoint.reviewed_sources_sha256 !== hashJson(reviewedSources(sourcePacket, maintenance))) {
    throw promotionError("reviewed source set changed");
  }
  assertReviewedSourcesRemainCurrent(sourcePacket, input.currentPacket, maintenance);

  await assertArtifactManifest(
    input.sourceAbsoluteRunDir,
    checkpoint.review_artifacts,
    checkpoint.draft_wiki_files,
    "review artifact",
    "agents/maintenance/draft-wiki",
  );
  await assertCanonicalWikiUnchanged(input.root, input.projectKey, checkpoint.canonical_wiki_artifacts);
  return { checkpoint, maintenance, sourcePacket };
}

export async function copyReviewedMaintenanceDraft(input: {
  sourceAbsoluteRunDir: string;
  targetRun: ProjectCuratorRunPaths;
}): Promise<string> {
  const source = resolveInside(input.sourceAbsoluteRunDir, "agents/maintenance/draft-wiki");
  const destination = resolveInside(input.targetRun.absolute_run_dir, "agents/maintenance/draft-wiki");
  await cp(source, destination, { recursive: true, force: true });
  return destination;
}

async function reviewArtifactPaths(
  absoluteRunDir: string,
  maintenance: ProjectMemoryMaintenanceModeResult,
): Promise<string[]> {
  const paths = new Set<string>([
    "input-packet.json",
    "documentation-maintenance-result.json",
    maintenance.report_ref,
    "repository-identity.json",
    "canonical-publication-validation.json",
  ]);
  if (maintenance.file_authoring_run_ref) paths.add(maintenance.file_authoring_run_ref);
  for (const path of await listFiles(resolveInside(absoluteRunDir, "agents/maintenance/draft-wiki"))) {
    paths.add(relative(absoluteRunDir, path).replaceAll("\\", "/"));
  }
  return [...paths].sort();
}

function reviewedSources(
  packet: ProjectMemoryPacket,
  maintenance: ProjectMemoryMaintenanceModeResult,
): unknown[] {
  const byKey = pendingSourceMap(packet);
  return maintenance.report.dispositions.map((disposition) => {
    const key = `${disposition.source_kind}:${disposition.source_ref}`;
    const source = byKey.get(key);
    if (!source) throw promotionError(`review disposition source is missing from its input packet: ${key}`);
    return { key, source };
  });
}

function assertReviewedSourcesRemainCurrent(
  sourcePacket: ProjectMemoryPacket,
  currentPacket: ProjectMemoryPacket,
  maintenance: ProjectMemoryMaintenanceModeResult,
): void {
  const reviewed = pendingSourceMap(sourcePacket);
  const current = pendingSourceMap(currentPacket);
  for (const disposition of maintenance.report.dispositions) {
    const key = `${disposition.source_kind}:${disposition.source_ref}`;
    const reviewedSource = reviewed.get(key);
    const currentSource = current.get(key);
    if (!currentSource) throw promotionError(`reviewed source is no longer pending: ${key}`);
    if (stableJson(reviewedSource) !== stableJson(currentSource)) {
      throw promotionError(`reviewed source changed after review: ${key}`);
    }
  }
}

function pendingSourceMap(packet: ProjectMemoryPacket): Map<string, unknown> {
  const entries: Array<[string, unknown]> = [
    ...packet.pending.project_candidates.map((source) => [`project_candidate:${source.id}`, source] as [string, unknown]),
    ...packet.pending.project_handoffs.map((source) => [`project_handoff:${source.id}`, source] as [string, unknown]),
  ];
  return new Map(entries);
}

async function assertCanonicalWikiUnchanged(
  root: string,
  projectKey: string,
  expected: CheckpointArtifact[],
): Promise<void> {
  const currentPaths = (await listFiles(projectPath(root, projectKey), ".md"))
    .map((path) => relative(root, path).replaceAll("\\", "/"))
    .sort();
  const expectedPaths = expected.map((artifact) => artifact.path).sort();
  if (stableJson(currentPaths) !== stableJson(expectedPaths)) {
    throw promotionError("canonical Project Memory file set changed after review");
  }
  for (const artifact of expected) {
    if (await hashFile(resolveInside(root, artifact.path)) !== artifact.sha256) {
      throw promotionError(`canonical Project Memory changed after review: ${artifact.path}`);
    }
  }
}

async function assertArtifactManifest(
  root: string,
  artifacts: CheckpointArtifact[],
  expectedScopedPaths: string[],
  label: string,
  scope: string,
): Promise<void> {
  const actualScopedPaths = (await listFiles(resolveInside(root, scope)))
    .map((path) => relative(root, path).replaceAll("\\", "/"))
    .sort();
  if (stableJson(actualScopedPaths) !== stableJson([...expectedScopedPaths].sort())) {
    throw promotionError(`${label} file set changed: ${scope}`);
  }
  for (const artifact of artifacts) {
    if (await hashFile(resolveInside(root, artifact.path)) !== artifact.sha256) {
      throw promotionError(`${label} changed: ${artifact.path}`);
    }
  }
}

async function listFiles(path: string, extension?: string): Promise<string[]> {
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
    if (entry.isDirectory()) files.push(...await listFiles(next, extension));
    else if (entry.isFile() && (!extension || entry.name.endsWith(extension))) files.push(next);
  }
  return files.sort();
}

function assertCheckpointShape(value: ProjectMemoryReviewCheckpoint): void {
  if (!value || typeof value !== "object") throw promotionError("checkpoint is not an object");
  if (value.schema_version !== 1) throw promotionError("checkpoint schema version is incompatible");
  if (value.runtime_contract_version !== PROJECT_MEMORY_REVIEW_CHECKPOINT_CONTRACT_VERSION) {
    throw promotionError("checkpoint runtime contract version is incompatible");
  }
  if (
    !Array.isArray(value.canonical_wiki_artifacts) ||
    !Array.isArray(value.review_artifacts) ||
    !Array.isArray(value.draft_wiki_files)
  ) {
    throw promotionError("checkpoint artifact manifest is malformed");
  }
}

function hashJson(value: unknown): string {
  return `sha256:${createHash("sha256").update(stableJson(value), "utf8").digest("hex")}`;
}

async function hashFile(path: string): Promise<string> {
  return `sha256:${createHash("sha256").update(await readFile(path)).digest("hex")}`;
}

function promotionError(reason: string): Error {
  return new Error(`Project Memory review promotion preflight failed: ${reason}. Run a fresh \`myelin memory maintain project --review\` instead.`);
}
