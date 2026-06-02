import { afterEach, beforeEach, expect, test } from "bun:test";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { migrateProjectLayout, migrateStageInstructions, projectLayout } from "./layout.ts";
import { readJson } from "./json.ts";
import { writeJson } from "./json.ts";

let root: string;

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "myelin-layout-"));
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

test("project layout migration preserves project memory under V2 directories", async () => {
  await writeJson(join(root, "projects", "trygga", "state", "project.json"), {
    key: "trygga",
    name: "Trygga",
  });
  await writeJson(join(root, "projects", "trygga", "state", "update-state.json"), {
    latest_run_dir: "artifacts/trygga/runs/2026-06-02T12-00-00.000Z-run",
  });
  await writeFile(join(root, "projects", "trygga", "index.md"), "# Trygga\n", "utf8");
  await writeFile(join(root, "projects", "trygga", "changelog.md"), "# Changelog\n", "utf8");
  await mkdir(join(root, "projects", "trygga", "inbox"), { recursive: true });
  await writeFile(join(root, "projects", "trygga", "inbox", "note.json"), "{}", "utf8");
  await mkdir(join(root, "artifacts", "trygga", "runs", "2026-06-02T12-00-00.000Z-run"), { recursive: true });
  await writeFile(
    join(root, "artifacts", "trygga", "runs", "2026-06-02T12-00-00.000Z-run", "proposal.json"),
    "{}",
    "utf8",
  );

  const actions = await migrateProjectLayout(root, "trygga");
  const paths = projectLayout(root, "trygga");

  expect(actions.some((action) => action.action === "updated-state")).toBe(true);
  expect(await readFile(join(paths.wiki, "index.md"), "utf8")).toBe("# Trygga\n");
  expect(await readFile(join(paths.log, "changelog.md"), "utf8")).toBe("# Changelog\n");
  expect(await readFile(join(paths.sources, "inbox", "note.json"), "utf8")).toBe("{}");
  expect(await readFile(join(paths.runs, "2026-06-02T12-00-00.000Z-run", "proposal.json"), "utf8")).toBe("{}");
  expect((await readJson<{ latest_run_dir: string }>(join(paths.state, "update-state.json"))).latest_run_dir).toBe(
    "projects/trygga/runs/2026-06-02T12-00-00.000Z-run",
  );
});

test("stage instruction migration copies global pipeline data into stages", async () => {
  await writeJson(join(root, "legacy", "agents", "update", "01-sense", "config.json"), {
    stage: "sense",
  });
  await writeFile(join(root, "legacy", "agents", "update", "01-sense", "instructions.md"), "Return JSON\n", "utf8");

  const actions = await migrateStageInstructions(root);

  expect(actions.filter((action) => action.action === "copied").length).toBe(2);
  expect(await readFile(join(root, "stages", "01-sense", "instructions.md"), "utf8")).toBe("Return JSON\n");
  expect(await readJson<{ stage: string }>(join(root, "stages", "01-sense", "config.json"))).toEqual({
    stage: "sense",
  });
});
