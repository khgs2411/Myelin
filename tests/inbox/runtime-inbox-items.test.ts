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

  expect(await Bun.file(join(root, "sources", "demo", "index.md")).exists()).toBe(false);
  expect(await Bun.file(join(root, "sources", "demo", "inbox", "index.md")).exists()).toBe(false);
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
  expect(await Bun.file(join(root, "sources", "demo", "inbox")).exists()).toBe(false);
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
  expect(await Bun.file(join(root, "sources", "demo", "inbox")).exists()).toBe(false);
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
  await writeJson(join(root, "state", projectKey, "project.json"), {
    key: projectKey,
    name: projectKey,
  });
}
