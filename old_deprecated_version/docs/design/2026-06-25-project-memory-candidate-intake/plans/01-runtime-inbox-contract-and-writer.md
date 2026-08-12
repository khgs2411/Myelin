# Chunk 01: Runtime Inbox Contract And Writer

**Plan Set:** `../plan.md`  
**Spec:** `../spec.md`  
**Status:** Ready For Implementation  
**Depends on:** None  
**Enables:** `02-memory-inbox-create-command.md`, `03-project-candidate-intake-service.md`

## Goal

Add the V2 runtime durable-memory inbox item contract and writer. This chunk creates the shared validation surface used by both CLI creation and candidate intake, writes immutable pretty JSON source files under `projects/<key>/sources/inbox/<id>.json`, and maintains the lazy `sources/index.md` and `sources/inbox/index.md` files.

## Source Artifacts

- `../spec.md`: Runtime Inbox Contract, Creation Boundary, Data / State, Error Handling, Testing Strategy.
- `../agenda.md`: Questions 1, 2, 5, 6, 7, and 8.
- `../pseudocode/RuntimeDurableMemoryInboxContract.md`
- `../pseudocode/RuntimeInboxItemJsonFormat.md`
- `../pseudocode/MemoryInboxCreateCommandShape.md`
- `../pseudocode/CandidateIntakeReliabilityBoundary.md`
- `../../../../CONTEXT.md`: Runtime Durable-Memory Inbox glossary and V2 Project Layout relationship.
- `../../../adr/0061-use-layer-shaped-runtime-inbox-with-implemented-consumers.md`
- Code context: `src/runtime/fs.ts`, `src/runtime/ids.ts`, `src/runtime/json.ts`, `src/runtime/projects.ts`, `src/runtime/project-shell.ts`, `src/inbox/items.ts`.
- Test context: `tests/inbox/inbox.test.ts`.

## Relationships

- **Depends on:** existing runtime filesystem helpers, project discovery, and project key validation.
- **Enables:** runtime inbox creation command and project candidate intake service.
- **Shared contracts:** `RuntimeInboxItem`, `DurableMemoryLayer`, `RuntimeInboxRating`, `createRuntimeInboxItem`, `validateRuntimeInboxItem`, `runtimeInboxItemPath`, `runtimeInboxSourceRef`.
- **Integration points:** `src/commands/memory.ts` will call `createRuntimeInboxItem`; `src/project/project-memory-candidate-intake-service.ts` will call `validateRuntimeInboxItem` and `runtimeInboxSourceRef`.

## File Responsibility Map

**Create:**

- `src/inbox/runtime-inbox-items.ts` - V2 runtime durable-memory inbox item types, validation, path helpers, atomic writer, and source index maintenance.
- `tests/inbox/runtime-inbox-items.test.ts` - focused writer/validation tests for path, JSON, index creation, unsupported layer rejection, and invalid input.

**Modify:**

- None.

**Test:**

- `tests/inbox/runtime-inbox-items.test.ts` - validates the new shared source contract.

## Implementation Tasks

### Task 1: Add Failing Runtime Inbox Writer Tests

**Files:**

- Create: `tests/inbox/runtime-inbox-items.test.ts`

- [ ] **Step 1: Add focused tests**

