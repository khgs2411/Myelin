import { afterEach, beforeEach, expect, test } from "bun:test";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ProjectService } from "../../src/project/project-service.ts";
import { writeJson } from "../../src/runtime/json.ts";

let root: string;

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "myelin-project-service-"));
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

test("project service owns layout migration workflow", async () => {
  await mkdir(join(root, "projects", "demo"), { recursive: true });
  await writeFile(join(root, "projects", "demo", "index.md"), "# Demo\n", "utf8");
  const service = new ProjectService(root);

  const result = await service.migrateLayout("demo");

  expect(result.projectActions.length).toBeGreaterThan(0);
  expect(await readFile(join(root, "projects", "demo", "wiki", "index.md"), "utf8")).toBe("# Demo\n");
});

test("project service lists active projects unless legacy projects are requested", async () => {
  await writeJson(join(root, "projects", "active", "state", "project.json"), {
    key: "active",
    name: "Active",
    repo_paths: [join(root, "repos", "active")],
  });
  await writeJson(join(root, "projects", "old-v1", "state", "project.json"), {
    key: "old-v1",
    name: "Old V1",
    lifecycle: "legacy",
    repo_paths: [join(root, "repos", "old-v1")],
  });

  const service = new ProjectService(root);

  expect((await service.listProjects()).projects.map((project) => project.key)).toEqual(["active"]);
  expect((await service.listProjects({ includeLegacy: true })).projects.map((project) => project.key)).toEqual([
    "active",
    "old-v1",
  ]);
});

test("project service exposes the project learn curator facade without changing pipeline routing", async () => {
  await seedCuratorProject();
  await seedSchema();
  const service = new ProjectService(root);

  const result = await service.runProjectLearn({
    projectKey: "demo",
    dryRun: false,
    review: false,
    now: new Date("2026-06-23T10:00:00.000Z"),
    runner: async () => ({
      exitCode: 0,
      stdout: JSON.stringify({
        schema_version: 1,
        project_key: "demo",
        mode: "create",
        packet_ref: {
          run_dir: "projects/demo/runs/project-learn/2026-06-23T10-00-00.000Z-run",
          artifact: "input-packet.json",
          packet_schema_version: 1,
        },
        packet_context: { degraded: false, degraded_reasons: [], budgets: { max_items: 25, max_content_chars: 4_000 } },
        summary: "Initial brain draft",
        brain_intent: {
          name: "Demo",
          first_brain_summary: "Create first brain",
          untrusted_existing_markdown_policy: "adopt",
        },
        pages: [
          {
            id: "page_index",
            target: { path: "index.md", path_kind: "new_wiki_page" },
            title: "Demo",
            purpose: "Index",
            content_intent: "Create index",
            required_sections: ["Overview"],
            evidence_refs: [{ kind: "project_state", ref: "bootstrap_state" }],
            repo_citations: [],
            notes_for_apply: [],
          },
        ],
        state_intent: { mark_project_memory_curated: true, freshness_intent: "initialize" },
        evidence_refs: [{ kind: "project_state", ref: "bootstrap_state" }],
        repo_citations: [],
        risk: { level: "low", reasons: [], requires_quarantine: false },
      }),
      stderr: "",
    }),
  });

  expect(result.status).toBe("completed");
  expect(result.artifacts.curator_output).toBe("curator-creation-draft.json");
});

async function seedCuratorProject(): Promise<void> {
  await writeJson(join(root, "projects", "demo", "state", "project.json"), {
    key: "demo",
    name: "Demo",
    repo_paths: [join(root, "repos", "demo")],
  });
  await writeJson(join(root, "projects", "demo", "state", "bootstrap-state.json"), { status: "uncurated" });
  await mkdir(join(root, "projects", "demo", "wiki"), { recursive: true });
  await writeFile(join(root, "projects", "demo", "wiki", "index.md"), "# Demo\n", "utf8");
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
