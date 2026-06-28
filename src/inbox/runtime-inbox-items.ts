import { link, mkdir, unlink, writeFile } from "node:fs/promises";
import { basename, join } from "node:path";
import { projectPath } from "../runtime/fs.ts";
import { createId } from "../runtime/ids.ts";
import { stableJson } from "../runtime/json.ts";
import { findProject } from "../runtime/projects.ts";

export const runtimeInboxSchemaVersion = 1;
export const durableMemoryLayers = ["project", "practice", "personal"] as const;
export const runtimeInboxRatings = ["low", "medium", "high"] as const;

export type DurableMemoryLayer = (typeof durableMemoryLayers)[number];
export type RuntimeInboxRating = (typeof runtimeInboxRatings)[number];

export type RuntimeInboxItem = {
  schema_version: 1;
  id: string;
  project_key: string;
  created_at: string;
  creator: string;
  target_layer: DurableMemoryLayer;
  target_scope: string;
  title: string;
  body: string;
  rationale: string;
  evidence_refs: string[];
  target_hint: string | null;
  confidence: RuntimeInboxRating;
  risk: RuntimeInboxRating;
  tags: string[];
};

export type CreateRuntimeInboxItemInput = {
  projectKey: string;
  targetLayer: DurableMemoryLayer | string;
  title: string;
  body: string;
  rationale: string;
  evidenceRefs: string[];
  targetHint?: string | null;
  confidence: RuntimeInboxRating | string;
  risk: RuntimeInboxRating | string;
  creator: string;
  tags?: string[];
  now?: Date;
  id?: string;
};

export type CreateRuntimeInboxItemResult =
  | { status: "created"; item: RuntimeInboxItem; path: string; source_ref: string }
  | { status: "invalid"; reason: string }
  | { status: "unsupported_layer"; layer: string; reason: string }
  | { status: "blocked_path"; reason: string }
  | { status: "write_failed"; reason: string };

export function runtimeInboxDir(root: string, projectKey: string): string {
  return projectPath(root, projectKey, "sources", "inbox");
}

export function runtimeInboxItemPath(root: string, projectKey: string, id: string): string {
  validateRuntimeInboxItemId(id);
  return join(runtimeInboxDir(root, projectKey), `${id}.json`);
}

export function runtimeInboxSourceRef(id: string): string {
  validateRuntimeInboxItemId(id);
  return `inbox:${id}`;
}

export function validateRuntimeInboxFilename(filename: string): string {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}(?:\.\d{3})?Z_[0-9a-f]{6}\.json$/.test(filename)) {
    throw new Error(`Invalid runtime inbox item filename: ${filename}`);
  }
  return filename.slice(0, -".json".length);
}

export function validateRuntimeInboxItemId(id: string): void {
  validateRuntimeInboxFilename(`${id}.json`);
}

export function validateRuntimeInboxItem(item: unknown, filename?: string): RuntimeInboxItem {
  if (!item || typeof item !== "object" || Array.isArray(item)) {
    throw new Error("Runtime inbox item must be a JSON object");
  }

  const record = item as Record<string, unknown>;
  const required = [
    "schema_version",
    "id",
    "project_key",
    "created_at",
    "creator",
    "target_layer",
    "target_scope",
    "title",
    "body",
    "rationale",
    "evidence_refs",
    "target_hint",
    "confidence",
    "risk",
    "tags",
  ] as const;

  for (const key of required) {
    if (!(key in record)) throw new Error(`Runtime inbox item missing required field: ${key}`);
  }

  if (filename && record.id !== validateRuntimeInboxFilename(basename(filename))) {
    throw new Error("Runtime inbox item id must match filename stem");
  }
  if (record.schema_version !== runtimeInboxSchemaVersion) throw new Error("Unsupported runtime inbox schema_version");

  assertString(record.id, "id");
  validateRuntimeInboxItemId(record.id);
  assertNonEmptyString(record.project_key, "project_key");
  assertIsoTimestamp(record.created_at, "created_at");
  assertNonEmptyString(record.creator, "creator");
  if (!durableMemoryLayers.includes(record.target_layer as DurableMemoryLayer)) {
    throw new Error(`Unsupported runtime inbox target_layer: ${record.target_layer}`);
  }
  assertNonEmptyString(record.target_scope, "target_scope");
  assertNonEmptyString(record.title, "title");
  assertNonEmptyString(record.body, "body");
  assertNonEmptyString(record.rationale, "rationale");
  assertStringArray(record.evidence_refs, "evidence_refs");
  if (record.target_hint !== null) assertString(record.target_hint, "target_hint");
  assertRating(record.confidence, "confidence");
  assertRating(record.risk, "risk");
  assertStringArray(record.tags, "tags");

  return record as RuntimeInboxItem;
}

