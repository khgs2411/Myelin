import { afterEach, beforeEach, expect, test } from "bun:test";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createCli } from "../../src/commands/registry.ts";
import {
  registerMemoryCommands as registerMemoryCommandsWithContext,
  type MemoryCommandDeps,
} from "../../src/commands/memory.ts";
import { createRuntimeInboxItem } from "../../src/inbox/runtime-inbox-items.ts";
import { createMemoryCandidate, getMemoryCandidate, listMemoryCandidates } from "../../src/memory/candidates.ts";
import {
  createSessionMemory,
  createSessionMemoryContexts,
  createSessionMemoryLink,
  supersedeSessionMemory,
} from "../helpers/session-mutation-authority.ts";
import { openMemoryDb } from "../../src/memory/db.ts";
import { registerInitialActiveEmbeddingContract } from "../../src/memory/embedding-contract-store.ts";
import { acquireProjectSessionMutationFence } from "../../src/memory/project-session-mutation-fence.ts";
import type { EmbeddingRequest } from "../../src/memory/embedding-types.ts";
import { stubEmbeddingFilename } from "../../src/memory/providers/stub-embedding-provider.ts";
import { normalizeQueryQuestion } from "../../src/memory/query-embedding-cache.ts";
import { markSessionMemoryEmbeddingIndexed } from "../../src/memory/session-memory-embeddings.ts";
import { ensureSessionMemoryVectorStorage } from "../../src/memory/session-memory-embeddings.ts";
import {
  createSqliteVecAdapter,
  ensureProjectMemoryRetrievalVectorTable,
  upsertProjectMemoryRetrievalVector,
  upsertSessionMemoryVector,
} from "../../src/memory/sqlite-vec.ts";
import {
  ensurePendingProjectMemoryRetrievalEmbedding,
  markProjectMemoryRetrievalEmbeddingIndexed,
} from "../../src/memory/project-memory-retrieval-storage.ts";
import { extractProjectMemorySections } from "../../src/project/project-memory-markdown-sections.ts";
import { DEFAULT_SESSION_MEMORY_EMBEDDING_CONTRACT } from "../../src/runtime/config.ts";
import { writeJson } from "../../src/runtime/json.ts";

let root: string;
let previousCwd: string;

function registerMemoryCommands(cli: ReturnType<typeof createCli>, deps: Omit<MemoryCommandDeps, "context"> = {}): void {
  registerMemoryCommandsWithContext(cli, { ...deps, context: testContext() });
}

function testContext() {
  return {
    myelinRoot: root,
    callerCwd: join(root, "caller"),
    invocationKind: "test",
    rootSource: "test_dependency",
    launcherPath: null,
    locatorPath: null,
  } as const;
}

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

test("memory embedding lifecycle commands are preview-first", async () => {
  const db = openMemoryDb(root);
  try {
    for (const scope of ["session_memory", "project_memory"] as const) {
      registerInitialActiveEmbeddingContract(db, {
        scope,
        contract: {
          provider: "ollama_nomic",
          model: "nomic-embed-text:v1.5",
          dimensions: 768,
          formatVersion: 1,
        },
      });
    }
  } finally {
    db.close();
  }
  const cli = createCli("myelin");
  registerMemoryCommands(cli);

  const migration = await cli.run(["memory", "embeddings", "migrate", "--json"]);
  expect(migration.exitCode).toBe(0);
  expect(JSON.parse(migration.message)).toMatchObject({
    contract_version: "myelin.memory.embedding-lifecycle.v1",
    mode: "preview",
    scopes: [{ scope: "session_memory", action: "none" }, { scope: "project_memory", action: "none" }],
  });
  const prune = await cli.run(["memory", "embeddings", "prune", "--json"]);
  expect(JSON.parse(prune.message)).toMatchObject({ mode: "preview", candidates: [] });
  expect((await cli.run(["memory", "embeddings", "rollback", "--apply", "--unknown"])).exitCode).toBe(1);
  const malformed = await cli.run(["memory", "embeddings", "rollback", "--apply", "--unknown", "--json"]);
  expect(malformed.exitCode).toBe(1);
  expect(JSON.parse(malformed.message)).toMatchObject({
    contract_version: "myelin.memory.embedding-lifecycle.v1",
    ok: false,
    reason_code: "embedding_lifecycle_invalid_arguments",
  });
});

