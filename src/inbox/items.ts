import { randomBytes } from "node:crypto";
import { writeFile, rename } from "node:fs/promises";
import { basename, join } from "node:path";
import { ensureParentDir, projectPath } from "../runtime/fs.ts";

export const inboxSchemaVersion = 1;
export const lowConfidenceThreshold = 0.66;

export const inboxSources = [
  "mcp-auto",
  "agent-enriched",
  "agent-flagged",
  "validate-auto",
  "measure-auto",
  "manual",
] as const;

export type InboxSource = (typeof inboxSources)[number];

export type InboxItem = {
  id: string;
  schema_version: 1;
  source: InboxSource;
  emitted_at: string;
  project_key: string;
  question: string;
  target_hint: string;
  confidence: number | null;
  pages_read: string[] | null;
  pages_considered: number | null;
  router_model: string | null;
  synthesizer_model: string | null;
  enriched_notes: string | null;
  question_index: number | null;
  question_tag: string | null;
  score_awarded: number | null;
  score_max: number | null;
  expected_page: string | null;
  measurement_run_id: string | null;
  operator_notes: string | null;
};

export type GapEmissionInput = {
  projectKey: string;
  question: string;
  confidence: number;
  pagesRead?: string[];
  pagesConsidered?: number;
  routerModel?: string | null;
  synthesizerModel?: string | null;
  targetHint?: string;
  now?: Date;
};

export type EmittedInboxItem = {
  item: InboxItem;
  path: string;
  emitted: boolean;
};

const requiredKeys = [
  "id",
  "schema_version",
  "source",
  "emitted_at",
  "project_key",
  "question",
  "target_hint",
  "confidence",
  "pages_read",
  "pages_considered",
  "router_model",
  "synthesizer_model",
  "enriched_notes",
  "question_index",
  "question_tag",
  "score_awarded",
  "score_max",
  "expected_page",
  "measurement_run_id",
  "operator_notes",
] as const;

export function inboxDir(root: string, projectKey: string): string {
  return projectPath(root, projectKey, "inbox");
}

export function inboxItemPath(root: string, projectKey: string, id: string): string {
  validateInboxItemId(id);
  return join(inboxDir(root, projectKey), `${id}.json`);
}

export function createInboxItemId(now: Date = new Date()): string {
  return `${timestampForFilename(now)}_${randomBytes(3).toString("hex")}`;
}

export function timestampForFilename(now: Date): string {
  return now.toISOString().replace(/:/g, "-").replace(".000Z", "Z");
}

export function validateInboxFilename(filename: string): string {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}(?:\.\d{3})?Z_[0-9a-f]{6}\.json$/.test(filename)) {
    throw new Error(`Invalid inbox item filename: ${filename}`);
  }
  return filename.slice(0, -".json".length);
}

export function validateInboxItemId(id: string): void {
  validateInboxFilename(`${id}.json`);
}

export function validateInboxItem(item: unknown, filename?: string): InboxItem {
  if (!item || typeof item !== "object" || Array.isArray(item)) {
    throw new Error("Inbox item must be a JSON object");
  }

  const record = item as Record<string, unknown>;
  for (const key of requiredKeys) {
    if (!(key in record)) throw new Error(`Inbox item missing required field: ${key}`);
  }

  if (filename && record.id !== validateInboxFilename(basename(filename))) {
    throw new Error("Inbox item id must match filename stem");
  }
  if (typeof record.id !== "string") throw new Error("Inbox item id must be a string");
  validateInboxItemId(record.id);
  if (record.schema_version !== inboxSchemaVersion) throw new Error("Unsupported inbox item schema_version");
  if (!inboxSources.includes(record.source as InboxSource)) throw new Error(`Invalid inbox item source: ${record.source}`);
  if (typeof record.emitted_at !== "string" || Number.isNaN(Date.parse(record.emitted_at))) {
    throw new Error("Inbox item emitted_at must be an ISO timestamp");
  }
  if (typeof record.project_key !== "string" || record.project_key.length === 0) {
    throw new Error("Inbox item project_key must be a non-empty string");
  }
  if (typeof record.question !== "string") throw new Error("Inbox item question must be a string");
  if (typeof record.target_hint !== "string") throw new Error("Inbox item target_hint must be a string");
  assertNullableNumber(record.confidence, "confidence");
  assertNullableStringArray(record.pages_read, "pages_read");
  assertNullableNumber(record.pages_considered, "pages_considered");
  for (const key of ["router_model", "synthesizer_model", "enriched_notes", "question_tag", "expected_page", "measurement_run_id", "operator_notes"]) {
    assertNullableString(record[key], key);
  }
  for (const key of ["question_index", "score_awarded", "score_max"]) {
    assertNullableNumber(record[key], key);
  }

  return record as InboxItem;
}

export function buildMcpAutoGapItem(input: GapEmissionInput, id = createInboxItemId(input.now), emittedAt = input.now ?? new Date()): InboxItem {
  const pagesRead = input.pagesRead ?? [];
  return validateInboxItem({
    id,
    schema_version: inboxSchemaVersion,
    source: "mcp-auto",
    emitted_at: emittedAt.toISOString(),
    project_key: input.projectKey,
    question: input.question,
    target_hint: input.targetHint ?? pagesRead[0] ?? "",
    confidence: input.confidence,
    pages_read: pagesRead,
    pages_considered: input.pagesConsidered ?? null,
    router_model: input.routerModel ?? null,
    synthesizer_model: input.synthesizerModel ?? null,
    enriched_notes: null,
    question_index: null,
    question_tag: null,
    score_awarded: null,
    score_max: null,
    expected_page: null,
    measurement_run_id: null,
    operator_notes: null,
  });
}

export async function writeInboxItem(root: string, item: InboxItem): Promise<string> {
  const path = inboxItemPath(root, item.project_key, item.id);
  validateInboxItem(item, path);
  await ensureParentDir(path);
  const tmp = `${path}.tmp-${process.pid}-${Date.now()}`;
  await writeFile(tmp, `${JSON.stringify(item, null, 2)}\n`, { encoding: "utf8", flag: "wx" });
  await rename(tmp, path);
  return path;
}

export async function emitLowConfidenceGap(root: string, input: GapEmissionInput): Promise<EmittedInboxItem | null> {
  if (input.confidence >= lowConfidenceThreshold) return null;
  const item = buildMcpAutoGapItem(input);
  return { item, path: await writeInboxItem(root, item), emitted: true };
}

function assertNullableString(value: unknown, field: string): void {
  if (value !== null && typeof value !== "string") throw new Error(`Inbox item ${field} must be a string or null`);
}

function assertNullableNumber(value: unknown, field: string): void {
  if (value !== null || value === 0) {
    if (typeof value !== "number" || !Number.isFinite(value)) {
      throw new Error(`Inbox item ${field} must be a finite number or null`);
    }
  }
}

function assertNullableStringArray(value: unknown, field: string): void {
  if (value === null) return;
  if (!Array.isArray(value) || value.some((entry) => typeof entry !== "string")) {
    throw new Error(`Inbox item ${field} must be a string array or null`);
  }
}
