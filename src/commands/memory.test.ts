import { afterEach, beforeEach, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createCli } from "./registry.ts";
import { registerMemoryCommands } from "./memory.ts";
import { createMemoryCandidate } from "../memory/candidates.ts";
import { createSessionMemory } from "../memory/session-memories.ts";
import { openMemoryDb } from "../memory/db.ts";
import { writeJson } from "../runtime/json.ts";
import type { SchemaContext } from "../schema/types.ts";

let root: string;
let previousCwd: string;

beforeEach(async () => {
  previousCwd = process.cwd();
  root = await mkdtemp(join(tmpdir(), "myelin-query-"));
  process.chdir(root);
  await seedProject();
});

afterEach(async () => {
  process.chdir(previousCwd);
  await rm(root, { recursive: true, force: true });
});

test("memory query routes through schema taxonomy and emits the facade JSON contract", async () => {
  await writeJson(join(root, "projects", "demo", "state", "schema-context.json"), schemaContext());
  const cli = createCli("myelin");
  registerMemoryCommands(cli);

  const result = await cli.run(["memory", "query", "demo", "What decision explains retention?", "--json", "--debug"]);
  const response = JSON.parse(result.message);

  expect(result.exitCode).toBe(0);
  expect(response.degraded).toBe(false);
  expect(response.memory_scope).toBe("project_wiki");
  expect(response.citations[0]).toBe("projects/demo/wiki/decisions/retention.md");
  expect(response.source_tools).toContain("schema-context");
  expect(response.route.matched_taxonomy).toContain("decision");
});

test("memory query fails closed when schema context is missing", async () => {
  const cli = createCli("myelin");
  registerMemoryCommands(cli);

  const result = await cli.run(["memory", "query", "demo", "retention", "--json"]);
  const response = JSON.parse(result.message);

  expect(result.exitCode).toBe(0);
  expect(response.degraded).toBe(true);
  expect(response.confidence).toBe(0);
  expect(response.memory_scope).toBe("none");
  expect(response.degraded_reason).toContain("schema build");
  expect(response.degraded_reason).toContain("schema check");
});

test("memory query fails closed when schema context is invalid", async () => {
  await writeJson(join(root, "projects", "demo", "state", "schema-context.json"), { schema_version: "bad" });
  const cli = createCli("myelin");
  registerMemoryCommands(cli);

  const result = await cli.run(["memory", "query", "demo", "retention", "--json"]);
  const response = JSON.parse(result.message);

  expect(result.exitCode).toBe(0);
  expect(response.degraded).toBe(true);
  expect(response.degraded_reason).toContain("invalid schema-context.json");
});

test("memory candidates lists reviewable candidates with normalized status filters", async () => {
  const db = openMemoryDb(root);
  try {
    createMemoryCandidate(db, {
      id: "cand_1",
      project_key: "demo",
      scope: "session",
      status: "needs_review",
      candidate_type: "session.continuity",
      summary: "Possible session continuity.",
      source_event_refs: ["tomb_1"],
      evidence: { tombstones: ["tomb_1"] },
      proposed_payload: { summary: "Possible session continuity." },
      confidence: "medium",
      risk: "medium",
      reason: "Needs review",
      now: "2026-06-13T10:00:00.000Z",
    });
  } finally {
    db.close();
  }

  const cli = createCli("myelin");
  registerMemoryCommands(cli);

  const result = await cli.run(["memory", "candidates", "demo", "--status", "needs-review", "--scope", "session", "--json"]);
  const response = JSON.parse(result.message);

  expect(result.exitCode).toBe(0);
  expect(response.candidates).toHaveLength(1);
  expect(response.candidates[0].id).toBe("cand_1");
  expect(response.candidates[0].status).toBe("needs_review");
});

