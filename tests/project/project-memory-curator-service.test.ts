import { afterEach, beforeEach, expect, test } from "bun:test";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createRuntimeInboxItem } from "../../src/inbox/runtime-inbox-items.ts";
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
  expect(result.artifacts.file_authoring_runs).toContain("agents/create-index-finalizer/file-authoring-agent-result.json");
  expect(await readFile(join(root, "projects", "demo", "index.md"), "utf8")).toContain("Canonical subjects");
  expect(await readFile(join(root, "projects", "demo", "runtime.md"), "utf8")).toContain("Runtime documentation from subject writer");
  expect(await readFile(join(root, "state", "demo", "repository-identity.json"), "utf8"))
    .toContain('"project_key": "demo"');
  const state = JSON.parse(await readFile(join(root, "state", "demo", "project-memory.json"), "utf8"));
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
  await mkdir(join(root, "projects", "demo"), { recursive: true });
  await writeFile(join(root, "projects", "demo", "index.md"), "# Demo\n\nExisting index.\n", "utf8");
  await writeFile(join(root, "projects", "demo", "runtime.md"), "# Runtime\n\nOld runtime.\n", "utf8");
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
  expect(await readFile(join(root, "projects", "demo", "runtime.md"), "utf8")).toContain("CLI surface");
  const sourceState = JSON.parse(await readFile(join(root, "state", "demo", "project-memory-source-consumptions.json"), "utf8"));
  expect(sourceState.records[0]).toMatchObject({
    source_ref: "cand_runtime",
    terminal_decision: "applied_to_project_memory",
  });
  const readDb = openMemoryDb(root);
  expect(getMemoryCandidate(readDb, "cand_runtime")?.status).toBe("processed");
  readDb.close();
});

test("legacy degraded state remains maintenance eligible and keeps the canonical baseline curated", async () => {
  await seedProject("curated");
  seedMemoryDb();
  await seedSchema();
  await writeFile(join(root, "projects", "demo", "index.md"), "# Demo\n\nExisting index.\n", "utf8");
  await writeFile(join(root, "projects", "demo", "runtime.md"), "# Runtime\n\nOld runtime.\n", "utf8");
  await writeJson(join(root, "state", "demo", "project-memory.json"), {
    schema_version: 2,
    project_key: "demo",
    status: "degraded",
    maintenance: {
      status: "degraded",
      degraded_reasons: ["Previous maintenance could not verify a candidate."],
    },
  });
  const db = openMemoryDb(root);
  createMemoryCandidate(db, {
    id: "cand_runtime",
    project_key: "demo",
    scope: "project",
    status: "needs_review",
    candidate_type: "project.architecture",
    title: "Runtime layout",
    summary: "The runtime layout is already documented.",
    source_event_refs: ["event:layout"],
    evidence: {
      observed_facts: ["Canonical markdown lives directly under projects/<key>."],
      relevant_paths: ["src/runtime/fs.ts"],
      uncertainties: [],
    },
    proposed_payload: {
      durable_facts: ["Machine state and runtime artifacts live outside projects/<key>."],
      change_kind: "architecture.layout",
      suggested_subjects: ["runtime and project layout"],
      verification_needed: ["Verify path helpers."],
    },
    confidence: "high",
    risk: "low",
    reason: "maintenance recovery test",
    now: "2026-07-06T09:00:00.000Z",
  });
  db.close();
  const stubs = await seedMaintenanceStubs("demo", "cand_runtime", {
    status: "degraded",
    disposition: "already_covered",
    knownGaps: ["One unrelated repository path could not be inspected."],
  });
  const service = new ProjectMemoryCuratorService(root, completedRetrievalDeps());

  const result = await service.runProjectLearn({
    projectKey: "demo",
    dryRun: false,
    review: false,
    now: new Date("2026-07-06T11:15:00.000Z"),
    env: { ...process.env, [FILE_AUTHORING_STUB_OUTPUTS_DIR]: stubs },
  });

  expect(result.mode).toBe("maintain");
  expect(result.run_kind).toBe("maintenance");
  const state = JSON.parse(await readFile(join(root, "state", "demo", "project-memory.json"), "utf8"));
  expect(state.status).toBe("curated");
  expect(state.maintenance).toMatchObject({
    status: "degraded",
    already_covered_count: 1,
    degraded_reasons: ["One unrelated repository path could not be inspected."],
  });
  const readDb = openMemoryDb(root);
  expect(getMemoryCandidate(readDb, "cand_runtime")?.status).toBe("processed");
  readDb.close();
});