export async function createRuntimeInboxItem(
  root: string,
  input: CreateRuntimeInboxItemInput,
): Promise<CreateRuntimeInboxItemResult> {
  if (input.targetLayer !== "project") {
    return {
      status: "unsupported_layer",
      layer: String(input.targetLayer),
      reason: "Runtime inbox only supports project proposals in this slice",
    };
  }

  try {
    await findProject(root, input.projectKey);
  } catch (error) {
    return { status: "blocked_path", reason: error instanceof Error ? error.message : String(error) };
  }

  const now = input.now ?? new Date();
  const item: RuntimeInboxItem = {
    schema_version: runtimeInboxSchemaVersion,
    id: input.id ?? createId(now),
    project_key: input.projectKey,
    created_at: now.toISOString(),
    creator: input.creator,
    target_layer: "project",
    target_scope: input.projectKey,
    title: input.title,
    body: input.body,
    rationale: input.rationale,
    evidence_refs: input.evidenceRefs,
    target_hint: input.targetHint ?? null,
    confidence: input.confidence as RuntimeInboxRating,
    risk: input.risk as RuntimeInboxRating,
    tags: input.tags ?? [],
  };

  try {
    validateRuntimeInboxItem(item, `${item.id}.json`);
  } catch (error) {
    return { status: "invalid", reason: error instanceof Error ? error.message : String(error) };
  }

  let path: string;
  try {
    path = runtimeInboxItemPath(root, input.projectKey, item.id);
  } catch (error) {
    return { status: "blocked_path", reason: error instanceof Error ? error.message : String(error) };
  }

  try {
    await ensureRuntimeInboxIndexes(root, input.projectKey);
    await writeNewRuntimeInboxFile(path, `${stableJson(item)}\n`);
    return { status: "created", item, path, source_ref: runtimeInboxSourceRef(item.id) };
  } catch (error) {
    return { status: "write_failed", reason: error instanceof Error ? error.message : String(error) };
  }
}

export async function ensureRuntimeInboxIndexes(root: string, projectKey: string): Promise<void> {
  const sourcesDir = projectPath(root, projectKey, "sources");
  const inboxDir = runtimeInboxDir(root, projectKey);
  await mkdir(inboxDir, { recursive: true });
  await writeIfMissing(
    join(sourcesDir, "index.md"),
    ["# Sources", "", `Preserved source material for \`${projectKey}\`.`, "", "- [Inbox](inbox/index.md)", ""].join("\n"),
  );
  await writeIfMissing(
    join(inboxDir, "index.md"),
    [
      "# Runtime Inbox",
      "",
      `Runtime durable-memory inbox source proposals for \`${projectKey}\`.`,
      "",
      "These JSON files are preserved source material, not canonical memory.",
      "",
    ].join("\n"),
  );
}

async function writeNewRuntimeInboxFile(path: string, content: string): Promise<void> {
  const tmp = `${path}.tmp-${process.pid}-${Date.now()}`;
  try {
    await writeFile(tmp, content, { encoding: "utf8", flag: "wx" });
    await link(tmp, path);
  } catch (error) {
    if (isAlreadyExists(error)) {
      throw new Error(`Runtime inbox item already exists: ${path}`);
    }
    throw error;
  } finally {
    await unlink(tmp).catch(() => undefined);
  }
}

async function writeIfMissing(path: string, content: string): Promise<void> {
  if (await Bun.file(path).exists()) return;
  await writeFile(path, content.endsWith("\n") ? content : `${content}\n`, "utf8");
}

function assertString(value: unknown, field: string): asserts value is string {
  if (typeof value !== "string") throw new Error(`Runtime inbox item ${field} must be a string`);
}

function assertNonEmptyString(value: unknown, field: string): asserts value is string {
  assertString(value, field);
  if (value.trim().length === 0) throw new Error(`Runtime inbox item ${field} must be non-empty`);
}

function assertIsoTimestamp(value: unknown, field: string): void {
  assertString(value, field);
  if (Number.isNaN(Date.parse(value))) throw new Error(`Runtime inbox item ${field} must be an ISO timestamp`);
}

function assertStringArray(value: unknown, field: string): asserts value is string[] {
  if (!Array.isArray(value) || value.some((entry) => typeof entry !== "string")) {
    throw new Error(`Runtime inbox item ${field} must be a string array`);
  }
}

function assertRating(value: unknown, field: string): asserts value is RuntimeInboxRating {
  if (!runtimeInboxRatings.includes(value as RuntimeInboxRating)) {
    throw new Error(`Runtime inbox item ${field} must be one of: low, medium, high`);
  }
}

function isAlreadyExists(error: unknown): boolean {
  return Boolean(error && typeof error === "object" && "code" in error && error.code === "EEXIST");
}
