import { createHash } from "node:crypto";
import { cp, lstat, mkdir, readFile, readdir, readlink, rename, rm, rmdir, stat, writeFile } from "node:fs/promises";
import { basename, join, relative, resolve } from "node:path";
import { stableJson } from "../runtime/json.ts";
import {
  MYELIN_VERSION_MANIFEST,
  type InstalledVersion,
  type InstalledVersionManifestV1,
  type PlannedInstalledVersion,
} from "./version-contracts.ts";

const SNAPSHOT_CANDIDATES = ["src", "vendor", "node_modules", "package.json", "bun.lock"] as const;
const REQUIRED_ARTIFACTS = ["src", "package.json"] as const;

export type VersionStorePaths = {
  root: string;
  versions: string;
  staging: string;
};

export function versionStorePaths(root: string): VersionStorePaths {
  const resolved = resolve(root);
  return { root: resolved, versions: join(resolved, "versions"), staging: join(resolved, "staging") };
}

export async function planInstalledVersion(input: {
  sourceRoot: string;
  storeRoot: string;
  installedAt: string;
}): Promise<PlannedInstalledVersion> {
  const sourceRoot = resolve(input.sourceRoot);
  const store = versionStorePaths(input.storeRoot);
  const managedSourceManifestPath = join(sourceRoot, MYELIN_VERSION_MANIFEST);
  const managedSourceManifest = await readVersionManifestIfExists(managedSourceManifestPath);
  if (managedSourceManifest) {
    if (resolve(join(sourceRoot, "..", "..")) !== store.root) {
      throw new Error(`Managed Myelin runtime source is outside the configured version store: ${sourceRoot}`);
    }
    const contentSha256 = await contentDigest(sourceRoot, managedSourceManifest.artifacts);
    if (contentSha256 !== managedSourceManifest.content_sha256) {
      throw new Error(`Managed Myelin runtime source content is invalid: ${sourceRoot}`);
    }
    const text = await readFile(managedSourceManifestPath, "utf8");
    return {
      version: {
        id: managedSourceManifest.version_id,
        path: sourceRoot,
        manifest_path: managedSourceManifestPath,
        manifest_sha256: sha256(text),
        product_version: managedSourceManifest.product_version,
        source_revision: managedSourceManifest.source_revision,
        source_dirty: managedSourceManifest.source_dirty,
        content_sha256: managedSourceManifest.content_sha256,
        bun_lock_sha256: managedSourceManifest.bun_lock_sha256,
        installed_at: managedSourceManifest.installed_at,
      },
      manifest: managedSourceManifest,
      artifacts: managedSourceManifest.artifacts,
      already_present: true,
    };
  }
  const artifacts = await snapshotArtifacts(sourceRoot);
  const contentSha256 = await contentDigest(sourceRoot, artifacts);
  const packageJson = JSON.parse(await readFile(join(sourceRoot, "package.json"), "utf8")) as { version?: unknown };
  if (typeof packageJson.version !== "string" || !/^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/.test(packageJson.version)) {
    throw new Error("Myelin package.json must declare a semantic version before installation.");
  }
  const sourceRevision = gitOutput(sourceRoot, ["rev-parse", "HEAD"]);
  const sourceDirty = Boolean(gitOutput(sourceRoot, ["status", "--porcelain"]));
  const bunLockSha256 = artifacts.includes("bun.lock") ? sha256(await readFile(join(sourceRoot, "bun.lock"), "utf8")) : null;
  const revisionLabel = sourceRevision?.slice(0, 12) ?? "local";
  const versionId = `${packageJson.version}+${revisionLabel}.${contentSha256.slice(0, 12)}`;
  const versionPath = join(store.versions, versionId);
  const manifestPath = join(versionPath, MYELIN_VERSION_MANIFEST);
  const existing = await readVersionManifestIfExists(manifestPath);
  const manifest: InstalledVersionManifestV1 = existing ?? {
    schema_version: 1,
    version_id: versionId,
    product_version: packageJson.version,
    source_revision: sourceRevision,
    source_dirty: sourceDirty,
    content_sha256: contentSha256,
    bun_lock_sha256: bunLockSha256,
    entrypoint: "src/cli.ts",
    installed_at: input.installedAt,
    artifacts,
  };
  assertManifestMatchesPlan(manifest, { versionId, contentSha256, artifacts });
  const manifestSha256 = sha256(serializeManifest(manifest));
  return {
    version: {
      id: versionId,
      path: versionPath,
      manifest_path: manifestPath,
      manifest_sha256: manifestSha256,
      product_version: manifest.product_version,
      source_revision: manifest.source_revision,
      source_dirty: manifest.source_dirty,
      content_sha256: manifest.content_sha256,
      bun_lock_sha256: manifest.bun_lock_sha256,
      installed_at: manifest.installed_at,
    },
    manifest,
    artifacts,
    already_present: existing !== null,
  };
}

