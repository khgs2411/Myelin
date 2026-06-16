import { afterEach, beforeEach, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createCli } from "../../src/commands/registry.ts";
import { registerStatusCommand } from "../../src/commands/status.ts";
import { writeJson } from "../../src/runtime/json.ts";

let root: string;
let previousCwd: string;

beforeEach(async () => {
  previousCwd = process.cwd();
  root = await mkdtemp(join(tmpdir(), "myelin-status-"));
  process.chdir(root);
});

afterEach(async () => {
  process.chdir(previousCwd);
  await rm(root, { recursive: true, force: true });
});

test("status reads project, latest session, and stale state deterministically", async () => {
  await seedProject();
  const cli = createCli("myelin");
  registerStatusCommand(cli);

  const result = await cli.run(["status", "demo"]);

  expect(result.exitCode).toBe(0);
  expect(result.message).toContain("key: demo");
  expect(result.message).toContain("name: Demo");
  expect(result.message).toContain("wiki/sessions/2026-06-02-session.md");
  expect(result.message).toContain("status: stale");
  expect(result.message).toContain("changed paths: 1");
  expect(result.message).toContain("impacted pages: 1");
  expect(result.message).toContain("stage: validate");
});

test("--json emits the facade response contract", async () => {
  await seedProject();
  const cli = createCli("myelin");
  registerStatusCommand(cli);

  const result = await cli.run(["status", "demo", "--json"]);
  const response = JSON.parse(result.message);

  expect(result.exitCode).toBe(0);
  expect(Object.keys(response).sort()).toEqual([
    "answer",
    "candidate_ids",
    "citations",
    "confidence",
    "degraded",
    "degraded_reason",
    "memory_scope",
    "source_tools",
  ]);
  expect(response.answer).toContain("Project demo");
  expect(response.answer).toContain("latest session wiki/sessions/2026-06-02-session.md");
  expect(response.memory_scope).toBe("project");
  expect(response.degraded).toBe(false);
  expect(response.source_tools).toEqual(["project-state"]);
});

async function seedProject(): Promise<void> {
  await writeJson(join(root, "projects", "demo", "state", "project.json"), {
    key: "demo",
    name: "Demo",
    repo_paths: [join(root, "repos", "demo")],
  });
  await writeJson(join(root, "projects", "demo", "state", "freshness.json"), {
    status: "stale",
    changed_paths: ["src/app.ts"],
    impacted_pages: ["wiki/modules/app.md"],
    updated_at: "2026-06-02T14:00:00.000Z",
  });
  await writeJson(join(root, "projects", "demo", "state", "update-state.json"), {
    project: "demo",
    latest_run_dir: "artifacts/demo/runs/2026-06-02T14-00-00.000Z-run",
    last_completed_stage: "validate",
    stages: {
      validate: { status: "completed", last_completed_at: "2026-06-02T14:05:00.000Z" },
    },
  });
  await mkdir(join(root, "projects", "demo", "wiki", "sessions"), { recursive: true });
  await writeFile(join(root, "projects", "demo", "wiki", "sessions", "2026-06-01-session.md"), "# Old\n", "utf8");
  await writeFile(join(root, "projects", "demo", "wiki", "sessions", "2026-06-02-session.md"), "# New\n", "utf8");
}
