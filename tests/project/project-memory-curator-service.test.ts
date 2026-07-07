import { afterEach, beforeEach, expect, test } from "bun:test";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createMemoryCandidate, getMemoryCandidate } from "../../src/memory/candidates.ts";
import { openMemoryDb } from "../../src/memory/db.ts";
import { ProjectMemoryCuratorService } from "../../src/project/project-memory-curator-service.ts";
import { FILE_AUTHORING_STUB_OUTPUTS_DIR } from "../../src/runtime/file-authoring-agent.ts";
import { writeJson } from "../../src/runtime/json.ts";

let root: string;

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "myelin-curator-service-"));
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

test("create mode plans subjects, runs subject writers, then publishes agent-authored documentation", async () => {
  await seedProject("uncurated");
  seedMemoryDb();
  await seedSchema();
  const stubs = await seedCreateStubs("demo");
  const service = new ProjectMemoryCuratorService(root, completedRetrievalDeps());

  const result = await service.runProjectLearn({
    projectKey: "demo",
    dryRun: false,
    review: false,
    now: new Date("2026-07-06T10:00:00.000Z"),
    env: { ...process.env, [FILE_AUTHORING_STUB_OUTPUTS_DIR]: stubs },
  });

  expect(result.status).toBe("completed");
  expect(result.mode).toBe("create");
  expect(result.run_kind).toBe("create_then_maintenance");
  expect(result.curation_kind).toBe("agent_authored");
  expect(result.artifacts.subject_manifest).toBe("reports/documentation-subject-manifest.json");
  expect(result.artifacts.maintenance_report).toBe("reports/documentation-maintenance-report.json");
  expect(result.artifacts.file_authoring_runs).toContain("agents/create/file-authoring-agent-result.json");
  expect(result.artifacts.file_authoring_runs).toContain("agents/subject-runtime/file-authoring-agent-result.json");
  expect(await readFile(join(root, "projects", "demo", "wiki", "index.md"), "utf8")).toContain("Project Memory index");
  expect(await readFile(join(root, "projects", "demo", "wiki", "runtime.md"), "utf8")).toContain("Runtime documentation from subject writer");
  const state = JSON.parse(await readFile(join(root, "projects", "demo", "state", "project-memory.json"), "utf8"));
  expect(state).toMatchObject({
    schema_version: 2,
    status: "curated",
    curation_kind: "agent_authored",
    run_kind: "create_then_maintenance",
    provider_mode: "stub",
    create: {
      status: "completed",
      subject_count: 1,
    },
    maintenance: {
      status: "noop",
      dispositions_count: 0,
    },
    retrieval_readiness: {
      status: "ready",
      checked_at: "2026-07-06T10:00:00.000Z",
      reason: null,
    },
  });
});

test("maintenance mode updates documentation and marks pending candidates processed", async () => {
  await seedProject("curated");
  seedMemoryDb();
  await seedSchema();
  await mkdir(join(root, "projects", "demo", "wiki"), { recursive: true });
  await writeFile(join(root, "projects", "demo", "wiki", "index.md"), "# Demo\n\nExisting index.\n", "utf8");
  await writeFile(join(root, "projects", "demo", "wiki", "runtime.md"), "# Runtime\n\nOld runtime.\n", "utf8");
  const db = openMemoryDb(root);
  createMemoryCandidate(db, {
    id: "cand_runtime",
    project_key: "demo",
    scope: "project",
    status: "pending",
    candidate_type: "fact",
    title: "Runtime changed",
    summary: "Runtime documentation should mention the CLI surface.",
    source_event_refs: ["event:1"],
    evidence: {},
    proposed_payload: {},
    confidence: "high",
    risk: "low",
    reason: "maintenance test",
    now: "2026-07-06T09:00:00.000Z",
  });
  db.close();
  const stubs = await seedMaintenanceStubs("demo");
  const service = new ProjectMemoryCuratorService(root, completedRetrievalDeps());

  const result = await service.runProjectLearn({
    projectKey: "demo",
    dryRun: false,
    review: false,
    now: new Date("2026-07-06T11:00:00.000Z"),
    env: { ...process.env, [FILE_AUTHORING_STUB_OUTPUTS_DIR]: stubs },
  });

  expect(result.status).toBe("completed");
  expect(result.mode).toBe("maintain");
  expect(result.run_kind).toBe("maintenance");
  expect(result.source_consumptions).toEqual(["project_candidate:cand_runtime"]);
  expect(await readFile(join(root, "projects", "demo", "wiki", "runtime.md"), "utf8")).toContain("CLI surface");
  const sourceState = JSON.parse(await readFile(join(root, "projects", "demo", "state", "project-memory-source-consumptions.json"), "utf8"));
  expect(sourceState.records[0]).toMatchObject({
    source_ref: "cand_runtime",
    terminal_decision: "applied_to_project_memory",
  });
  const readDb = openMemoryDb(root);
  expect(getMemoryCandidate(readDb, "cand_runtime")?.status).toBe("processed");
  readDb.close();
});

