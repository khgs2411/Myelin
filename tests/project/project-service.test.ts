import { afterEach, beforeEach, expect, test } from "bun:test";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openMemoryDb } from "../../src/memory/db.ts";
import { ProjectService } from "../../src/project/project-service.ts";
import { FILE_AUTHORING_STUB_OUTPUTS_DIR } from "../../src/runtime/file-authoring-agent.ts";
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

test("project service exposes agent-authored project learn", async () => {
  await seedProject();
  seedMemoryDb();
  await seedSchema();
  const stubs = await seedCreateStubs();
  const service = new ProjectService(root);

  const result = await service.runProjectLearn({
    projectKey: "demo",
    dryRun: false,
    review: false,
    now: new Date("2026-07-06T10:00:00.000Z"),
    env: { ...process.env, [FILE_AUTHORING_STUB_OUTPUTS_DIR]: stubs },
    runner: hintRunner("demo"),
  });

  expect(result.status).toBe("completed");
  expect(result.run_kind).toBe("create_then_maintenance");
  expect(result.artifacts.curator_output).toBe("documentation-maintenance-result.json");
  expect(result.artifacts.subject_manifest).toBe("reports/documentation-subject-manifest.json");
  expect(result.artifacts.retrieval_index_result).toBe("project-memory-retrieval-index-result.json");
  expect(result.stopped_before_writes).toBe(false);
  expect(await readFile(join(root, "projects", "demo", "wiki", "runtime.md"), "utf8")).toContain("Runtime documentation");
});

async function seedProject(): Promise<void> {
  const repoPath = join(root, "repos", "demo");
  await writeJson(join(root, "projects", "demo", "state", "project.json"), {
    key: "demo",
    name: "Demo",
    repo_paths: [repoPath],
  });
  await writeJson(join(root, "projects", "demo", "state", "bootstrap-state.json"), { status: "uncurated" });
  await mkdir(join(root, "projects", "demo", "wiki"), { recursive: true });
  await mkdir(join(repoPath, "src"), { recursive: true });
  await writeFile(join(repoPath, "README.md"), "# Demo\n", "utf8");
  await writeFile(join(repoPath, "src", "runtime.ts"), "export const runtime = true;\n", "utf8");
}

async function seedCreateStubs(): Promise<string> {
  const stubs = await mkdtemp(join(tmpdir(), "myelin-project-service-stubs-"));
  await mkdir(join(stubs, "create-planner", "draft-wiki"), { recursive: true });
  await mkdir(join(stubs, "create-planner", "reports"), { recursive: true });
  await writeFile(join(stubs, "create-planner", "draft-wiki", "index.md"), "# Demo\n\nIndex.\n", "utf8");
  await writeFile(join(stubs, "create-planner", "draft-wiki", "runtime.md"), "# Runtime\n\n", "utf8");
  await writeJson(join(stubs, "create-planner", "reports", "documentation-subject-manifest.json"), {
    schema_version: 1,
    project_key: "demo",
    subjects: [{
      subject_id: "runtime",
      wiki_path: "runtime.md",
      title: "Runtime",
      purpose: "Runtime documentation.",
      suggested_repo_paths: ["src/runtime.ts"],
    }],
  });
  await writeJson(join(stubs, "create-planner", "reports", "documentation-planner-report.json"), {
    schema_version: 1,
    project_key: "demo",
    evidence_paths: ["README.md"],
    surface_coverage: createStubSurfaceCoverage(),
    known_gaps: [],
  });
  await mkdir(join(stubs, "subject-runtime", "draft-wiki"), { recursive: true });
  await mkdir(join(stubs, "subject-runtime", "reports"), { recursive: true });
  await writeFile(join(stubs, "subject-runtime", "draft-wiki", "runtime.md"), "# Runtime\n\nRuntime documentation.\n", "utf8");
  await writeJson(join(stubs, "subject-runtime", "reports", "subject-report.json"), {
    schema_version: 1,
    project_key: "demo",
    subject_id: "runtime",
    wiki_path: "runtime.md",
    status: "completed",
    evidence_paths: ["src/runtime.ts"],
    touched_paths: ["runtime.md"],
    known_gaps: [],
  });
  await mkdir(join(stubs, "create-index-finalizer", "finalized-index"), { recursive: true });
  await writeFile(
    join(stubs, "create-index-finalizer", "finalized-index", "index.md"),
    "# Demo\n\n## Canonical subjects\n\n- [Runtime](runtime.md)\n",
    "utf8",
  );
  return stubs;
}

function createStubSurfaceCoverage() {
  return [
    {
      surface_id: "runtime",
      kind: "public_interface",
      status: "covered",
      summary: "Runtime interface.",
      evidence_paths: ["src/runtime.ts"],
      subject_ids: ["runtime"],
    },
    ...["operator_workflow", "administrative_surface", "destructive_or_irreversible_operation"].map((kind) => ({
      surface_id: `absent-${kind}`,
      kind,
      status: "not_present",
      summary: `No ${kind} is present.`,
      evidence_paths: ["README.md"],
      subject_ids: [],
    })),
  ];
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
    categories: [{ key: "runtime", summary: "Runtime." }],
  });
}

function seedMemoryDb(): void {
  const db = openMemoryDb(root);
  db.close();
}

function hintRunner(projectKey: string) {
  return async (_command: string[], options?: { stdin?: string }) => {
    if (!options?.stdin?.includes("Project Memory retrieval hint generator")) {
      return { exitCode: 0, stdout: "{}", stderr: "" };
    }
    const prompt = options.stdin;
    const payload = JSON.parse(prompt.slice(prompt.indexOf("{")));
    return {
      exitCode: 0,
      stdout: JSON.stringify({
        schema_version: 1,
        project_key: projectKey,
        category: null,
        entries: payload.sections.map((section: { wiki_path: string; section_id: string; section_hash: string; heading_path: string[] }) => ({
          wiki_path: section.wiki_path,
          section_id: section.section_id,
          section_hash: section.section_hash,
          keywords: section.heading_path,
          aliases: [],
          topics: ["project-memory"],
          query_phrases: [`How does ${section.heading_path.join(" ")} work?`],
          confidence: "high",
        })),
      }),
      stderr: "",
    };
  };
}