```ts
import { afterEach, beforeEach, expect, test } from "bun:test";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  createRuntimeInboxItem,
  runtimeInboxItemPath,
  runtimeInboxSourceRef,
  validateRuntimeInboxItem,
} from "../../src/inbox/runtime-inbox-items.ts";
import { writeJson } from "../../src/runtime/json.ts";

let root: string;

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "myelin-runtime-inbox-"));
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

test("creates a project runtime inbox item as pretty JSON source material", async () => {
  await seedProject("demo");
  const result = await createRuntimeInboxItem(root, {
    projectKey: "demo",
    targetLayer: "project",
    title: "Runtime inbox is source material",
    body: "Runtime inbox records are explicit proposals, not canonical memory.",
    rationale: "The curator must verify proposals before durable memory writes.",
    evidenceRefs: ["docs/design/spec.md"],
    targetHint: "wiki/architecture/index.md",
    confidence: "high",
    risk: "medium",
    creator: "operator:test",
    now: new Date("2026-06-25T10:00:00.000Z"),
    id: "2026-06-25T10-00-00Z_a1b2c3",
  });

  expect(result.status).toBe("created");
  if (result.status !== "created") throw new Error("expected created result");
  expect(result.item.id).toBe("2026-06-25T10-00-00Z_a1b2c3");
  expect(result.path).toBe(runtimeInboxItemPath(root, "demo", result.item.id));
  expect(runtimeInboxSourceRef(result.item.id)).toBe("inbox:2026-06-25T10-00-00Z_a1b2c3");

  const savedText = await readFile(result.path, "utf8");
  expect(savedText).toContain('\n  "body": "Runtime inbox records are explicit proposals, not canonical memory.",\n');
  const saved = validateRuntimeInboxItem(JSON.parse(savedText), `${result.item.id}.json`);
  expect(saved).toMatchObject({
    schema_version: 1,
    project_key: "demo",
    target_layer: "project",
    target_scope: "demo",
    confidence: "high",
    risk: "medium",
  });

  expect(await readFile(join(root, "projects", "demo", "sources", "index.md"), "utf8")).toContain("[Inbox](inbox/index.md)");
  expect(await readFile(join(root, "projects", "demo", "sources", "inbox", "index.md"), "utf8")).toContain(
    "Runtime durable-memory inbox source proposals",
  );
});

test("duplicate runtime inbox ids fail without overwriting preserved source material", async () => {
  await seedProject("demo");
  const first = await createRuntimeInboxItem(root, {
    projectKey: "demo",
    targetLayer: "project",
    title: "Original",
    body: "Original preserved body.",
    rationale: "Original rationale.",
    evidenceRefs: [],
    targetHint: null,
    confidence: "medium",
    risk: "low",
    creator: "operator:test",
    now: new Date("2026-06-25T10:00:00.000Z"),
    id: "2026-06-25T10-00-00Z_a1b2c3",
  });
  if (first.status !== "created") throw new Error("expected first create to succeed");
  const originalText = await readFile(first.path, "utf8");

  const duplicate = await createRuntimeInboxItem(root, {
    projectKey: "demo",
    targetLayer: "project",
    title: "Replacement",
    body: "Replacement body must not overwrite the original.",
    rationale: "Replacement rationale.",
    evidenceRefs: [],
    targetHint: null,
    confidence: "high",
    risk: "high",
    creator: "operator:test",
    now: new Date("2026-06-25T10:00:01.000Z"),
    id: "2026-06-25T10-00-00Z_a1b2c3",
  });

  expect(duplicate.status).toBe("write_failed");
  if (duplicate.status !== "write_failed") throw new Error("expected duplicate write to fail");
  expect(duplicate.reason).toContain("already exists");
  expect(await readFile(first.path, "utf8")).toBe(originalText);
});

test("rejects unsupported layers before writing source material", async () => {
  await seedProject("demo");
  const result = await createRuntimeInboxItem(root, {
    projectKey: "demo",
    targetLayer: "personal",
    title: "Personal memory proposal",
    body: "Personal proposal.",
    rationale: "No consumer exists in this slice.",
    evidenceRefs: [],
    targetHint: null,
    confidence: "medium",
    risk: "low",
    creator: "operator:test",
    now: new Date("2026-06-25T10:00:00.000Z"),
    id: "2026-06-25T10-00-00Z_a1b2c3",
  });

  expect(result).toEqual({
    status: "unsupported_layer",
    layer: "personal",
    reason: "Runtime inbox only supports project proposals in this slice",
  });
  expect(await Bun.file(join(root, "projects", "demo", "sources", "inbox")).exists()).toBe(false);
});

test("fails invalid source metadata before writing", async () => {
  await seedProject("demo");
  const result = await createRuntimeInboxItem(root, {
    projectKey: "demo",
    targetLayer: "project",
    title: "Bad proposal",
    body: "",
    rationale: "Body is required.",
    evidenceRefs: [],
    targetHint: null,
    confidence: "high",
    risk: "low",
    creator: "operator:test",
    now: new Date("2026-06-25T10:00:00.000Z"),
    id: "2026-06-25T10-00-00Z_a1b2c3",
  });

  expect(result.status).toBe("invalid");
  expect(await Bun.file(join(root, "projects", "demo", "sources", "inbox")).exists()).toBe(false);
});

test("fails unknown projects before writing source material", async () => {
  const result = await createRuntimeInboxItem(root, {
    projectKey: "missing",
    targetLayer: "project",
    title: "Unknown project",
    body: "This should not create an orphan project tree.",
    rationale: "Project context must exist before source writes.",
    evidenceRefs: [],
    targetHint: null,
    confidence: "medium",
    risk: "low",
    creator: "operator:test",
    now: new Date("2026-06-25T10:00:00.000Z"),
    id: "2026-06-25T10-00-00Z_a1b2c3",
  });

  expect(result).toEqual({ status: "blocked_path", reason: "Unknown project: missing" });
  expect(await Bun.file(join(root, "projects", "missing")).exists()).toBe(false);
});

async function seedProject(projectKey: string): Promise<void> {
  await writeJson(join(root, "projects", projectKey, "state", "project.json"), {
    key: projectKey,
    name: projectKey,
  });
}
```

