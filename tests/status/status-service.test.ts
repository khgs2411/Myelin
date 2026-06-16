import { afterEach, beforeEach, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { writeJson } from "../../src/runtime/json.ts";
import { StatusService } from "../../src/status/status-service.ts";

let root: string;

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "myelin-status-service-"));
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

test("StatusService builds summary and facade response from project state", async () => {
  await seedProject();
  const service = new StatusService(root);

  const summary = await service.summary({ projectKey: "demo" });
  const facade = service.toFacadeResponse(summary);
  const human = service.renderHuman(summary);

  expect(summary.project.key).toBe("demo");
  expect(summary.latest_session?.path).toBe("wiki/sessions/2026-06-02-session.md");
  expect(summary.latest_run.last_completed_stage).toBe("validate");
  expect(facade).toMatchObject({
    answer: expect.stringContaining("Project demo"),
    memory_scope: "project",
    degraded: false,
    source_tools: ["project-state"],
  });
  expect(human).toContain("key: demo");
  expect(human).toContain("status: stale");
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
