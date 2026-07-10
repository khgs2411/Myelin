import { afterEach, beforeEach, expect, test } from "bun:test";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { createRunDir, runDir, timestampRunId } from "../../src/runtime/artifacts.ts";
import { loadConfig, selectEmbeddingContract, selectModelProfile } from "../../src/runtime/config.ts";
import { resolveInside } from "../../src/runtime/fs.ts";
import { readJsonIfExists, stableJson, writeJson } from "../../src/runtime/json.ts";
import { discoverProjects, findProject, projectForRepoPath } from "../../src/runtime/projects.ts";
import { runProcess, runProcessChecked } from "../../src/runtime/process.ts";
import { readProjectState, statePath, writeProjectState } from "../../src/runtime/state.ts";

let root: string;

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "myelin-runtime-"));
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

test("safe path resolution rejects traversal outside the repository", () => {
  expect(resolveInside(root, "projects", "demo")).toBe(resolve(root, "projects", "demo"));
  expect(() => resolveInside(root, "..", "outside")).toThrow("escapes repository root");
});

test("JSON writes are deterministic so generated state is reviewable", async () => {
  const path = join(root, "state", "sample.json");

  await writeJson(path, { z: 1, a: { c: 3, b: 2 } });

  expect(await readFile(path, "utf8")).toBe('{\n  "a": {\n    "b": 2,\n    "c": 3\n  },\n  "z": 1\n}\n');
  expect(stableJson({ b: 2, a: 1 })).toBe('{\n  "a": 1,\n  "b": 2\n}');
});

test("missing JSON can be handled explicitly without hiding invalid JSON", async () => {
  expect(await readJsonIfExists(join(root, "missing.json"))).toBeNull();

  const invalid = join(root, "invalid.json");
  await writeFile(invalid, "{", "utf8");

  await expect(readJsonIfExists(invalid)).rejects.toThrow("Invalid JSON");
});

test("config loads myelin.config and honors environment precedence", async () => {
  await writeFile(
    join(root, "myelin.config"),
    [
      "DEFAULT_PROVIDER=codex",
      "PIPELINE_CODEX_MODEL=file-pipeline",
      "PIPELINE_CODEX_REASONING_EFFORT=medium",
      "QUERY_CLAUDE_MODEL=file-query",
    ].join("\n"),
    "utf8",
  );

  const config = await loadConfig(root, {
    DEFAULT_PROVIDER: "claude",
    PIPELINE_CLAUDE_MODEL: "env-pipeline",
  });

  expect(config.defaultProvider).toBe("claude");
  expect(selectModelProfile(config, "pipeline")).toEqual({ provider: "claude", model: "env-pipeline" });
  expect(selectModelProfile(config, "pipeline", "codex")).toEqual({
    provider: "codex",
    model: "file-pipeline",
    reasoningEffort: "medium",
  });
});

test("config exposes default embedding contract", async () => {
  const config = await loadConfig(root, {});

  expect(config.ingest).toMatchObject({
    batchSize: 100,
    workerConcurrency: 1,
    workerStartDelayMs: 750,
    llmTimeoutMs: 600000,
    promptCharLimit: 180000,
  });
  expect(config.embedding).toEqual({
    provider: "auto",
    geminiModel: "gemini-embedding-2",
    ollamaModel: "qwen3-embedding:4b",
    ollamaUrl: "http://localhost:11434",
    dimensions: 1536,
    batchSize: 50,
    stubResponsesDir: undefined,
  });
  expect(selectEmbeddingContract(config, "ollama", "retrieval_document")).toEqual({
    provider: "ollama",
    model: "qwen3-embedding:4b",
    dimensions: 1536,
    purpose: "retrieval_document",
    formatVersion: 1,
  });
  expect(selectEmbeddingContract(config, "gemini", "retrieval_document")).toEqual({
    provider: "gemini",
    model: "gemini-embedding-2",
    dimensions: 1536,
    purpose: "retrieval_document",
    formatVersion: 1,
  });
});

