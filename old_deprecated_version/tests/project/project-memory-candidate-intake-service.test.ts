import { afterEach, beforeEach, expect, test } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createRuntimeInboxItem, runtimeInboxItemPath } from "../../src/inbox/runtime-inbox-items.ts";
import { getMemoryCandidate } from "../../src/memory/candidates.ts";
import { openMemoryDb } from "../../src/memory/db.ts";
import { ProjectMemoryCandidateIntakeService } from "../../src/project/project-memory-candidate-intake-service.ts";
import { writeJson } from "../../src/runtime/json.ts";

let root: string;

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "myelin-candidate-intake-"));
  await writeJson(join(root, "state", "demo", "project.json"), {
    key: "demo",
    name: "Demo",
  });
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

test("normalizes a project runtime inbox item into one needs-review project candidate", async () => {
  const created = await createRuntimeInboxItem(root, {
    projectKey: "demo",
    targetLayer: "project",
    title: "Runtime inbox source material",
    body: "Runtime inbox proposals are preserved source material.",
    rationale: "Project Memory curator should verify and decide what becomes durable.",
    evidenceRefs: ["docs/design/spec.md"],
    targetHint: "wiki/architecture/index.md",
    confidence: "high",
    risk: "medium",
    creator: "operator:test",
    now: new Date("2026-06-25T10:00:00.000Z"),
    id: "2026-06-25T10-00-00Z_a1b2c3",
  });
  if (created.status !== "created") throw new Error("failed to create inbox fixture");

  const result = await new ProjectMemoryCandidateIntakeService(root).intakeProjectInbox(
    "demo",
    new Date("2026-06-25T11:00:00.000Z"),
  );

  expect(result).toMatchObject({
    project_key: "demo",
    created_candidate_ids: ["project_inbox:demo:2026-06-25T10-00-00Z_a1b2c3"],
    existing_candidate_ids: [],
    terminal_duplicate_candidate_ids: [],
    degraded: false,
    blocking: false,
  });
  const db = openMemoryDb(root);
  try {
    const candidate = getMemoryCandidate(db, "project_inbox:demo:2026-06-25T10-00-00Z_a1b2c3");
    expect(candidate).toMatchObject({
      project_key: "demo",
      scope: "project",
      status: "needs_review",
      candidate_type: "project.inbox",
      title: "Runtime inbox source material",
      confidence: "high",
      risk: "medium",
      reason: "Project Memory curator should verify and decide what becomes durable.",
    });
    expect(JSON.parse(candidate?.source_event_refs_json ?? "[]")).toEqual(["inbox:2026-06-25T10-00-00Z_a1b2c3"]);
    expect(candidate?.scope).toBe("project");
    expect(candidate?.candidate_type).toBe("project.inbox");
    expect(JSON.parse(candidate?.proposed_payload_json ?? "{}")).toMatchObject({
      body: "Runtime inbox proposals are preserved source material.",
      target_hint: "wiki/architecture/index.md",
      creator: "operator:test",
    });
  } finally {
    db.close();
  }
});

test("intake is idempotent for existing and terminal candidates", async () => {
  const created = await createRuntimeInboxItem(root, {
    projectKey: "demo",
    targetLayer: "project",
    title: "Idempotent proposal",
    body: "Proposal body.",
    rationale: "Proposal rationale.",
    evidenceRefs: [],
    targetHint: null,
    confidence: "medium",
    risk: "low",
    creator: "operator:test",
    now: new Date("2026-06-25T10:00:00.000Z"),
    id: "2026-06-25T10-00-00Z_a1b2c3",
  });
  if (created.status !== "created") throw new Error("failed to create inbox fixture");
  const service = new ProjectMemoryCandidateIntakeService(root);

  const first = await service.intakeProjectInbox("demo", new Date("2026-06-25T11:00:00.000Z"));
  const second = await service.intakeProjectInbox("demo", new Date("2026-06-25T11:01:00.000Z"));
  const db = openMemoryDb(root);
  try {
    db.query("UPDATE memory_candidates SET status = 'processed' WHERE id = ?").run(first.created_candidate_ids[0]);
  } finally {
    db.close();
  }
  const third = await service.intakeProjectInbox("demo", new Date("2026-06-25T11:02:00.000Z"));

  expect(first.created_candidate_ids).toEqual(["project_inbox:demo:2026-06-25T10-00-00Z_a1b2c3"]);
  expect(second.existing_candidate_ids).toEqual(["project_inbox:demo:2026-06-25T10-00-00Z_a1b2c3"]);
  expect(third.terminal_duplicate_candidate_ids).toEqual(["project_inbox:demo:2026-06-25T10-00-00Z_a1b2c3"]);
});

test("malformed and unsupported inbox files degrade without blocking valid intake", async () => {
  const valid = await createRuntimeInboxItem(root, {
    projectKey: "demo",
    targetLayer: "project",
    title: "Valid proposal",
    body: "Valid body.",
    rationale: "Valid rationale.",
    evidenceRefs: [],
    targetHint: null,
    confidence: "medium",
    risk: "low",
    creator: "operator:test",
    now: new Date("2026-06-25T10:00:00.000Z"),
    id: "2026-06-25T10-00-00Z_a1b2c3",
  });
  if (valid.status !== "created") throw new Error("failed to create inbox fixture");
  await writeFile(runtimeInboxItemPath(root, "demo", "2026-06-25T10-00-01Z_badbad"), "{not json", "utf8");
  await writeJson(runtimeInboxItemPath(root, "demo", "2026-06-25T10-00-02Z_b2c3d4"), {
    schema_version: 1,
    id: "2026-06-25T10-00-02Z_b2c3d4",
    project_key: "demo",
    created_at: "2026-06-25T10:00:02.000Z",
    creator: "operator:test",
    target_layer: "personal",
    target_scope: "demo",
    title: "Unsupported",
    body: "Unsupported body.",
    rationale: "Unsupported rationale.",
    evidence_refs: [],
    target_hint: null,
    confidence: "medium",
    risk: "low",
    tags: [],
  });

  const result = await new ProjectMemoryCandidateIntakeService(root).intakeProjectInbox(
    "demo",
    new Date("2026-06-25T11:00:00.000Z"),
  );

  expect(result.created_candidate_ids).toEqual(["project_inbox:demo:2026-06-25T10-00-00Z_a1b2c3"]);
  expect(result.invalid_source_refs).toEqual(["inbox:2026-06-25T10-00-01Z_badbad"]);
  expect(result.unsupported_source_refs).toEqual(["inbox:2026-06-25T10-00-02Z_b2c3d4"]);
  expect(result.degraded).toBe(true);
  expect(result.blocking).toBe(false);
});

test("unknown projects block instead of becoming inbox noops", async () => {
  const result = await new ProjectMemoryCandidateIntakeService(root).intakeProjectInbox(
    "missing",
    new Date("2026-06-25T11:00:00.000Z"),
  );

  expect(result).toMatchObject({
    project_key: "missing",
    created_candidate_ids: [],
    degraded: true,
    blocking: true,
    degraded_reasons: ["Unknown project: missing"],
  });
  expect(await Bun.file(join(root, "projects", "missing")).exists()).toBe(false);
});