export async function promoteInstalledVersion(input: {
  sourceRoot: string;
  storeRoot: string;
  transactionId: string;
  plan: PlannedInstalledVersion;
}): Promise<void> {
  if (input.plan.already_present) {
    await verifyInstalledVersion(input.plan.version);
    return;
  }
  const store = versionStorePaths(input.storeRoot);
  const stage = join(store.staging, input.transactionId);
  await rm(stage, { recursive: true, force: true });
  await mkdir(stage, { recursive: true, mode: 0o700 });
  for (const artifact of input.plan.artifacts) {
    await cp(join(input.sourceRoot, artifact), join(stage, artifact), {
      recursive: true,
      preserveTimestamps: true,
      verbatimSymlinks: true,
      errorOnExist: true,
    });
  }
  const stagedDigest = await contentDigest(stage, input.plan.artifacts);
  if (stagedDigest !== input.plan.version.content_sha256) {
    await rm(stage, { recursive: true, force: true });
    throw new Error("Myelin source changed while the immutable version was being staged.");
  }
  await writeFile(join(stage, MYELIN_VERSION_MANIFEST), serializeManifest(input.plan.manifest), {
    encoding: "utf8",
    mode: 0o600,
  });
  await mkdir(store.versions, { recursive: true, mode: 0o700 });
  try {
    await rename(stage, input.plan.version.path);
  } catch (error) {
    if (!hasCode(error, "EEXIST") && !hasCode(error, "ENOTEMPTY")) throw error;
    await rm(stage, { recursive: true, force: true });
  }
  await verifyInstalledVersion(input.plan.version);
}

export async function verifyInstalledVersion(version: InstalledVersion): Promise<InstalledVersionManifestV1> {
  const text = await readFile(version.manifest_path, "utf8");
  if (sha256(text) !== version.manifest_sha256) throw new Error(`Installed version manifest hash mismatch: ${version.id}`);
  const manifest = parseInstalledVersionManifest(JSON.parse(text), version.manifest_path);
  if (manifest.version_id !== version.id || manifest.content_sha256 !== version.content_sha256) {
    throw new Error(`Installed version identity mismatch: ${version.id}`);
  }
  const digest = await contentDigest(version.path, manifest.artifacts);
  if (digest !== manifest.content_sha256) throw new Error(`Installed version content hash mismatch: ${version.id}`);
  return manifest;
}

export async function pruneInstalledVersions(input: {
  storeRoot: string;
  retainIds: string[];
}): Promise<string[]> {
  const store = versionStorePaths(input.storeRoot);
  const retain = new Set(input.retainIds);
  let entries;
  try {
    entries = await readdir(store.versions, { withFileTypes: true });
  } catch (error) {
    if (hasCode(error, "ENOENT")) return [];
    throw error;
  }
  const removed: string[] = [];
  for (const entry of entries) {
    if (!entry.isDirectory() || retain.has(entry.name)) continue;
    const path = join(store.versions, entry.name);
    const manifestPath = join(path, MYELIN_VERSION_MANIFEST);
    const manifest = await readVersionManifestIfExists(manifestPath);
    if (!manifest || manifest.version_id !== entry.name) continue;
    await rm(path, { recursive: true, force: true });
    removed.push(entry.name);
  }
  return removed.sort();
}

export async function removeOwnedVersionStore(storeRoot: string): Promise<string[]> {
  const store = versionStorePaths(storeRoot);
  const removed = await pruneInstalledVersions({ storeRoot, retainIds: [] });
  await rm(store.staging, { recursive: true, force: true });
  for (const path of [store.versions, store.root]) {
    try {
      await rmdir(path);
    } catch (error) {
      if (!hasCode(error, "ENOENT") && !hasCode(error, "ENOTEMPTY") && !hasCode(error, "EEXIST")) throw error;
    }
  }
  return removed;
}

export function parseInstalledVersionManifest(value: unknown, path: string = MYELIN_VERSION_MANIFEST): InstalledVersionManifestV1 {
  if (!isRecord(value) || value.schema_version !== 1) throw invalidManifest(path, "unsupported schema");
  if (!isNonEmpty(value.version_id) || !isNonEmpty(value.product_version)) throw invalidManifest(path, "version identity is required");
  if (value.source_revision !== null && !isNonEmpty(value.source_revision)) throw invalidManifest(path, "source_revision is invalid");
  if (typeof value.source_dirty !== "boolean") throw invalidManifest(path, "source_dirty is invalid");
  if (!isSha256(value.content_sha256)) throw invalidManifest(path, "content_sha256 is invalid");
  if (value.bun_lock_sha256 !== null && !isSha256(value.bun_lock_sha256)) throw invalidManifest(path, "bun_lock_sha256 is invalid");
  if (value.entrypoint !== "src/cli.ts") throw invalidManifest(path, "entrypoint is invalid");
  if (!isNonEmpty(value.installed_at) || Number.isNaN(Date.parse(value.installed_at))) throw invalidManifest(path, "installed_at is invalid");
  if (!Array.isArray(value.artifacts) || value.artifacts.some((item) => !isSafeArtifact(item))) {
    throw invalidManifest(path, "artifacts are invalid");
  }
  return value as InstalledVersionManifestV1;
}