test("ingest config honors file values and rejects oversized batches", async () => {
  await writeFile(join(root, "myelin.config"), "INGEST_BATCH_SIZE=200\n", "utf8");
  await expect(loadConfig(root, {})).resolves.toMatchObject({ ingest: { batchSize: 200 } });

  await expect(loadConfig(root, { INGEST_BATCH_SIZE: "501" })).rejects.toThrow("Invalid ingest batch size");
  await expect(loadConfig(root, { INGEST_BATCH_SIZE: "0" })).rejects.toThrow("Invalid ingest batch size");
});

test("loadConfig parses named ingest runtime profile", async () => {
  await writeFile(
    join(root, "myelin.config"),
    [
      "DEFAULT_PROVIDER=codex",
      "INGEST_BATCH_SIZE=25",
      "INGEST_WORKER_CONCURRENCY=2",
      "INGEST_WORKER_START_DELAY_MS=500",
      "INGEST_LLM_TIMEOUT_MS=120000",
      "INGEST_PROMPT_CHAR_LIMIT=150000",
      "INGEST_CODEX_MODEL=gpt-ingest",
      "INGEST_CODEX_REASONING_EFFORT=medium",
    ].join("\n"),
    "utf8",
  );

  await expect(loadConfig(root, {})).resolves.toMatchObject({
    ingest: {
      batchSize: 25,
      workerConcurrency: 2,
      workerStartDelayMs: 500,
      llmTimeoutMs: 120000,
      promptCharLimit: 150000,
      profiles: {
        codex: { provider: "codex", model: "gpt-ingest", reasoningEffort: "medium" },
      },
    },
  });
});

test("loadConfig validates ingest runtime profile bounds", async () => {
  await expect(loadConfig(root, { INGEST_WORKER_CONCURRENCY: "0" })).rejects.toThrow("Invalid ingest worker concurrency");
  await expect(loadConfig(root, { INGEST_WORKER_START_DELAY_MS: "-1" })).rejects.toThrow("Invalid ingest worker start delay");
  await expect(loadConfig(root, { INGEST_LLM_TIMEOUT_MS: "0" })).rejects.toThrow("Invalid ingest LLM timeout");
  await expect(loadConfig(root, { INGEST_PROMPT_CHAR_LIMIT: "not-a-number" })).rejects.toThrow("Invalid ingest prompt char limit");
});

test("auto memory maintenance config is explicit and bounded", async () => {
  await expect(loadConfig(root, {})).resolves.toMatchObject({
    autoMemoryMaintenance: {
      enabled: false,
      minCapturedEvents: 10,
      cooldownMs: 300000,
      drainPollIntervalMs: 5000,
      drainTimeoutMs: 600000,
      indexLimit: 500,
    },
  });

  await expect(
    loadConfig(root, {
      AUTO_MEMORY_MAINTENANCE: "1",
      AUTO_MEMORY_MIN_CAPTURED_EVENTS: "3",
      AUTO_MEMORY_COOLDOWN_MS: "0",
      AUTO_MEMORY_DRAIN_POLL_INTERVAL_MS: "100",
      AUTO_MEMORY_DRAIN_TIMEOUT_MS: "1000",
      AUTO_MEMORY_INDEX_LIMIT: "25",
    }),
  ).resolves.toMatchObject({
    autoMemoryMaintenance: {
      enabled: true,
      minCapturedEvents: 3,
      cooldownMs: 0,
      drainPollIntervalMs: 100,
      drainTimeoutMs: 1000,
      indexLimit: 25,
    },
  });

  await expect(loadConfig(root, { AUTO_MEMORY_MIN_CAPTURED_EVENTS: "0" })).rejects.toThrow(
    "Invalid auto memory min captured events",
  );
  await expect(loadConfig(root, { AUTO_MEMORY_COOLDOWN_MS: "-1" })).rejects.toThrow("Invalid auto memory cooldown");
});