test("review mode runs agents but stops before publishing canonical wiki writes", async () => {
  await seedProject("uncurated");
  seedMemoryDb();
  await seedSchema();
  const stubs = await seedCreateStubs("demo");
  const service = new ProjectMemoryCuratorService(root, completedRetrievalDeps());

  const result = await service.runProjectLearn({
    projectKey: "demo",
    dryRun: false,
    review: true,
    now: new Date("2026-07-06T12:00:00.000Z"),
    env: { ...process.env, [FILE_AUTHORING_STUB_OUTPUTS_DIR]: stubs },
  });

  expect(result.status).toBe("needs_review");
  expect(result.stopped_before_writes).toBe(true);
  expect(result.stopped_reason).toBe("review requested");
  expect(await Bun.file(join(root, "projects", "demo", "wiki", "runtime.md")).exists()).toBe(false);
});

function completedRetrievalDeps() {
  return {
    retrievalLifecycle: {
      async afterProjectMemoryApply() {
        return {
          status: "completed" as const,
          artifacts: {
            retrieval_sections: "project-memory-retrieval-sections.json" as const,
            hint_generation: "project-memory-hint-generation-result.json" as const,
            retrieval_index_result: "project-memory-retrieval-index-result.json" as const,
          },
        };
      },
    },
  };
}

async function seedProject(status: "uncurated" | "curated"): Promise<void> {
  const repoPath = join(root, "repos", "demo");
  await writeJson(join(root, "projects", "demo", "state", "project.json"), {
    key: "demo",
    name: "Demo",
    repo_paths: [repoPath],
  });
  await writeJson(join(root, "projects", "demo", "state", "bootstrap-state.json"), { status });
  if (status === "curated") {
    await writeJson(join(root, "projects", "demo", "state", "project-memory.json"), { status: "curated" });
  }
  await mkdir(join(root, "projects", "demo", "wiki"), { recursive: true });
  await seedRepo(repoPath);
}

async function seedRepo(repoPath: string): Promise<void> {
  await mkdir(join(repoPath, "src", "commands"), { recursive: true });
  await writeFile(join(repoPath, "README.md"), "# Demo\n\nRuntime and CLI documentation.\n", "utf8");
  await writeFile(join(repoPath, "src", "commands", "project.ts"), "export const command = 'project learn';\n", "utf8");
}

async function seedCreateStubs(projectKey: string): Promise<string> {
  const stubs = await mkdtemp(join(tmpdir(), "myelin-create-stubs-"));
  await mkdir(join(stubs, "create-planner", "draft-wiki"), { recursive: true });
  await mkdir(join(stubs, "create-planner", "reports"), { recursive: true });
  await writeFile(join(stubs, "create-planner", "draft-wiki", "index.md"), "# Demo\n\nProject Memory index.\n", "utf8");
  await writeFile(join(stubs, "create-planner", "draft-wiki", "runtime.md"), "# Runtime\n\n", "utf8");
  await writeJson(join(stubs, "create-planner", "reports", "documentation-subject-manifest.json"), {
    schema_version: 1,
    project_key: projectKey,
    subjects: [
      {
        subject_id: "runtime",
        wiki_path: "runtime.md",
        title: "Runtime",
        purpose: "Document runtime command surfaces.",
        suggested_repo_paths: ["src/commands/project.ts"],
      },
    ],
  });
  await writeJson(join(stubs, "create-planner", "reports", "documentation-planner-report.json"), {
    evidence_paths: ["README.md"],
    known_gaps: [],
  });
  await mkdir(join(stubs, "subject-runtime", "draft-wiki"), { recursive: true });
  await mkdir(join(stubs, "subject-runtime", "reports"), { recursive: true });
  await writeFile(
    join(stubs, "subject-runtime", "draft-wiki", "runtime.md"),
    "# Runtime\n\nRuntime documentation from subject writer cites src/commands/project.ts.\n",
    "utf8",
  );
  await writeJson(join(stubs, "subject-runtime", "reports", "subject-report.json"), {
    schema_version: 1,
    project_key: projectKey,
    subject_id: "runtime",
    wiki_path: "runtime.md",
    status: "completed",
    evidence_paths: ["src/commands/project.ts"],
    touched_paths: ["runtime.md"],
    known_gaps: [],
  });
  return stubs;
}

async function seedMaintenanceStubs(projectKey: string): Promise<string> {
  const stubs = await mkdtemp(join(tmpdir(), "myelin-maintenance-stubs-"));
  await mkdir(join(stubs, "maintenance", "draft-wiki"), { recursive: true });
  await mkdir(join(stubs, "maintenance", "reports"), { recursive: true });
  await writeFile(join(stubs, "maintenance", "draft-wiki", "index.md"), "# Demo\n\nExisting index.\n", "utf8");
  await writeFile(
    join(stubs, "maintenance", "draft-wiki", "runtime.md"),
    "# Runtime\n\nUpdated runtime mentions the CLI surface in src/commands/project.ts.\n",
    "utf8",
  );
  await writeJson(join(stubs, "maintenance", "reports", "documentation-maintenance-report.json"), {
    schema_version: 1,
    project_key: projectKey,
    status: "completed",
    dispositions: [
      {
        source_kind: "project_candidate",
        source_ref: "cand_runtime",
        disposition: "applied_to_project_memory",
        reason: "Runtime page updated from repo evidence.",
        output_refs: ["runtime.md"],
      },
    ],
    touched_paths: ["runtime.md"],
    evidence_paths: ["src/commands/project.ts"],
    known_gaps: [],
  });
  return stubs;
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
