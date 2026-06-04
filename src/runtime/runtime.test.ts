import { afterEach, beforeEach, expect, test } from "bun:test";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { createRunDir, runDir, timestampRunId } from "./artifacts.ts";
import { loadConfig, selectModelProfile } from "./config.ts";
import { resolveInside } from "./fs.ts";
import { readJsonIfExists, stableJson, writeJson } from "./json.ts";
import { discoverProjects, findProject, projectForRepoPath } from "./projects.ts";
import { runProcess, runProcessChecked } from "./process.ts";
import { readProjectState, statePath, writeProjectState } from "./state.ts";

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

test("project discovery reads project registry state and resolves cwd ownership", async () => {
  const repo = join(root, "repos", "demo");
  await mkdir(join(root, "projects"), { recursive: true });
  await writeFile(join(root, "projects", ".DS_Store"), "finder metadata", "utf8");
  await writeJson(join(root, "projects", "demo", "state", "project.json"), {
    key: "demo",
    name: "Demo",
    repo_paths: [repo],
  });
  await writeJson(join(root, "projects", "ignored", "state", "other.json"), { key: "ignored" });

  const projects = await discoverProjects(root);

  expect(projects.map((project) => project.key)).toEqual(["demo"]);
  expect((await findProject(root, "demo")).config.name).toBe("Demo");
  expect((await projectForRepoPath(root, join(repo, "src")))?.key).toBe("demo");
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
  expect(() => runDir(root, "demo", "../bad")).toThrow("Invalid run id");
});

test("subprocess helper captures stdout, stderr, exit code, and checked failure", async () => {
  const ok = await runProcess(["bun", "-e", "console.log('out'); console.error('err')"]);

  expect(ok.exitCode).toBe(0);
  expect(ok.stdout.trim()).toBe("out");
  expect(ok.stderr.trim()).toBe("err");
  expect((await runProcessChecked(["bun", "-e", "console.log('checked')"])).trim()).toBe("checked");
  await expect(runProcessChecked(["bun", "-e", "process.exit(7)"])).rejects.toThrow("Command failed (7)");
});