test("auto project memory maintenance config is explicit and bounded", async () => {
  await expect(loadConfig(root, {})).resolves.toMatchObject({
    autoProjectMemoryMaintenance: {
      enabled: false,
      minPendingItems: 5,
      cooldownMs: 300000,
    },
  });

  await expect(
    loadConfig(root, {
      AUTO_PROJECT_MEMORY_MAINTENANCE: "1",
      AUTO_PROJECT_MEMORY_MIN_PENDING_ITEMS: "7",
      AUTO_PROJECT_MEMORY_COOLDOWN_MS: "0",
    }),
  ).resolves.toMatchObject({
    autoProjectMemoryMaintenance: {
      enabled: true,
      minPendingItems: 7,
      cooldownMs: 0,
    },
  });

  await expect(loadConfig(root, { AUTO_PROJECT_MEMORY_MIN_PENDING_ITEMS: "0" })).rejects.toThrow(
    "Invalid auto project memory min pending items",
  );
  await expect(loadConfig(root, { AUTO_PROJECT_MEMORY_COOLDOWN_MS: "-1" })).rejects.toThrow(
    "Invalid auto project memory cooldown",
  );
});

test("embedding config honors file values and environment precedence", async () => {
  await writeFile(
    join(root, "myelin.config"),
    [
      "EMBEDDING_PROVIDER=gemini",
      "EMBEDDING_GEMINI_MODEL=file-model",
      "EMBEDDING_OLLAMA_MODEL=file-ollama-model",
      "EMBEDDING_OLLAMA_URL=http://file-host:11434/",
      "EMBEDDING_DIMENSIONS=768",
      "EMBEDDING_BATCH_SIZE=250",
      "EMBEDDING_STUB_RESPONSES_DIR=file-stubs",
    ].join("\n"),
    "utf8",
  );

  const config = await loadConfig(root, {
    EMBEDDING_GEMINI_MODEL: "env-model",
    EMBEDDING_OLLAMA_MODEL: "env-ollama-model",
    EMBEDDING_DIMENSIONS: "1536",
  });

  expect(config.embedding).toEqual({
    provider: "gemini",
    geminiModel: "env-model",
    ollamaModel: "env-ollama-model",
    ollamaUrl: "http://file-host:11434/",
    dimensions: 1536,
    batchSize: 250,
    stubResponsesDir: "file-stubs",
  });
});

test("config loads local dotenv secrets between myelin config and environment", async () => {
  await writeFile(
    join(root, "myelin.config"),
    ["GOOGLE_API_KEY=file-key", "EMBEDDING_GEMINI_MODEL=file-model"].join("\n"),
    "utf8",
  );
  await writeFile(
    join(root, ".env"),
    ["GOOGLE_API_KEY=dotenv-key", "EMBEDDING_GEMINI_MODEL=dotenv-model"].join("\n"),
    "utf8",
  );

  const dotenvConfig = await loadConfig(root, {});
  expect(dotenvConfig.values.GOOGLE_API_KEY).toBe("dotenv-key");
  expect(dotenvConfig.embedding.geminiModel).toBe("dotenv-model");

  const envConfig = await loadConfig(root, {
    GOOGLE_API_KEY: "env-key",
    EMBEDDING_GEMINI_MODEL: "env-model",
  });
  expect(envConfig.values.GOOGLE_API_KEY).toBe("env-key");
  expect(envConfig.embedding.geminiModel).toBe("env-model");
});

test("embedding config rejects unsupported providers and invalid dimensions", async () => {
  await expect(loadConfig(root, { EMBEDDING_PROVIDER: "openai" })).rejects.toThrow(
    "Unsupported embedding provider: openai",
  );
  await expect(loadConfig(root, { EMBEDDING_DIMENSIONS: "zero" })).rejects.toThrow(
    "Invalid embedding dimensions: zero",
  );
  await expect(loadConfig(root, { EMBEDDING_BATCH_SIZE: "501" })).rejects.toThrow("Invalid embedding batch size");
});

