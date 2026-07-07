import { describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";
import {
  promoteDraftWiki,
  type ProjectMemoryDraftPromotionInput,
} from "../../src/project/project-memory-draft-promotion.ts";

describe("promoteDraftWiki", () => {
  test("promotes draft markdown and v2 state through the apply journal", async () => {
    const root = await mkdtemp(join(tmpdir(), "myelin-draft-promotion-"));
    const runDir = join(root, "projects", "demo", "runs", "project-learn", "run-1");
    const draftWiki = join(runDir, "agents", "create", "draft-wiki");
    await mkdir(draftWiki, { recursive: true });
    await writeFile(join(draftWiki, "index.md"), "# Demo\n\n- [Runtime](runtime.md)\n", "utf8");
    await writeFile(join(draftWiki, "runtime.md"), "# Runtime\n\nHow the runtime works.\n", "utf8");

    const result = await promoteDraftWiki(validInput(root, runDir, draftWiki));

    expect(result.status).toBe("applied");
    expect(await readFile(join(root, "projects", "demo", "wiki", "index.md"), "utf8")).toContain("# Demo");
    const state = JSON.parse(await readFile(join(root, "projects", "demo", "state", "project-memory.json"), "utf8"));
    expect(state.schema_version).toBe(2);
    expect(state.content_quality.status).toBe("not_evaluated");
    expect(await readFile(join(runDir, "project-memory-apply-result.json"), "utf8")).toContain('"status": "applied"');
    expect(await readFile(join(runDir, "project-memory-changeset.json"), "utf8")).toContain('"schema_version": 1');
  });

  test("rejects a draft without index markdown", async () => {
    const root = await mkdtemp(join(tmpdir(), "myelin-draft-promotion-"));
    const runDir = join(root, "projects", "demo", "runs", "project-learn", "run-2");
    const draftWiki = join(runDir, "agents", "create", "draft-wiki");
    await mkdir(draftWiki, { recursive: true });
    await writeFile(join(draftWiki, "runtime.md"), "# Runtime\n", "utf8");

    await expect(promoteDraftWiki(validInput(root, runDir, draftWiki))).rejects.toThrow("draft wiki must include index.md");
  });

  test("promotes nested markdown paths inside the draft wiki", async () => {
    const root = await mkdtemp(join(tmpdir(), "myelin-draft-promotion-"));
    const runDir = join(root, "projects", "demo", "runs", "project-learn", "run-3");
    const draftWiki = join(runDir, "agents", "create", "draft-wiki");
    await mkdir(join(draftWiki, "nested"), { recursive: true });
    await writeFile(join(draftWiki, "index.md"), "# Demo\n", "utf8");
    await writeFile(join(draftWiki, "nested", "topic.md"), "# Topic\n", "utf8");

    const result = await promoteDraftWiki(validInput(root, runDir, draftWiki));
    expect(result.changed_files.map((file) => file.path)).toContain("projects/demo/wiki/nested/topic.md");
  });

  test("create mode removes stale canonical wiki markdown absent from the draft", async () => {
    const root = await mkdtemp(join(tmpdir(), "myelin-draft-promotion-"));
    const runDir = join(root, "projects", "demo", "runs", "project-learn", "run-4");
    const draftWiki = join(runDir, "agents", "create", "draft-wiki");
    await mkdir(draftWiki, { recursive: true });
    await mkdir(join(root, "projects", "demo", "wiki"), { recursive: true });
    await writeFile(join(root, "projects", "demo", "wiki", "old.md"), "# Old\n", "utf8");
    await writeFile(join(draftWiki, "index.md"), "# Demo\n", "utf8");

    await promoteDraftWiki(validInput(root, runDir, draftWiki));

    expect(await Bun.file(join(root, "projects", "demo", "wiki", "old.md")).exists()).toBe(false);
  });
});

function validInput(root: string, runDir: string, draftWiki: string): ProjectMemoryDraftPromotionInput {
  return {
    root,
    projectKey: "demo",
    runDir: relative(root, runDir),
    absoluteRunDir: runDir,
    mode: "create",
    draftWikiDir: draftWiki,
    curatorOutputRef: "documentation-create-result.json",
    state: {
      schema_version: 2,
      project_key: "demo",
      status: "curated",
      source_run_dir: relative(root, runDir),
      updated_at: "2026-07-06T00:00:00.000Z",
      provider_mode: "stub",
      curation_kind: "agent_authored",
      run_kind: "create",
      create: {
        status: "completed",
        planner_status: "completed",
        subject_writer_status: "completed",
        subject_count: 0,
        subject_writer_concurrency_limit: 4,
        subject_writer_retry_limit: 1,
        subject_report_refs: [],
      },
      retrieval_readiness: { status: "pending", checked_at: "2026-07-06T00:00:00.000Z" },
      content_quality: {
        status: "not_evaluated",
        reason: "agent_authored_documentation_has_no_schema_quality_gate",
      },
    },
    sourceConsumptions: [],
  };
}