test("memory embedding lifecycle JSON wraps invalid provider configuration in a stable envelope", async () => {
  const previousProvider = process.env.EMBEDDING_PROVIDER;
  process.env.EMBEDDING_PROVIDER = "definitely_invalid";
  try {
    const cli = createCli("myelin");
    registerMemoryCommands(cli);

    const result = await cli.run(["memory", "embeddings", "migrate", "--json"]);
    expect(result.exitCode).toBe(1);
    expect(JSON.parse(result.message)).toMatchObject({
      contract_version: "myelin.memory.embedding-lifecycle.v1",
      ok: false,
      kind: "embedding_lifecycle_failure",
      reason_code: "embedding_lifecycle_internal_error",
      failure_code: "embedding_lifecycle_internal_error",
    });
  } finally {
    if (previousProvider === undefined) delete process.env.EMBEDDING_PROVIDER;
    else process.env.EMBEDDING_PROVIDER = previousProvider;
  }
});

test("memory embedding lifecycle commands surface typed Session conflicts", async () => {
  await writeFile(join(root, "myelin.config"), "EMBEDDING_PROVIDER=ollama_qwen\n");
  const db = openMemoryDb(root);
  try {
    for (const scope of ["session_memory", "project_memory"] as const) {
      registerInitialActiveEmbeddingContract(db, {
        scope,
        contract: {
          provider: "ollama_nomic",
          model: "nomic-embed-text:v1.5",
          dimensions: 768,
          formatVersion: 1,
        },
      });
    }
    db.query(
      "UPDATE session_memory_mutation_authority SET mode = 'smc_v1', updated_at = ? WHERE singleton_id = 1",
    ).run("2026-08-11T09:59:00.000Z");
    expect(acquireProjectSessionMutationFence(db, {
      projectKey: "demo",
      ownerId: "job-active",
      ownerKind: "anchor_job",
      phase: "running",
      now: "2026-08-11T10:00:00.000Z",
    }).kind).toBe("acquired");
  } finally {
    db.close();
  }

  const cli = createCli("myelin");
  registerMemoryCommands(cli);
  const response = await cli.run(["memory", "embeddings", "migrate", "--apply", "--json"]);
  expect(response.exitCode).toBe(1);
  expect(JSON.parse(response.message)).toMatchObject({
    contract_version: "myelin.memory.embedding-lifecycle.v1",
    kind: "session_embedding_lifecycle_conflict",
    reason_code: "session_memory_project_busy",
    failure_code: "session_memory_project_busy",
    owner: { project_key: "demo", owner_id: "job-active" },
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

test("memory query project layer returns approved Project Memory JSON shape", async () => {
  await seedProjectMemoryQueryFixture("How is setup documented?");
  const cli = createCli("myelin");
  registerMemoryCommands(cli);

  const result = await cli.run([
    "memory",
    "query",
    "demo",
    "How is setup documented?",
    "--layer",
    "project",
    "--json",
    "--debug",
  ]);
  const response = JSON.parse(result.message);

  expect(result.exitCode).toBe(0);
  expect(response.matches).toEqual([]);
  expect(response.project_memory_matches[0]).toMatchObject({
    wiki_path: "setup/index.md",
    section_id: "setup",
    return_kind: "inline_content",
    content: "Setup is documented in canonical Project Memory.",
    citation: "project_memory:setup/index.md#setup",
  });
  expect(response.project_memory_matches[0].reference_reason).toBeUndefined();
  expect(response.layers[0]).toMatchObject({
    layer: "project_memory",
    match_count: 1,
  });
  const db = openMemoryDb(root);
  try {
    const log = db
      .query("SELECT answer_text, response_json FROM project_memory_query_logs WHERE question = ?")
      .get("How is setup documented?") as { answer_text: string; response_json: string };
    expect(log.answer_text).toContain("setup/index.md#setup");
    expect(JSON.parse(log.response_json)).toMatchObject({
      answer: response.answer,
      project_memory_matches: [{ wiki_path: "setup/index.md", section_id: "setup" }],
    });
  } finally {
    db.close();
  }
});

test("memory query rejects the removed auto layer", async () => {
  const cli = createCli("myelin");
  registerMemoryCommands(cli);

  const result = await cli.run([
    "memory",
    "query",
    "demo",
    "What changed?",
    "--layer",
    "auto",
  ]);

  expect(result.exitCode).toBe(1);
  expect(result.message).toBe("--layer must be one of: session, project");
});

test("memory eval project logs answer and eval details onto Project Memory query logs", async () => {
  await seedProjectMemoryQueryFixture("How is setup documented?");
  const fixturePath = join(root, "eval-fixture.json");
  await writeFile(
    fixturePath,
    JSON.stringify({
      questions: [
        {
          id: "setup-docs",
          question: "How is setup documented?",
          expected_primary_refs: ["setup/index.md#setup"],
          must_contain_text: ["Setup is documented"],
        },
      ],
    }),
    "utf8",
  );
  const cli = createCli("myelin");
  registerMemoryCommands(cli);

  const result = await cli.run(["memory", "eval", "project", "demo", "--fixture", fixturePath, "--json"]);
  const response = JSON.parse(result.message);

  expect(result.exitCode).toBe(0);
  expect(response).toMatchObject({
    total: 1,
    passed: 1,
    failed: 0,
    primary_rank_1: 1,
    acceptable_top_5: 1,
  });
  const db = openMemoryDb(root);
  try {
    const log = db
      .query("SELECT answer_text, response_json, eval_run_id, eval_json FROM project_memory_query_logs WHERE question = ? ORDER BY created_at DESC LIMIT 1")
      .get("How is setup documented?") as {
        answer_text: string;
        response_json: string;
        eval_run_id: string;
        eval_json: string;
      };
    expect(log.answer_text).toContain("Setup is documented in canonical Project Memory.");
    expect(JSON.parse(log.response_json)).toMatchObject({
      project_memory_matches: [{ wiki_path: "setup/index.md", section_id: "setup" }],
    });
    expect(log.eval_run_id).toBe(response.run_id);
    expect(JSON.parse(log.eval_json)).toMatchObject({
      id: "setup-docs",
      passed: true,
      top_ref: "setup/index.md#setup",
    });
  } finally {
    db.close();
  }
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

test("memory inbox create writes a runtime inbox source item and no candidate rows", async () => {
  const cli = createCli("myelin");
  registerMemoryCommands(cli, {
    now: () => new Date("2026-06-25T10:00:00.000Z"),
    creator: "operator:test",
  });

  const result = await cli.run([
    "memory",
    "inbox",
    "create",
    "demo",
    "--layer",
    "project",
    "--title",
    "Runtime inbox source material",
    "--body",
    "Runtime inbox files are explicit durable-memory proposals.",
    "--rationale",
    "Project Memory curator must verify proposals before durable writes.",
    "--evidence-ref",
    "docs/design/spec.md",
    "--confidence",
    "high",
    "--risk",
    "medium",
    "--target-hint",
    "architecture/index.md",
    "--json",
  ]);

  expect(result.exitCode).toBe(0);
  const response = JSON.parse(result.message);
  expect(response.status).toBe("created");
  expect(response.item).toMatchObject({
    project_key: "demo",
    target_layer: "project",
    confidence: "high",
    risk: "medium",
    creator: "operator:test",
  });
  expect(response.source_ref).toBe(`inbox:${response.item.id}`);

  const saved = JSON.parse(await readFile(response.path, "utf8"));
  expect(saved.body).toBe("Runtime inbox files are explicit durable-memory proposals.");
  expect(saved.evidence_refs).toEqual(["docs/design/spec.md"]);

  const db = openMemoryDb(root);
  try {
    expect(listMemoryCandidates(db, { project_key: "demo", scope: "project" })).toEqual([]);
  } finally {
    db.close();
  }
});

test("memory inbox create default output includes confidence and risk", async () => {
  const cli = createCli("myelin");
  registerMemoryCommands(cli, {
    now: () => new Date("2026-06-25T10:00:00.000Z"),
    creator: "operator:test",
  });

  const result = await cli.run([
    "memory",
    "inbox",
    "create",
    "demo",
    "--layer",
    "project",
    "--title",
    "Runtime inbox source material",
    "--body",
    "Proposal body.",
    "--rationale",
    "Proposal rationale.",
    "--confidence",
    "medium",
    "--risk",
    "low",
  ]);

  expect(result.exitCode).toBe(0);
  expect(result.message).toContain("Runtime inbox item created for demo.");
  expect(result.message).toContain("confidence: medium");
  expect(result.message).toContain("risk: low");
  expect(result.message).toContain("source ref: inbox:");
});

test("memory inbox create rejects unsupported layers, unknown projects, and invalid options before writing", async () => {
  const cli = createCli("myelin");
  registerMemoryCommands(cli, {
    now: () => new Date("2026-06-25T10:00:00.000Z"),
    creator: "operator:test",
  });

  const unsupported = await cli.run([
    "memory",
    "inbox",
    "create",
    "demo",
    "--layer",
    "personal",
    "--title",
    "Personal",
    "--body",
    "Body",
    "--rationale",
    "Rationale",
    "--confidence",
    "medium",
    "--risk",
    "low",
  ]);
  const unknownProject = await cli.run([
    "memory",
    "inbox",
    "create",
    "missing",
    "--layer",
    "project",
    "--title",
    "Unknown project",
    "--body",
    "Body",
    "--rationale",
    "Rationale",
    "--confidence",
    "medium",
    "--risk",
    "low",
  ]);
  const missingRisk = await cli.run([
    "memory",
    "inbox",
    "create",
    "demo",
    "--layer",
    "project",
    "--title",
    "Missing risk",
    "--body",
    "Body",
    "--rationale",
    "Rationale",
    "--confidence",
    "medium",
  ]);

  expect(unsupported.exitCode).toBe(1);
  expect(unsupported.message).toContain("Runtime inbox only supports project proposals in this slice");
  expect(unknownProject.exitCode).toBe(1);
  expect(unknownProject.message).toContain("Unknown project: missing");
  expect(missingRisk.exitCode).toBe(1);
  expect(missingRisk.message).toContain("--risk must be one of: low, medium, high");
  expect(await Bun.file(join(root, "sources", "demo", "inbox")).exists()).toBe(false);
  expect(await Bun.file(join(root, "projects", "missing")).exists()).toBe(false);
});

test("memory inbox intake converts runtime inbox items into candidates", async () => {
  const created = await createRuntimeInboxItem(root, {
    projectKey: "demo",
    targetLayer: "project",
    title: "Runtime inbox intake",
    body: "Runtime inbox intake creates candidates.",
    rationale: "Project learn should consume normalized candidates.",
    evidenceRefs: ["docs/design/spec.md"],
    targetHint: null,
    confidence: "high",
    risk: "medium",
    creator: "operator:test",
    now: new Date("2026-06-25T10:00:00.000Z"),
    id: "2026-06-25T10-00-00Z_a1b2c3",
  });
  if (created.status !== "created") throw new Error("failed to create inbox fixture");
  const cli = createCli("myelin");
  registerMemoryCommands(cli, {
    now: () => new Date("2026-06-25T11:00:00.000Z"),
  });

  const result = await cli.run(["memory", "inbox", "intake", "demo", "--json"]);
  const response = JSON.parse(result.message);

  expect(result.exitCode).toBe(0);
  expect(response.created_candidate_ids).toEqual(["project_inbox:demo:2026-06-25T10-00-00Z_a1b2c3"]);
  const db = openMemoryDb(root);
  try {
    expect(getMemoryCandidate(db, "project_inbox:demo:2026-06-25T10-00-00Z_a1b2c3")?.status).toBe("needs_review");
  } finally {
    db.close();
  }
});

test("memory inbox intake reports summary counts in default output", async () => {
  const created = await createRuntimeInboxItem(root, {
    projectKey: "demo",
    targetLayer: "project",
    title: "Runtime inbox intake",
    body: "Runtime inbox intake creates candidates.",
    rationale: "Project learn should consume normalized candidates.",
    evidenceRefs: [],
    targetHint: null,
    confidence: "medium",
    risk: "low",
    creator: "operator:test",
    now: new Date("2026-06-25T10:00:00.000Z"),
    id: "2026-06-25T10-00-00Z_a1b2c3",
  });
  if (created.status !== "created") throw new Error("failed to create inbox fixture");
  const cli = createCli("myelin");
  registerMemoryCommands(cli, {
    now: () => new Date("2026-06-25T11:00:00.000Z"),
  });

  const result = await cli.run(["memory", "inbox", "intake", "demo"]);

  expect(result.exitCode).toBe(0);
  expect(result.message).toContain("Runtime inbox intake for demo.");
  expect(result.message).toContain("created: 1");
  expect(result.message).toContain("existing: 0");
  expect(result.message).toContain("terminal duplicates: 0");
  expect(result.message).toContain("degraded: no");
});

test("memory inbox intake rejects unknown options, missing keys, and unknown projects", async () => {
  const cli = createCli("myelin");
  registerMemoryCommands(cli);

  const missing = await cli.run(["memory", "inbox", "intake"]);
  const unknown = await cli.run(["memory", "inbox", "intake", "demo", "--dry-run"]);
  const unknownProject = await cli.run(["memory", "inbox", "intake", "missing"]);

  expect(missing.exitCode).toBe(1);
  expect(missing.message).toContain("Usage: myelin memory inbox intake <project-key> [--json]");
  expect(unknown.exitCode).toBe(1);
  expect(unknown.message).toContain("Unknown memory inbox intake option: --dry-run");
  expect(unknownProject.exitCode).toBe(1);
  expect(unknownProject.message).toContain("Unknown project: missing");
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

test("memory index project reports Project Memory retrieval indexing as JSON", async () => {
  await mkdir(join(root, "projects", "demo"), { recursive: true });
  await writeFile(join(root, "projects", "demo", "index.md"), "# Demo\n\nProject memory body.\n", "utf8");
  const cli = createCli("myelin");
  registerMemoryCommands(cli);

  const result = await cli.run(["memory", "index", "project", "demo", "--limit", "10", "--json"]);
  const response = JSON.parse(result.message);

  expect(result.exitCode).toBe(0);
  expect(response.project_key).toBe("demo");
  expect(response).toHaveProperty("structural_sections_seen");
  expect(response).toHaveProperty("indexed");
  expect(response).toHaveProperty("degraded");
});

test("memory maintain project exposes a pure maintenance command", async () => {
  const cli = createCli("myelin");
  registerMemoryCommands(cli);

  const missing = await cli.run(["memory", "maintain", "project"]);
  const recreate = await cli.run(["memory", "maintain", "project", "demo", "--recreate"]);
  const missingPromotionRun = await cli.run(["memory", "maintain", "project", "demo", "--promote"]);
  const conflictingPromotion = await cli.run([
    "memory", "maintain", "project", "demo", "--review", "--promote", "run-id",
  ]);

  expect(missing.exitCode).toBe(1);
  expect(missing.message).toContain("Usage: myelin memory maintain project <project-key>");
  expect(recreate.exitCode).toBe(1);
  expect(recreate.message).toContain("Unknown memory maintain project option: --recreate");
  expect(missingPromotionRun.exitCode).toBe(1);
  expect(missingPromotionRun.message).toContain("--promote requires a run");
  expect(conflictingPromotion.exitCode).toBe(1);
  expect(conflictingPromotion.message).toContain("--promote cannot be combined with --dry-run or --review");
});

test("memory maintain project emits foreground progress", async () => {
  const cli = createCli("myelin");
  const progressEvents: Array<{ stage: string; status: string }> = [];
  registerMemoryCommands(cli, {
    progress: (event) => progressEvents.push(event),
  });

  await cli.run(["memory", "maintain", "project", "demo", "--review"]);

  expect(progressEvents[0]).toMatchObject({ stage: "command", status: "started" });
  expect(progressEvents.some((event) => event.stage === "preflight")).toBe(true);
  expect(progressEvents.at(-1)).toMatchObject({ stage: "run", status: "failed" });
});

test("memory review reports reviewable maintenance dispositions as JSON", async () => {
  await mkdir(join(root, "runs", "demo", "project-learn", "2026-07-07T10-00-00.000Z-run", "reports"), {
    recursive: true,
  });
  await writeJson(
    join(
      root,
      "runs",
      "demo",
      "project-learn",
      "2026-07-07T10-00-00.000Z-run",
      "reports",
      "documentation-maintenance-report.json",
    ),
    {
      schema_version: 1,
      project_key: "demo",
      status: "completed",
      dispositions: [
        {
          source_kind: "project_candidate",
          source_ref: "cand_research",
          disposition: "insufficient_evidence",
          reason: "Needs external evidence.",
          output_refs: [],
        },
        {
          source_kind: "project_handoff",
          source_ref: "handoff_other",
          disposition: "not_durable",
          reason: "Not durable.",
          output_refs: [],
        },
      ],
      touched_paths: [],
      evidence_paths: [],
      known_gaps: [],
    },
  );
  const cli = createCli("myelin");
  registerMemoryCommands(cli);

  const result = await cli.run(["memory", "review", "demo", "--status", "insufficient_evidence", "--json"]);
  const response = JSON.parse(result.message);

  expect(result.exitCode).toBe(0);
  expect(response.reviewable_count).toBe(1);
  expect(response.items[0]).toMatchObject({
    kind: "project_memory_disposition",
    status: "insufficient_evidence",
    source_ref: "cand_research",
  });
});

async function seedProject(): Promise<void> {
  await writeJson(join(root, "state", "demo", "project.json"), {
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
    text: normalizeQueryQuestion(question),
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

async function seedProjectMemoryQueryFixture(question: string): Promise<void> {
  const stubDir = join(root, "embedding-stubs");
  await mkdir(stubDir, { recursive: true });
  await writeFile(join(root, "myelin.config"), `EMBEDDING_STUB_RESPONSES_DIR=${stubDir}\n`, "utf8");
  const queryContract = { ...DEFAULT_SESSION_MEMORY_EMBEDDING_CONTRACT, purpose: "retrieval_query" as const };
  const request: EmbeddingRequest = {
    contract: queryContract,
    text: normalizeQueryQuestion(question),
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
  await mkdir(join(root, "projects", "demo", "setup"), { recursive: true });
  await writeFile(
    join(root, "projects", "demo", "setup", "index.md"),
    "# Setup\n\nSetup is documented in canonical Project Memory.\n",
    "utf8",
  );
  const manifest = await extractProjectMemorySections(root, "demo");
  const section = manifest.sections.find((item) => item.wiki_path === "setup/index.md" && item.section_id === "setup");
  if (!section) throw new Error("missing setup section fixture");

  const db = openMemoryDb(root);
  try {
    const available = ensureProjectMemoryRetrievalVectorTable(db, {
      dimensions: DEFAULT_SESSION_MEMORY_EMBEDDING_CONTRACT.dimensions,
      adapter: createSqliteVecAdapter(),
    });
    if (!available.available) throw new Error(`sqlite-vec unavailable in test: ${available.reason}`);
    const row = ensurePendingProjectMemoryRetrievalEmbedding(db, {
      project_key: "demo",
      wiki_path: section.wiki_path,
      section_id: section.section_id,
      section_hash: section.section_hash,
      hint_hash: null,
      contract: DEFAULT_SESSION_MEMORY_EMBEDDING_CONTRACT,
      now: "2026-06-30T10:00:00.000Z",
    });
    markProjectMemoryRetrievalEmbeddingIndexed(db, {
      id: row.id,
      normalized_text_hash: "sha256:text",
      now: "2026-06-30T10:01:00.000Z",
    });
    upsertProjectMemoryRetrievalVector(db, {
      retrieval_row_id: row.id,
      project_key: "demo",
      wiki_path: section.wiki_path,
      section_id: section.section_id,
      embedding_model: DEFAULT_SESSION_MEMORY_EMBEDDING_CONTRACT.model,
      embedding_dimensions: DEFAULT_SESSION_MEMORY_EMBEDDING_CONTRACT.dimensions,
      embedding_purpose: "retrieval_document",
      format_version: DEFAULT_SESSION_MEMORY_EMBEDDING_CONTRACT.formatVersion,
      embedding: unitVector(0),
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