test("project discovery reads project registry state and resolves cwd ownership", async () => {
  const repo = join(root, "repos", "demo");
  await mkdir(join(root, "projects"), { recursive: true });
  await writeFile(join(root, "projects", ".DS_Store"), "finder metadata", "utf8");
  await writeJson(join(root, "projects", "demo", "state", "project.json"), {
    key: "demo",
    name: "Demo",
    repo_paths: [repo],
  });
  await writeJson(join(root, "projects", "old-v1", "state", "project.json"), {
    key: "old-v1",
    name: "Old V1",
    lifecycle: "legacy",
    repo_paths: [join(root, "repos", "old-v1")],
  });
  await writeJson(join(root, "projects", "ignored", "state", "other.json"), { key: "ignored" });

  const projects = await discoverProjects(root);

  expect(projects.map((project) => project.key)).toEqual(["demo"]);
  expect((await discoverProjects(root, { includeLegacy: true })).map((project) => project.key)).toEqual([
    "demo",
    "old-v1",
  ]);
  expect((await findProject(root, "demo")).config.name).toBe("Demo");
  await expect(findProject(root, "old-v1")).rejects.toThrow("Unknown project");
  expect((await findProject(root, "old-v1", { includeLegacy: true })).config.lifecycle).toBe("legacy");
  expect((await projectForRepoPath(root, join(repo, "src")))?.key).toBe("demo");
  expect(await projectForRepoPath(root, join(root, "repos", "old-v1", "src"))).toBeNull();
  expect((await projectForRepoPath(root, join(root, "repos", "old-v1", "src"), { includeLegacy: true }))?.key).toBe(
    "old-v1",
  );
  await expect(findProject(root, "missing")).rejects.toThrow("Unknown project");
});

test("project state helpers constrain writes to state JSON files", async () => {
  await writeProjectState(root, "demo", "freshness.json", { stale: false });

  expect(statePath(root, "demo", "freshness.json")).toBe(join(root, "projects", "demo", "state", "freshness.json"));
  expect(await readProjectState<{ stale: boolean }>(root, "demo", "freshness.json")).toEqual({ stale: false });
  expect(() => statePath(root, "demo", "../escape.json")).toThrow();
  expect(() => statePath(root, "demo", "freshness.txt")).toThrow("State file must be JSON");
});

test("artifact paths are deterministic and reject unsafe run ids", async () => {
  const id = timestampRunId(new Date("2026-06-02T12:34:56.000Z"));

  expect(id).toBe("2026-06-02T12-34-56.000Z-run");
  expect(runDir(root, "demo", id)).toBe(join(root, "projects", "demo", "runs", id));
  expect(await createRunDir(root, "demo", id)).toBe(join(root, "projects", "demo", "runs", id));
  expect(await Bun.file(join(root, "projects", "demo", "runs", "index.md")).exists()).toBe(false);
  expect(await Bun.file(join(root, "projects", "demo", "runs", id, "index.md")).exists()).toBe(false);
  expect(runDir(root, "demo", id, "project-learn")).toBe(
    join(root, "projects", "demo", "runs", "project-learn", id),
  );
  expect(await createRunDir(root, "demo", id, "project-learn")).toBe(
    join(root, "projects", "demo", "runs", "project-learn", id),
  );
  expect(await Bun.file(join(root, "projects", "demo", "runs", "project-learn", "index.md")).exists()).toBe(false);
  expect(await Bun.file(join(root, "projects", "demo", "runs", "project-learn", id, "index.md")).exists()).toBe(false);
  expect(() => runDir(root, "demo", "../bad")).toThrow("Invalid run id");
  expect(() => runDir(root, "demo", id, "../bad")).toThrow("Invalid run command");
});

test("subprocess helper captures stdout, stderr, exit code, and checked failure", async () => {
  const ok = await runProcess(["bun", "-e", "console.log('out'); console.error('err')"]);

  expect(ok.exitCode).toBe(0);
  expect(ok.stdout.trim()).toBe("out");
  expect(ok.stderr.trim()).toBe("err");
  expect((await runProcessChecked(["bun", "-e", "console.log('checked')"])).trim()).toBe("checked");
  await expect(runProcessChecked(["bun", "-e", "process.exit(7)"])).rejects.toThrow("Command failed (7)");
});

test("subprocess helper times out long-running commands", async () => {
  const result = await runProcess(["bun", "-e", "setTimeout(() => {}, 1000)"], { timeoutMs: 25 });

  expect(result.exitCode).toBe(124);
  expect(result.stderr).toContain("Process timed out after 25ms");
});