test("project maintenance normalizes runtime inbox before agentic curation", async () => {
  await seedProject("curated");
  seedMemoryDb();
  await seedSchema();
  await writeFile(join(root, "projects", "demo", "index.md"), "# Demo\n\nExisting index.\n", "utf8");
  await writeFile(join(root, "projects", "demo", "runtime.md"), "# Runtime\n\nOld runtime.\n", "utf8");
  const inbox = await createRuntimeInboxItem(root, {
    projectKey: "demo",
    targetLayer: "project",
    title: "Runtime inbox candidate",
    body: "Runtime documentation should mention the runtime inbox maintenance path.",
    rationale: "Project maintenance should normalize inbox items before building the packet.",
    evidenceRefs: [],
    targetHint: null,
    confidence: "medium",
    risk: "low",
    creator: "operator:test",
    now: new Date("2026-07-06T09:30:00.000Z"),
    id: "2026-07-06T09-30-00Z_a1b2c3",
  });
  if (inbox.status !== "created") throw new Error("failed to create inbox fixture");
  const candidateId = "project_inbox:demo:2026-07-06T09-30-00Z_a1b2c3";
  const stubs = await seedMaintenanceStubs("demo", candidateId);
  const service = new ProjectMemoryCuratorService(root, completedRetrievalDeps());

  const result = await service.runProjectMaintenance({
    projectKey: "demo",
    dryRun: false,
    review: false,
    now: new Date("2026-07-06T11:30:00.000Z"),
    env: { ...process.env, [FILE_AUTHORING_STUB_OUTPUTS_DIR]: stubs },
  });

  expect(result.status).toBe("completed");
  expect(result.mode).toBe("maintain");
  expect(result.run_kind).toBe("maintenance");
  expect(result.artifacts.runtime_inbox_intake).toBe("runtime-inbox-intake.json");
  expect(result.source_consumptions).toEqual([`project_candidate:${candidateId}`]);
  expect(await readFile(join(root, "projects", "demo", "runtime.md"), "utf8")).toContain("CLI surface");
  const readDb = openMemoryDb(root);
  expect(getMemoryCandidate(readDb, candidateId)?.status).toBe("processed");
  readDb.close();
});

test("project maintenance refuses to bootstrap uncurated Project Memory", async () => {
  await seedProject("uncurated");
  seedMemoryDb();
  await seedSchema();
  const service = new ProjectMemoryCuratorService(root, completedRetrievalDeps());

  const result = await service.runProjectMaintenance({
    projectKey: "demo",
    dryRun: false,
    review: false,
    now: new Date("2026-07-06T12:30:00.000Z"),
  });

  expect(result.status).toBe("failed");
  expect(result.mode).toBe("maintain");
  expect(result.run_kind).toBe("maintenance");
  expect(result.stopped_before_writes).toBe(true);
  expect(result.stopped_reason).toContain("Project Memory is not curated");
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
  expect(await Bun.file(join(root, "projects", "demo", "runtime.md")).exists()).toBe(false);
});

test("reports a resumable checkpoint when canonical publication validation fails", async () => {
  await seedProject("uncurated");
  seedMemoryDb();
  await seedSchema();
  const stubs = await seedCreateStubs("demo");
  await writeFile(
    join(stubs, "create-index-finalizer", "finalized-index", "index.md"),
    "# Demo\n\n- [Runtime](runtime.md)\n- [Missing](missing.md)\n",
    "utf8",
  );
  const service = new ProjectMemoryCuratorService(root, completedRetrievalDeps());

  const result = await service.runProjectLearn({
    projectKey: "demo",
    dryRun: false,
    review: false,
    now: new Date("2026-07-06T12:30:00.000Z"),
    env: { ...process.env, [FILE_AUTHORING_STUB_OUTPUTS_DIR]: stubs },
  });

  expect(result.status).toBe("failed");
  expect(result.stopped_before_writes).toBe(true);
  expect(result.stopped_reason).toContain("broken internal wiki link");
  expect(result.resumable).toBe(true);
  expect(result.resume_command).toBe(`myelin project learn demo --resume ${result.run_dir}`);
  expect(await Bun.file(join(root, result.run_dir, "canonical-publication-validation.json")).exists()).toBe(true);
});

