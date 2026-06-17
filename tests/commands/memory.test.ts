import { afterEach, beforeEach, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createCli } from "../../src/commands/registry.ts";
import { registerMemoryCommands } from "../../src/commands/memory.ts";
import { createMemoryCandidate } from "../../src/memory/candidates.ts";
import { createSessionMemoryContexts } from "../../src/memory/session-memory-contexts.ts";
import { createSessionMemoryLink } from "../../src/memory/session-memory-links.ts";
import { createSessionMemory, supersedeSessionMemory } from "../../src/memory/session-memories.ts";
import { openMemoryDb } from "../../src/memory/db.ts";
import { stubEmbeddingFilename, type EmbeddingRequest } from "../../src/memory/embedding-provider.ts";
import { markSessionMemoryEmbeddingIndexed } from "../../src/memory/session-memory-embeddings.ts";
import { ensureSessionMemoryVectorStorage } from "../../src/memory/session-memory-embeddings.ts";
import { createSqliteVecAdapter, upsertSessionMemoryVector } from "../../src/memory/sqlite-vec.ts";
import { DEFAULT_SESSION_MEMORY_EMBEDDING_CONTRACT } from "../../src/runtime/config.ts";
import { writeJson } from "../../src/runtime/json.ts";

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

test("memory query returns session memory vector matches as JSON with diagnostics", async () => {
  await seedQueryMemoryFixture("What decision explains retention?");
  const cli = createCli("myelin");
  registerMemoryCommands(cli);

  const result = await cli.run(["memory", "query", "demo", "What decision explains retention?", "--json", "--debug"]);
  const response = JSON.parse(result.message);

  expect(result.exitCode).toBe(0);
  expect(response.degraded).toBe(false);
  expect(response.memory_scope).toBe("session_memory");
  expect(response.citations[0]).toBe("session_memory:mem_query_1");
  expect(response.source_tools).toEqual(["query-embedding-cache", "session-memory-vector-index"]);
  expect(response.matches[0]).toMatchObject({
    id: "mem_query_1",
    summary: "Retention is kept in project memory because agents need durable context.",
  });
  expect(response.layers[0]).toMatchObject({
    layer: "session_memory",
    query_embedding_cache_hit: false,
    match_count: 2,
  });
});

test("memory query reuses cached question embeddings", async () => {
  await seedQueryMemoryFixture("What decision explains retention?");
  const cli = createCli("myelin");
  registerMemoryCommands(cli);

  await cli.run(["memory", "query", "demo", "What decision explains retention?", "--json", "--debug"]);
  const result = await cli.run(["memory", "query", "demo", " what   DECISION explains retention? ", "--json", "--debug"]);
  const response = JSON.parse(result.message);

  expect(result.exitCode).toBe(0);
  expect(response.degraded).toBe(false);
  expect(response.layers[0].query_embedding_cache_hit).toBe(true);
  const db = openMemoryDb(root);
  try {
    const row = db.query("SELECT hit_count FROM query_embedding_cache").get() as { hit_count: number };
    expect(row.hit_count).toBe(2);
  } finally {
    db.close();
  }
});

test("memory query non-json output prints bounded session memory matches", async () => {
  await seedQueryMemoryFixture("What decision explains retention?");
  const cli = createCli("myelin");
  registerMemoryCommands(cli);

  const result = await cli.run(["memory", "query", "demo", "What decision explains retention?", "--limit", "1"]);

  expect(result.exitCode).toBe(0);
  expect(result.message).toContain("mem_query_1");
  expect(result.message).toContain("Retention is kept in project memory");
  expect(result.message).not.toContain("mem_query_2");
});

