import { afterEach, beforeEach, expect, test } from "bun:test";
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  createProjectCuratorRun,
  ensureProjectLearnSchemaContext,
  invokeProjectCurator,
  writeMarkdownArtifact,
  writeRunArtifact,
} from "../../src/runtime/project-run-infrastructure.ts";
import { writeJson } from "../../src/runtime/json.ts";

let root: string;

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "myelin-curator-runtime-"));
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

test("creates project-learn run paths and writes stable artifacts", async () => {
  await seedProject();
  const run = await createProjectCuratorRun(root, "demo", new Date("2026-06-23T10:00:00.000Z"));

  expect(run.run_id).toBe("2026-06-23T10-00-00.000Z-run");
  expect(run.relative_run_dir).toBe("runs/demo/project-learn/2026-06-23T10-00-00.000Z-run");
  expect(run.absolute_run_dir).toBe(join(root, run.relative_run_dir));

  await writeRunArtifact(run, "input-packet.json", { b: 2, a: 1 });

  expect(await readFile(join(run.absolute_run_dir, "input-packet.json"), "utf8")).toBe("{\n  \"a\": 1,\n  \"b\": 2\n}\n");
});

test("writes generic markdown artifacts without owning product semantics", async () => {
  await seedProject();
  const run = await createProjectCuratorRun(root, "demo", new Date("2026-06-23T10:00:00.000Z"));

  await writeMarkdownArtifact(run, "summary.md", ["# Summary", "", "Product-specific text is composed by the caller."].join("\n"));

  const summary = await readFile(join(run.absolute_run_dir, "summary.md"), "utf8");
  expect(summary).toBe("# Summary\n\nProduct-specific text is composed by the caller.\n");
});

test("rejects artifact paths that escape the run directory", async () => {
  await seedProject();
  const run = await createProjectCuratorRun(root, "demo", new Date("2026-06-23T10:00:00.000Z"));

  await expect(writeRunArtifact(run, "../escaped.json", { escaped: true })).rejects.toThrow("Path escapes repository root");
  await expect(writeMarkdownArtifact(run, "../escaped.md", "escaped")).rejects.toThrow("Path escapes repository root");
  await expect(stat(join(run.absolute_run_dir, "..", "escaped.json"))).rejects.toThrow();
  await expect(stat(join(run.absolute_run_dir, "..", "escaped.md"))).rejects.toThrow();
});

test("ensures schema context using learn semantics", async () => {
  await seedProject();
  await seedSchema();

  const schema = await ensureProjectLearnSchemaContext(root, "demo", {
    dryRun: false,
    now: new Date("2026-06-23T10:00:00.000Z"),
  });

  expect(schema.hash).toHaveLength(64);
  expect(schema.wrote).toBe(true);
  expect(await Bun.file(join(root, "state", "demo", "schema-context.json")).exists()).toBe(true);
});

test("invokes curator through pipeline workload without importing the old runner", async () => {
  await seedProject();
  await writeFile(join(root, "myelin.config"), "DEFAULT_PROVIDER=codex\nPIPELINE_CODEX_MODEL=gpt-curator\n", "utf8");
  const captured: { command?: string[]; stdin?: string } = {};

  const result = await invokeProjectCurator({
    root,
    prompt: "Return JSON",
    stageId: "curator-maintain",
    outputSchema: "/tmp/curator-output-contract.json",
    runner: async (command, options) => {
      captured.command = command;
      captured.stdin = options?.stdin;
      return { exitCode: 0, stdout: "{\"ok\":true}", stderr: "" };
    },
  });

  expect(result.response).toEqual({ ok: true });
  expect(captured.command).toContain("--sandbox");
  expect(captured.command).toContain("read-only");
  expect(captured.command).toContain("--output-schema");
  expect(captured.command).toContain("/tmp/curator-output-contract.json");
  expect(captured.command).toContain("--model");
  expect(captured.command).toContain("gpt-curator");
  expect(captured.stdin).toBe("Return JSON");
});

async function seedProject(): Promise<void> {
  await writeJson(join(root, "state", "demo", "project.json"), {
    key: "demo",
    name: "Demo",
    repo_paths: [join(root, "repos", "demo")],
  });
}

async function seedSchema(): Promise<void> {
  await mkdir(join(root, "schema", "rules"), { recursive: true });
  await writeFile(join(root, "schema", "global.md"), "Project schema\n", "utf8");
  await writeJson(join(root, "schema", "rules", "source-classification.json"), {
    rule: "source-classification",
    description: "Source classification.",
    required_fields: ["source_kind"],
    source_kind: ["handoff"],
    ownership: ["project"],
    action: ["update-existing-pages"],
  });
  await writeJson(join(root, "schema", "rules", "memory-scopes.json"), {
    rule: "memory-scopes",
    description: "Memory scopes.",
    scopes: [
      { key: "project", summary: "Project memory." },
      { key: "practice", summary: "Practice memory." },
    ],
    phase_0_active: ["project"],
    phase_0_deferred: ["practice"],
  });
  await writeJson(join(root, "schema", "rules", "page-taxonomy.json"), {
    rule: "page-taxonomy",
    description: "Page taxonomy.",
    categories: [{ key: "setup", summary: "Setup." }],
  });
}