async function snapshotArtifacts(sourceRoot: string): Promise<string[]> {
  const artifacts: string[] = [];
  for (const name of SNAPSHOT_CANDIDATES) {
    try {
      await lstat(join(sourceRoot, name));
      artifacts.push(name);
    } catch (error) {
      if (!hasCode(error, "ENOENT")) throw error;
    }
  }
  for (const required of REQUIRED_ARTIFACTS) {
    if (!artifacts.includes(required)) throw new Error(`Myelin install source is missing required runtime artifact: ${required}`);
  }
  return artifacts;
}

async function contentDigest(root: string, artifacts: string[]): Promise<string> {
  const hash = createHash("sha256");
  for (const artifact of [...artifacts].sort()) await digestPath(hash, root, join(root, artifact));
  return hash.digest("hex");
}

async function digestPath(hash: ReturnType<typeof createHash>, root: string, path: string): Promise<void> {
  const metadata = await lstat(path);
  const name = relative(root, path).replaceAll("\\", "/");
  if (metadata.isSymbolicLink()) {
    const target = await readlink(path);
    const resolvedTarget = resolve(join(path, ".."), target);
    const relativeTarget = relative(root, resolvedTarget);
    if (target.startsWith("/") || relativeTarget === ".." || relativeTarget.startsWith(`..${process.platform === "win32" ? "\\" : "/"}`)) {
      throw new Error(`Runtime artifact symlink escapes the immutable snapshot: ${name}`);
    }
    hash.update(`link\0${name}\0${target}\0`);
    return;
  }
  if (metadata.isDirectory()) {
    hash.update(`dir\0${name}\0`);
    for (const entry of (await readdir(path)).sort()) await digestPath(hash, root, join(path, entry));
    return;
  }
  if (!metadata.isFile()) throw new Error(`Unsupported runtime artifact type: ${path}`);
  hash.update(`file\0${name}\0${metadata.mode & 0o111}\0`);
  hash.update(await readFile(path));
  hash.update("\0");
}

async function readVersionManifestIfExists(path: string): Promise<InstalledVersionManifestV1 | null> {
  try {
    await stat(path);
  } catch (error) {
    if (hasCode(error, "ENOENT")) return null;
    throw error;
  }
  try {
    return parseInstalledVersionManifest(JSON.parse(await readFile(path, "utf8")), path);
  } catch (error) {
    throw new Error(`Cannot reuse installed Myelin version at ${path}: ${error instanceof Error ? error.message : String(error)}`);
  }
}

function assertManifestMatchesPlan(
  manifest: InstalledVersionManifestV1,
  input: { versionId: string; contentSha256: string; artifacts: string[] },
): void {
  if (
    manifest.version_id !== input.versionId ||
    manifest.content_sha256 !== input.contentSha256 ||
    stableJson(manifest.artifacts) !== stableJson(input.artifacts)
  ) {
    throw new Error(`Installed Myelin version ${input.versionId} does not match the current source snapshot.`);
  }
}

function serializeManifest(manifest: InstalledVersionManifestV1): string {
  return `${JSON.stringify(manifest, null, 2)}\n`;
}

function gitOutput(root: string, args: string[]): string | null {
  const result = Bun.spawnSync(["git", "-C", root, ...args], { stdout: "pipe", stderr: "ignore" });
  if (result.exitCode !== 0) return null;
  return result.stdout.toString().trim() || null;
}

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function isSafeArtifact(value: unknown): value is string {
  return typeof value === "string" && value.length > 0 && basename(value) === value && value !== "." && value !== "..";
}

function isSha256(value: unknown): value is string {
  return typeof value === "string" && /^[a-f0-9]{64}$/.test(value);
}

function invalidManifest(path: string, detail: string): Error {
  return new Error(`Invalid installed Myelin version manifest at ${path}: ${detail}.`);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function isNonEmpty(value: unknown): value is string {
  return typeof value === "string" && value.length > 0;
}

function hasCode(error: unknown, code: string): boolean {
  return Boolean(error && typeof error === "object" && "code" in error && error.code === code);
}