test("memory candidate show returns a single candidate", async () => {
  const db = openMemoryDb(root);
  try {
    createMemoryCandidate(db, {
      id: "cand_2",
      project_key: "demo",
      scope: "project",
      status: "pending",
      candidate_type: "project.fact",
      summary: "Possible project fact.",
      source_event_refs: ["tomb_2"],
      evidence: { tombstones: ["tomb_2"] },
      proposed_payload: { summary: "Possible project fact." },
      confidence: "high",
      risk: "low",
      reason: "Reviewable fact",
      now: "2026-06-13T10:00:00.000Z",
    });
  } finally {
    db.close();
  }

  const cli = createCli("myelin");
  registerMemoryCommands(cli);

  const result = await cli.run(["memory", "candidate", "show", "cand_2", "--json"]);
  const response = JSON.parse(result.message);

  expect(result.exitCode).toBe(0);
  expect(response.candidate.id).toBe("cand_2");
  expect(response.candidate.scope).toBe("project");
});

test("memory index session reports degraded indexing as JSON without throwing", async () => {
  await mkdir(join(root, "embedding-stubs"), { recursive: true });
  await writeFile(join(root, "myelin.config"), `EMBEDDING_STUB_RESPONSES_DIR=${join(root, "embedding-stubs")}\n`, "utf8");
  const db = openMemoryDb(root);
  try {
    createSessionMemory(db, {
      id: "mem_index_1",
      project_key: "demo",
      source_event_refs: ["tomb_1"],
      memory_kind: "continuity",
      summary: "Index this session memory.",
      payload: {},
      confidence: "high",
      risk: "low",
      now: "2026-06-13T10:00:00.000Z",
    });
  } finally {
    db.close();
  }

  const cli = createCli("myelin");
  registerMemoryCommands(cli);

  const result = await cli.run(["memory", "index", "session", "demo", "--limit", "1", "--batch-size", "3", "--json"]);
  const response = JSON.parse(result.message);

  expect(result.exitCode).toBe(0);
  expect(response.project_key).toBe("demo");
  expect(response.selected).toBe(1);
  expect(response.batch_size).toBe(3);
  expect(response.indexed + response.failed).toBe(1);
  expect(response.degraded).toBe(true);
  expect(response.failures).toHaveLength(1);
});

async function seedProject(): Promise<void> {
  await writeJson(join(root, "projects", "demo", "state", "project.json"), {
    key: "demo",
    name: "Demo",
  });
  await writeJson(join(root, "projects", "demo", "state", "pages.json"), {
    pages: [
      {
        path: "index.md",
        type: "index",
        linked_topics: ["overview"],
        linked_sources: [],
        freshness_status: "fresh",
        summary: "Project overview.",
        entrypoint_rank: 1,
      },
      {
        path: "wiki/decisions/retention.md",
        type: "decisions",
        linked_topics: ["decision", "retention"],
        linked_sources: ["src/retention.ts"],
        freshness_status: "fresh",
        summary: "Retention decision and provenance.",
      },
    ],
  });
  await mkdir(join(root, "projects", "demo", "wiki", "decisions"), { recursive: true });
  await writeFile(join(root, "projects", "demo", "index.md"), "# Demo\n\nProject overview.\n", "utf8");
  await writeFile(
    join(root, "projects", "demo", "wiki", "decisions", "retention.md"),
    "# Retention\n\nRetention is kept in project memory because agents need durable context.\n",
    "utf8",
  );
}

function schemaContext(): SchemaContext {
  return {
    schema_version: "0",
    built_at: "2026-06-04T00:00:00.000Z",
    inputs: {
      "schema/global.md": "a".repeat(64),
    },
    source_classification: {
      required_fields: ["source_kind"],
      source_kind: ["spec"],
      ownership: ["project:<project-key>"],
      action: ["update-existing-pages"],
    },
    memory_scopes: {
      scopes: ["project_wiki", "project_state", "none"],
      phase_0_active: ["project_wiki", "project_state", "none"],
      phase_0_deferred: ["practice"],
    },
    page_taxonomy: {
      categories: ["decision", "runbook", "architecture"],
    },
    provenance: {
      required: ["file_path_line"],
    },
    cli_vocabulary: {
      commands: ["memory query", "schema build", "schema check"],
    },
  };
}