- [ ] **Step 2: Run the focused test**

Run: `bun test tests/inbox/runtime-inbox-items.test.ts`  
Expected: fails because `src/inbox/runtime-inbox-items.ts` does not exist.

### Task 2: Implement The Runtime Inbox Contract And Writer

**Files:**

- Create: `src/inbox/runtime-inbox-items.ts`

- [ ] **Step 1: Add the implementation**

```ts
import { link, mkdir, unlink, writeFile } from "node:fs/promises";
import { basename, join } from "node:path";
import { createId } from "../runtime/ids.ts";
import { projectPath } from "../runtime/fs.ts";
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

export async function createRuntimeInboxItem(root: string, input: CreateRuntimeInboxItemInput): Promise<CreateRuntimeInboxItemResult> {
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

async function writeIfMissing(path: string, content: string): Promise<void> {
  if (await Bun.file(path).exists()) return;
  await writeFile(path, content.endsWith("\n") ? content : `${content}\n`, "utf8");
}

function assertString(value: unknown, field: string): asserts value is string {
  if (typeof value !== "string") throw new Error(`Runtime inbox item ${field} must be a string`);
}

function isAlreadyExists(error: unknown): boolean {
  return Boolean(error && typeof error === "object" && "code" in error && error.code === "EEXIST");
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
```

- [ ] **Step 2: Run the focused test**

Run: `bun test tests/inbox/runtime-inbox-items.test.ts`  
Expected: passes all runtime inbox writer tests.

## Verification

- Run: `bun test tests/inbox/runtime-inbox-items.test.ts`  
  Expected: pass.
- Run: `bun run typecheck`  
  Expected: pass with no TypeScript errors.
- Run: `rtk git diff --check`  
  Expected: no whitespace errors.

## Acceptance Criteria Covered

- Runtime inbox item files are preserved without lifecycle rewrites.
- Pretty JSON inbox items are written under `sources/inbox/<id>.json`.
- `sources/index.md` and `sources/inbox/index.md` are created lazily.
- Confidence and risk are required `low | medium | high` values.
- Practice/Personal layers return an explicit unsupported-layer result in this slice.
- Unknown projects fail before creating any project directory or source material.
- Duplicate runtime inbox ids fail without overwriting the existing source JSON.
- The shared source validation contract exists for both creation and intake.

## Risks And Rollback

- Risk: using `writeJson` or temp+rename would overwrite existing source material. Mitigation: write a temp file, link it to the final path so existing destinations fail with `EEXIST`, and always remove the temp file.
- Risk: reusing `src/inbox/items.ts` would leak the old top-level inbox path. Mitigation: this chunk creates `src/inbox/runtime-inbox-items.ts`.
- Rollback: remove `src/inbox/runtime-inbox-items.ts` and `tests/inbox/runtime-inbox-items.test.ts`; no existing implementation files depend on them until later chunks.

## Non-Goals

- No CLI command.
- No `memory_candidates` insertion.
- No `project learn` integration.
- No Practice/Personal candidate consumers.
- No gap/stale producer routing.

## Type And Name Consistency

- Exported module: `src/inbox/runtime-inbox-items.ts`.
- Exported item type: `RuntimeInboxItem`.
- Exported writer: `createRuntimeInboxItem`.
- Exported validator: `validateRuntimeInboxItem`.
- Exported source-ref helper: `runtimeInboxSourceRef`.
- Source path: `projects/<key>/sources/inbox/<id>.json`.
- Source ref: `inbox:<id>`.