test("memory query can filter session memory by captured git branch", async () => {
  await seedQueryMemoryFixture("What decision explains retention?");
  const db = openMemoryDb(root);
  try {
    createSessionMemoryContexts(db, [
      {
        session_memory_id: "mem_query_1",
        project_key: "demo",
        repo_path: join(root, "repos", "demo"),
        git_branch: "feature/sqlite-vec",
        git_commit: "abc123",
        git_worktree_id: join(root, "repos", "demo"),
        source_event_ref: "tomb_1",
      },
      {
        session_memory_id: "mem_query_2",
        project_key: "demo",
        repo_path: join(root, "repos", "demo"),
        git_branch: "feature/other",
        git_commit: "def456",
        git_worktree_id: join(root, "repos", "demo"),
        source_event_ref: "tomb_2",
      },
    ]);
  } finally {
    db.close();
  }
  const cli = createCli("myelin");
  registerMemoryCommands(cli);

  const result = await cli.run([
    "memory",
    "query",
    "demo",
    "What decision explains retention?",
    "--branch",
    "feature/sqlite-vec",
    "--json",
  ]);
  const response = JSON.parse(result.message);

  expect(result.exitCode).toBe(0);
  expect(response.matches.map((match: { id: string }) => match.id)).toEqual(["mem_query_1"]);
  expect(response.matches[0].contexts[0].git_branch).toBe("feature/sqlite-vec");
});

test("memory session list filters lifecycle status", async () => {
  await seedSessionLifecycleFixture();
  const cli = createCli("myelin");
  registerMemoryCommands(cli);

  const active = await cli.run(["memory", "session", "list", "demo", "--status", "active", "--json"]);
  const superseded = await cli.run(["memory", "session", "list", "demo", "--status", "superseded"]);

  expect(active.exitCode).toBe(0);
  expect(JSON.parse(active.message).memories.map((memory: { id: string }) => memory.id)).toEqual(["mem_life_new"]);
  expect(superseded.exitCode).toBe(0);
  expect(superseded.message).toContain("mem_life_old [superseded]");
  expect(superseded.message).toContain("mem_life_new");
});

test("memory session show includes lifecycle and context details", async () => {
  await seedSessionLifecycleFixture();
  const cli = createCli("myelin");
  registerMemoryCommands(cli);

  const result = await cli.run(["memory", "session", "show", "mem_life_old"]);

  expect(result.exitCode).toBe(0);
  expect(result.message).toContain("mem_life_old [superseded] decision");
  expect(result.message).toContain("superseded by: mem_life_new");
  expect(result.message).toContain("lifecycle reason: New evidence changed the branch model.");
  expect(result.message).toContain("feature/sqlite-vec");
});