test("resumes a verified failed create checkpoint at maintenance and rejects checkpoint drift", async () => {
  await seedProject("uncurated");
  seedMemoryDb();
  await seedSchema();
  const db = openMemoryDb(root);
  createMemoryCandidate(db, {
    id: "cand_resume",
    project_key: "demo",
    scope: "project",
    status: "pending",
    candidate_type: "fact",
    title: "Resume candidate",
    summary: "Maintenance must process this candidate.",
    source_event_refs: ["event:resume"],
    evidence: {},
    proposed_payload: {},
    confidence: "high",
    risk: "low",
    reason: "resume test",
    now: "2026-07-06T09:00:00.000Z",
  });
  db.close();
  const stubs = await seedCreateStubs("demo");
  const service = new ProjectMemoryCuratorService(root, completedRetrievalDeps());

  const failed = await service.runProjectLearn({
    projectKey: "demo",
    dryRun: false,
    review: false,
    now: new Date("2026-07-06T13:00:00.000Z"),
    env: { ...process.env, [FILE_AUTHORING_STUB_OUTPUTS_DIR]: stubs },
  });

  expect(failed.status).toBe("failed");
  expect(failed.resumable).toBe(true);
  expect(failed.resume_command).toBe(`myelin project learn demo --resume ${failed.run_dir}`);
  const checkpointPath = join(root, failed.run_dir, "create-checkpoint.json");
  expect(await Bun.file(checkpointPath).exists()).toBe(true);
  const originalCheckpoint = await readFile(checkpointPath, "utf8");
  const incompatibleCheckpoint = { ...JSON.parse(originalCheckpoint), runtime_contract_version: 999 };
  await writeFile(checkpointPath, JSON.stringify(incompatibleCheckpoint), "utf8");
  await expect(service.runProjectLearn({
    projectKey: "demo",
    dryRun: false,
    review: false,
    resumeRun: failed.run_dir,
    now: new Date("2026-07-06T13:10:00.000Z"),
    env: { ...process.env, [FILE_AUTHORING_STUB_OUTPUTS_DIR]: stubs },
  })).rejects.toThrow("checkpoint runtime contract version is incompatible");
  await writeFile(checkpointPath, originalCheckpoint, "utf8");

  const repoDriftPath = join(root, "repos", "demo", "src", "drift.ts");
  await writeFile(repoDriftPath, "export const drift = true;\n", "utf8");
  await expect(service.runProjectLearn({
    projectKey: "demo",
    dryRun: false,
    review: false,
    resumeRun: failed.run_dir,
    now: new Date("2026-07-06T13:20:00.000Z"),
    env: { ...process.env, [FILE_AUTHORING_STUB_OUTPUTS_DIR]: stubs },
  })).rejects.toThrow("target repository snapshot changed");
  await rm(repoDriftPath);

  const sourceApplyJournal = join(root, failed.run_dir, "project-memory-apply-journal.json");
  await writeFile(sourceApplyJournal, "{}\n", "utf8");
  await expect(service.runProjectLearn({
    projectKey: "demo",
    dryRun: false,
    review: false,
    resumeRun: failed.run_dir,
    now: new Date("2026-07-06T13:25:00.000Z"),
    env: { ...process.env, [FILE_AUTHORING_STUB_OUTPUTS_DIR]: stubs },
  })).rejects.toThrow("invalid project memory apply journal");
  await rm(sourceApplyJournal);

  const draftPath = join(root, failed.run_dir, "pre-maintenance-wiki", "runtime.md");
  const originalDraft = await readFile(draftPath, "utf8");
  await writeFile(draftPath, `${originalDraft}\ncorrupt\n`, "utf8");

  await expect(service.runProjectLearn({
    projectKey: "demo",
    dryRun: false,
    review: false,
    resumeRun: failed.run_dir,
    now: new Date("2026-07-06T13:30:00.000Z"),
    env: { ...process.env, [FILE_AUTHORING_STUB_OUTPUTS_DIR]: stubs },
  })).rejects.toThrow("create artifact changed: pre-maintenance-wiki/runtime.md");

  await writeFile(draftPath, originalDraft, "utf8");
  await rm(join(stubs, "create-planner"), { recursive: true, force: true });
  await rm(join(stubs, "subject-runtime"), { recursive: true, force: true });
  await mkdir(join(stubs, "maintenance", "draft-wiki"), { recursive: true });
  await mkdir(join(stubs, "maintenance", "reports"), { recursive: true });
  await writeFile(
    join(stubs, "maintenance", "draft-wiki", "index.md"),
    "# Demo\n\n## Canonical subjects\n\n- [Runtime](runtime.md)\n",
    "utf8",
  );
  await writeFile(join(stubs, "maintenance", "draft-wiki", "runtime.md"), `${originalDraft}\nMaintenance resumed.\n`, "utf8");
  await writeJson(join(stubs, "maintenance", "reports", "documentation-maintenance-report.json"), {
    schema_version: 1,
    project_key: "demo",
    status: "completed",
    dispositions: [{
      source_kind: "project_candidate",
      source_ref: "cand_resume",
      disposition: "applied_to_project_memory",
      reason: "The resumed maintenance updated the runtime page.",
      output_refs: ["runtime.md"],
    }],
    touched_paths: ["runtime.md"],
    evidence_paths: ["README.md"],
    known_gaps: [],
  });

  const resumed = await service.runProjectLearn({
    projectKey: "demo",
    dryRun: false,
    review: false,
    resumeRun: failed.run_dir,
    now: new Date("2026-07-06T14:00:00.000Z"),
    env: { ...process.env, [FILE_AUTHORING_STUB_OUTPUTS_DIR]: stubs },
  });

  expect(resumed.status).toBe("completed");
  expect(resumed.resumed_from_run).toBe(failed.run_dir);
  expect(resumed.artifacts.resume_source).toBe("resume-source.json");
  expect(await readFile(join(root, "projects", "demo", "runtime.md"), "utf8")).toContain("Maintenance resumed");
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
  await writeJson(join(root, "state", "demo", "project.json"), {
    key: "demo",
    name: "Demo",
    repo_paths: [repoPath],
  });
  await writeJson(join(root, "state", "demo", "bootstrap-state.json"), { status });
  if (status === "curated") {
    await writeJson(join(root, "state", "demo", "project-memory.json"), { status: "curated" });
  }
  await mkdir(join(root, "projects", "demo"), { recursive: true });
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
    schema_version: 1,
    project_key: projectKey,
    evidence_paths: ["README.md"],
    surface_coverage: createStubSurfaceCoverage(),
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
      evidence_paths: ["src/commands/project.ts"],
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

async function seedMaintenanceStubs(
  projectKey: string,
  sourceRef = "cand_runtime",
  options: {
    status?: "completed" | "degraded";
    disposition?: "applied_to_project_memory" | "already_covered";
    knownGaps?: string[];
  } = {},
): Promise<string> {
  const stubs = await mkdtemp(join(tmpdir(), "myelin-maintenance-stubs-"));
  await mkdir(join(stubs, "maintenance", "draft-wiki"), { recursive: true });
  await mkdir(join(stubs, "maintenance", "reports"), { recursive: true });
  await writeFile(
    join(stubs, "maintenance", "draft-wiki", "index.md"),
    "# Demo\n\n## Canonical subjects\n\n- [Runtime](runtime.md)\n",
    "utf8",
  );
  await writeFile(
    join(stubs, "maintenance", "draft-wiki", "runtime.md"),
    "# Runtime\n\nUpdated runtime mentions the CLI surface in src/commands/project.ts.\n",
    "utf8",
  );
  await writeJson(join(stubs, "maintenance", "reports", "documentation-maintenance-report.json"), {
    schema_version: 1,
    project_key: projectKey,
    status: options.status ?? "completed",
    dispositions: [
      {
        source_kind: "project_candidate",
        source_ref: sourceRef,
        disposition: options.disposition ?? "applied_to_project_memory",
        reason: "Runtime page updated from repo evidence.",
        output_refs: ["runtime.md"],
      },
    ],
    touched_paths: ["runtime.md"],
    evidence_paths: ["src/commands/project.ts"],
    known_gaps: options.knownGaps ?? [],
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
