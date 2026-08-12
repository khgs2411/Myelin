import { afterEach, beforeEach, expect, test } from "bun:test";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ProjectMemoryMarkdownApplier } from "../../src/project/project-memory-markdown-applier.ts";
import { readJson, writeJson } from "../../src/runtime/json.ts";

let root: string;

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "myelin-markdown-applier-"));
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

test("promotes staged writes and records a terminal apply journal", async () => {
  await seedProject();
  const run = await seedRun("run-1");
  const applier = new ProjectMemoryMarkdownApplier(root);

  const result = await applier.promoteStagedWrites({
    project_key: "demo",
    run_dir: "runs/demo/project-learn/run-1",
    mode: "create",
    absolute_run_dir: run,
    curator_output_ref: "curator-output.json",
    staged_outputs_dir: join(run, "staged"),
    writes: [
      { canonical_project_path: "projects/demo/index.md", content: "# Demo\n", write_kind: "wiki_page" },
      { canonical_project_path: "state/demo/project-memory.json", content: "{\"status\":\"curated\"}\n", write_kind: "project_state" },
    ],
  });

  expect(result.status).toBe("applied");
  expect(await readFile(join(root, "projects/demo/index.md"), "utf8")).toBe("# Demo\n");
  const journal = await readJson<{ status: string; expected_writes: unknown[] }>(join(run, "project-memory-apply-journal.json"));
  expect(journal.status).toBe("applied");
  expect(journal.expected_writes).toHaveLength(2);
});

test("recovers an incomplete journal after apply artifacts exist", async () => {
  await seedProject();
  const run = await seedRun("run-recovery");
  const applier = new ProjectMemoryMarkdownApplier(root);

  await applier.promoteStagedWrites({
    project_key: "demo",
    run_dir: "runs/demo/project-learn/run-recovery",
    mode: "create",
    absolute_run_dir: run,
    curator_output_ref: "curator-output.json",
    staged_outputs_dir: join(run, "staged"),
    writes: [
      { canonical_project_path: "projects/demo/index.md", content: "# Demo\n", write_kind: "wiki_page" },
      { canonical_project_path: "state/demo/project-memory.json", content: "{\"status\":\"curated\"}\n", write_kind: "project_state" },
    ],
    stop_after_promotions_for_test: 1,
  });
  await writeJson(join(run, "project-memory-apply-result.json"), { status: "applied" });
  await writeJson(join(run, "project-memory-changeset.json"), { schema_version: 1 });

  const recovered = await applier.recoverFromJournal(join(run, "project-memory-apply-journal.json"));

  expect(recovered.status).toBe("applied");
  expect((await readJson<{ status: string }>(join(run, "project-memory-apply-journal.json"))).status).toBe("recovered");
});

test("recovery fails closed when canonical state drifted", async () => {
  await seedProject();
  await writeFile(join(root, "state/demo/project-memory.json"), "{\"status\":\"old\"}\n", "utf8");
  const run = await seedRun("run-drift");
  const applier = new ProjectMemoryMarkdownApplier(root);

  await applier.promoteStagedWrites({
    project_key: "demo",
    run_dir: "runs/demo/project-learn/run-drift",
    mode: "create",
    absolute_run_dir: run,
    curator_output_ref: "curator-output.json",
    staged_outputs_dir: join(run, "staged"),
    writes: [
      { canonical_project_path: "projects/demo/index.md", content: "# Demo\n", write_kind: "wiki_page" },
      { canonical_project_path: "state/demo/project-memory.json", content: "{\"status\":\"curated\"}\n", write_kind: "project_state" },
    ],
    stop_after_promotions_for_test: 1,
  });
  await writeJson(join(run, "project-memory-apply-result.json"), { status: "applied" });
  await writeJson(join(run, "project-memory-changeset.json"), { schema_version: 1 });
  await writeFile(join(root, "state/demo/project-memory.json"), "{\"status\":\"operator-change\"}\n", "utf8");

  const recovered = await applier.recoverFromJournal(join(run, "project-memory-apply-journal.json"));

  expect(recovered.status).toBe("failed");
  expect(recovered.reason).toContain("canonical file changed before promotion");
});

async function seedProject(): Promise<void> {
  await mkdir(join(root, "projects/demo"), { recursive: true });
  await mkdir(join(root, "state/demo"), { recursive: true });
  await writeFile(join(root, "projects/demo/index.md"), "# Old\n", "utf8");
}

async function seedRun(id: string): Promise<string> {
  const run = join(root, "runs/demo/project-learn", id);
  await mkdir(run, { recursive: true });
  return run;
}