test("memory session links lists reconciliation audit links", async () => {
  await seedSessionLifecycleFixture();
  const cli = createCli("myelin");
  registerMemoryCommands(cli);

  const json = await cli.run(["memory", "session", "links", "demo", "--memory", "mem_life_old", "--json"]);
  const text = await cli.run(["memory", "session", "links", "demo", "--memory", "mem_life_old"]);

  expect(json.exitCode).toBe(0);
  expect(JSON.parse(json.message).links).toMatchObject([
    {
      source_memory_id: "mem_life_new",
      target_memory_id: "mem_life_old",
      relationship: "supersedes",
    },
  ]);
  expect(text.exitCode).toBe(0);
  expect(text.message).toContain("mem_life_new supersedes mem_life_old");
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
}

async function seedQueryMemoryFixture(question: string): Promise<void> {
  const stubDir = join(root, "embedding-stubs");
  await mkdir(stubDir, { recursive: true });
  await writeFile(join(root, "myelin.config"), `EMBEDDING_STUB_RESPONSES_DIR=${stubDir}\n`, "utf8");
  const queryContract = { ...DEFAULT_SESSION_MEMORY_EMBEDDING_CONTRACT, purpose: "retrieval_query" as const };
  const request: EmbeddingRequest = {
    contract: queryContract,
    text: question,
  };
  await writeFile(
    join(stubDir, stubEmbeddingFilename(request)),
    JSON.stringify({
      embedding: unitVector(0),
      model: queryContract.model,
      dimensions: queryContract.dimensions,
    }),
    "utf8",
  );

  const db = openMemoryDb(root);
  try {
    const available = ensureSessionMemoryVectorStorage(db, {
      contract: DEFAULT_SESSION_MEMORY_EMBEDDING_CONTRACT,
      adapter: createSqliteVecAdapter(),
    });
    if (!available.available) throw new Error(`sqlite-vec unavailable in test: ${available.reason}`);
    createSessionMemory(db, {
      id: "mem_query_1",
      project_key: "demo",
      source_event_refs: ["tomb_1"],
      memory_kind: "decision",
      title: "Retention",
      summary: "Retention is kept in project memory because agents need durable context.",
      payload: {},
      confidence: "high",
      risk: "low",
      now: "2026-06-13T10:00:00.000Z",
    });
    createSessionMemory(db, {
      id: "mem_query_2",
      project_key: "demo",
      source_event_refs: ["tomb_2"],
      memory_kind: "continuity",
      title: "Far Memory",
      summary: "A less relevant memory exists for limit testing.",
      payload: {},
      confidence: "medium",
      risk: "low",
      now: "2026-06-13T10:01:00.000Z",
    });
    for (const id of ["mem_query_1", "mem_query_2"]) {
      const row = db.query("SELECT id FROM session_memory_embeddings WHERE session_memory_id = ?").get(id) as {
        id: string;
      };
      markSessionMemoryEmbeddingIndexed(db, {
        id: row.id,
        normalized_text_hash: `hash_${id}`,
        now: "2026-06-13T10:05:00.000Z",
      });
    }
    upsertSessionMemoryVector(db, {
      memory_id: "mem_query_1",
      project_key: "demo",
      embedding_model: DEFAULT_SESSION_MEMORY_EMBEDDING_CONTRACT.model,
      embedding_dimensions: DEFAULT_SESSION_MEMORY_EMBEDDING_CONTRACT.dimensions,
      embedding_purpose: DEFAULT_SESSION_MEMORY_EMBEDDING_CONTRACT.purpose,
      format_version: DEFAULT_SESSION_MEMORY_EMBEDDING_CONTRACT.formatVersion,
      embedding: unitVector(0),
    });
    upsertSessionMemoryVector(db, {
      memory_id: "mem_query_2",
      project_key: "demo",
      embedding_model: DEFAULT_SESSION_MEMORY_EMBEDDING_CONTRACT.model,
      embedding_dimensions: DEFAULT_SESSION_MEMORY_EMBEDDING_CONTRACT.dimensions,
      embedding_purpose: DEFAULT_SESSION_MEMORY_EMBEDDING_CONTRACT.purpose,
      format_version: DEFAULT_SESSION_MEMORY_EMBEDDING_CONTRACT.formatVersion,
      embedding: unitVector(1),
    });
  } finally {
    db.close();
  }
}

async function seedSessionLifecycleFixture(): Promise<void> {
  const db = openMemoryDb(root);
  try {
    createSessionMemory(db, {
      id: "mem_life_old",
      project_key: "demo",
      source_event_refs: ["tomb_old"],
      memory_kind: "decision",
      title: "Old branch model",
      summary: "Session Memory is branch-bound.",
      payload: {},
      confidence: "high",
      risk: "low",
      now: "2026-06-13T09:00:00.000Z",
    });
    createSessionMemory(db, {
      id: "mem_life_new",
      project_key: "demo",
      source_event_refs: ["tomb_new"],
      memory_kind: "decision",
      title: "Repo-scoped branch-aware model",
      summary: "Session Memory is repo-scoped and branch-aware when useful.",
      payload: {},
      confidence: "high",
      risk: "low",
      now: "2026-06-13T10:00:00.000Z",
    });
    createSessionMemoryContexts(db, [
      {
        session_memory_id: "mem_life_old",
        project_key: "demo",
        repo_path: join(root, "repos", "demo"),
        git_branch: "feature/sqlite-vec",
        git_commit: "abc123",
        git_worktree_id: join(root, "repos", "demo"),
        source_event_ref: "tomb_old",
      },
    ]);
    supersedeSessionMemory(db, {
      id: "mem_life_old",
      projectKey: "demo",
      supersededBy: "mem_life_new",
      reason: "New evidence changed the branch model.",
      now: "2026-06-13T10:05:00.000Z",
    });
    createSessionMemoryLink(db, {
      source_memory_id: "mem_life_new",
      target_memory_id: "mem_life_old",
      project_key: "demo",
      relationship: "supersedes",
      reason: "New evidence changed the branch model.",
      source_event_refs: ["tomb_new"],
      created_at: "2026-06-13T10:05:00.000Z",
    });
  } finally {
    db.close();
  }
}

function unitVector(index: number): number[] {
  return Array.from({ length: DEFAULT_SESSION_MEMORY_EMBEDDING_CONTRACT.dimensions }, (_, itemIndex) =>
    itemIndex === index ? 1 : 0,
  );
}
