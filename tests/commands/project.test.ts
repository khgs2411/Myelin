import { afterEach, beforeEach, expect, test } from "bun:test";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  registerProjectCommands as registerProjectCommandsWithContext,
  type ProjectCommandDeps,
} from "../../src/commands/project.ts";
import { createCli } from "../../src/commands/registry.ts";
import { createRuntimeInboxItem } from "../../src/inbox/runtime-inbox-items.ts";
import { openMemoryDb } from "../../src/memory/db.ts";
import { FILE_AUTHORING_STUB_OUTPUTS_DIR } from "../../src/runtime/file-authoring-agent.ts";
import { writeJson } from "../../src/runtime/json.ts";

let root: string;
let oldCwd: string;

function registerProjectCommands(cli: ReturnType<typeof createCli>, deps: Omit<ProjectCommandDeps, "context"> = {}): void {
  registerProjectCommandsWithContext(cli, { ...deps, context: testContext() });
}

function testContext() {
  return {
    myelinRoot: root,
    callerCwd: join(root, "caller"),
    invocationKind: "test",
    rootSource: "test_dependency",
    launcherPath: null,
    locatorPath: null,
  } as const;
}

beforeEach(async () => {
  oldCwd = process.cwd();
  root = await mkdtemp(join(tmpdir(), "myelin-project-cli-"));
  process.chdir(root);
});

afterEach(async () => {
  process.chdir(oldCwd);
  await rm(root, { recursive: true, force: true });
});

test("project list shows active projects by default and legacy projects on request", async () => {
  await seedProject("active", "active");
  await seedProject("old-v1", "legacy");
  const cli = createCli("myelin");
  registerProjectCommands(cli);

  const active = await cli.run(["project", "list"]);
  expect(active.exitCode).toBe(0);
  expect(active.message).toContain("Active projects:");
  expect(active.message).toContain("- active [active]");
  expect(active.message).not.toContain("old-v1");
  expect(active.message).toContain("Use --include-legacy");

  const all = await cli.run(["project", "list", "--include-legacy"]);
  expect(all.exitCode).toBe(0);
  expect(all.message).toContain("- active [active]");
  expect(all.message).toContain("- old-v1 [legacy]");
});

test("project list --json emits active or legacy-aware project inventory", async () => {
  await seedProject("active", "active");
  await seedProject("old-v1", "legacy");
  const cli = createCli("myelin");
  registerProjectCommands(cli);

  const active = JSON.parse((await cli.run(["project", "list", "--json"])).message);
  expect(active.projects.map((project: { key: string }) => project.key)).toEqual(["active"]);

  const all = JSON.parse((await cli.run(["project", "list", "--include-legacy", "--json"])).message);
  expect(all.projects.map((project: { key: string; lifecycle: string }) => [project.key, project.lifecycle])).toEqual([
    ["active", "active"],
    ["old-v1", "legacy"],
  ]);
});

test("project list rejects unknown options", async () => {
  const cli = createCli("myelin");
  registerProjectCommands(cli);

  const result = await cli.run(["project", "list", "--all"]);

  expect(result.exitCode).toBe(1);
  expect(result.message).toContain("Unknown project list option: --all");
});

test("project packet emits a read-only Project Memory packet", async () => {
  await seedProject("active", "active");
  await writeJson(join(root, "projects", "active", "state", "bootstrap-state.json"), {
    status: "uncurated",
    missing: ["curated_project_memory"],
  });
  await mkdir(join(root, "projects", "active", "wiki"), { recursive: true });
  await writeFile(join(root, "projects", "active", "wiki", "index.md"), "# Project Memory\n\nShell only.\n", "utf8");
  const cli = createCli("myelin");
  registerProjectCommands(cli);

  const summary = await cli.run(["project", "packet", "active"]);
  expect(summary.exitCode).toBe(0);
  expect(summary.message).toContain("Project Memory packet for active");
  expect(summary.message).toContain("mode: create");
  expect(summary.message).toContain("wiki pages: 1");
  expect(summary.message).toContain("Use --json for the full packet.");

  const packet = JSON.parse((await cli.run(["project", "packet", "active", "--json"])).message);
  expect(packet.project_key).toBe("active");
  expect(packet.wiki.page_count).toBe(1);
  expect(packet.degraded_reasons).toContain(
    "state/memory.db is missing; Session Memory and pending handoff inputs are unavailable",
  );
  expect(await Bun.file(join(root, "state", "memory.db")).exists()).toBe(false);
});

test("project packet rejects unknown options and missing project keys", async () => {
  const cli = createCli("myelin");
  registerProjectCommands(cli);

  expect((await cli.run(["project", "packet"])).message).toContain(
    "Usage: myelin project packet <project-key> [--json]",
  );
  expect((await cli.run(["project", "packet", "active", "--full"])).message).toContain(
    "Unknown project packet option: --full",
  );
});

test("project reset requires explicit clean confirmation", async () => {
  const cli = createCli("myelin");
  registerProjectCommands(cli);

  expect((await cli.run(["project", "reset", "active"])).message).toContain(
    "Usage: myelin project reset <project-key> --clean --confirm <project-key> [--json]",
  );
  expect((await cli.run(["project", "reset", "active", "--clean", "--confirm", "other"])).message).toContain(
    "Usage: myelin project reset <project-key> --clean --confirm <project-key> [--json]",
  );
});

test("project reset clean rebootstrap preserves root memory db", async () => {
  await seedProject("active", "active");
  await mkdir(join(root, "repos", "active"), { recursive: true });
  await mkdir(join(root, "state"), { recursive: true });
  await writeFile(join(root, "state", "memory.db"), "memory", "utf8");
  await mkdir(join(root, "projects", "active", "wiki"), { recursive: true });
  await writeFile(join(root, "projects", "active", "wiki", "old.md"), "# Old\n", "utf8");
  await writeJson(join(root, "projects", "active", "state", "project-memory.json"), { status: "curated" });
  const cli = createCli("myelin");
  registerProjectCommands(cli);

  const result = await cli.run(["project", "reset", "active", "--clean", "--confirm", "active", "--json"]);
  const response = JSON.parse(result.message);

  expect(result.exitCode).toBe(0);
  expect(response).toMatchObject({
    project_key: "active",
    reset_scope: "project_shell",
    bootstrap_status: "rebootstrapped",
  });
  expect(await readFile(join(root, "state", "memory.db"), "utf8")).toBe("memory");
  expect(await Bun.file(join(root, "projects", "active", "wiki", "old.md")).exists()).toBe(false);
  expect(await Bun.file(join(root, "projects", "active", "state", "project-memory.json")).exists()).toBe(false);
  expect(await Bun.file(join(root, "projects", "active", "state", "bootstrap-state.json")).exists()).toBe(true);
});

test("project learn routes through agent-authored create plus maintenance", async () => {
  await seedLearnProject("active");
  seedMemoryDb();
  await seedSchema();
  const stubs = await seedCreateStubs("active");
  const cli = createCli("myelin");
  registerProjectCommands(cli, {
    now: () => new Date("2026-07-06T10:00:00.000Z"),
    env: { ...process.env, [FILE_AUTHORING_STUB_OUTPUTS_DIR]: stubs },
    runner: hintRunner("active"),
  });

  const result = await cli.run(["project", "learn", "active", "--json"]);
  const response = JSON.parse(result.message);

  expect(result.exitCode).toBe(0);
  expect(response.project_key).toBe("active");
  expect(response.run_kind).toBe("create_then_maintenance");
  expect(response.artifacts.curator_output).toBe("documentation-maintenance-result.json");
  expect(response.artifacts.subject_manifest).toBe("reports/documentation-subject-manifest.json");
  expect(response.artifacts.maintenance_report).toBe("reports/documentation-maintenance-report.json");
  expect(response.artifacts.apply_journal).toBe("project-memory-apply-journal.json");
  expect(response.stopped_before_writes).toBe(false);
  expect(await readFile(join(root, response.run_dir, "summary.md"), "utf8")).toContain("run_kind: create_then_maintenance");
  expect(await readFile(join(root, "projects", "active", "wiki", "runtime.md"), "utf8")).toContain("Runtime documentation");
});

test("project learn human output reports pending retrieval index after successful writes", async () => {
  await seedLearnProject("pending-index");
  seedMemoryDb();
  await seedSchema();
  const stubs = await seedCreateStubs("pending-index");
  const cli = createCli("myelin");
  registerProjectCommands(cli, {
    now: () => new Date("2026-07-06T10:00:00.000Z"),
    env: { ...process.env, [FILE_AUTHORING_STUB_OUTPUTS_DIR]: stubs },
    runner: hintRunner("pending-index"),
  });

  const result = await cli.run(["project", "learn", "pending-index"]);

  expect(result.exitCode).toBe(0);
  expect(result.message).toContain("Project learn completed for pending-index.");
  expect(result.message).toContain("run kind: create_then_maintenance");
  expect(result.message).not.toContain("pending retrieval index: yes");
});

test("project learn JSON includes runtime inbox intake artifact when intake runs", async () => {
  await seedLearnProject("active");
  seedMemoryDb();
  await seedSchema();
  const inbox = await createRuntimeInboxItem(root, {
    projectKey: "active",
    targetLayer: "project",
    title: "Runtime inbox candidate",
    body: "Runtime inbox candidate visible to project learn.",
    rationale: "Project learn should run intake before packet construction.",
    evidenceRefs: [],
    targetHint: null,
    confidence: "medium",
    risk: "low",
    creator: "operator:test",
    now: new Date("2026-07-06T09:00:00.000Z"),
    id: "2026-07-06T09-00-00Z_a1b2c3",
  });
  if (inbox.status !== "created") throw new Error("failed to create inbox fixture");
  const stubs = await seedCreateAndMaintenanceStubs("active");
  const cli = createCli("myelin");
  registerProjectCommands(cli, {
    now: () => new Date("2026-07-06T11:00:00.000Z"),
    env: { ...process.env, [FILE_AUTHORING_STUB_OUTPUTS_DIR]: stubs },
    runner: hintRunner("active"),
  });

  const result = await cli.run(["project", "learn", "active", "--json"]);
  const response = JSON.parse(result.message);

  expect(result.exitCode).toBe(0);
  expect(response.artifacts.runtime_inbox_intake).toBe("runtime-inbox-intake.json");
  expect(response.artifacts.maintenance_report).toBe("reports/documentation-maintenance-report.json");
});

test("project ingest is not a Project Memory command", async () => {
  const cli = createCli("myelin");
  registerProjectCommands(cli);

  const result = await cli.run(["project", "ingest", "active"]);

  expect(result.exitCode).toBe(1);
});

async function seedProject(key: string, lifecycle: "active" | "legacy"): Promise<void> {
  await writeJson(join(root, "projects", key, "state", "project.json"), {
    key,
    name: key,
    lifecycle,
    repo_paths: [join(root, "repos", key)],
  });
}

async function seedLearnProject(key: string): Promise<void> {
  const repoPath = join(root, "repos", key);
  await writeJson(join(root, "projects", key, "state", "project.json"), {
    key,
    name: key,
    repo_paths: [repoPath],
  });
  await writeJson(join(root, "projects", key, "state", "bootstrap-state.json"), { status: "uncurated" });
  await mkdir(join(root, "projects", key, "wiki"), { recursive: true });
  await mkdir(join(repoPath, "src"), { recursive: true });
  await writeFile(join(repoPath, "README.md"), `# ${key}\n`, "utf8");
  await writeFile(join(repoPath, "src", "runtime.ts"), "export const runtime = true;\n", "utf8");
}

async function seedCreateStubs(projectKey: string): Promise<string> {
  const stubs = await mkdtemp(join(tmpdir(), "myelin-cli-stubs-"));
  await writeCreateStages(stubs, projectKey);
  return stubs;
}

async function seedCreateAndMaintenanceStubs(projectKey: string): Promise<string> {
  const stubs = await seedCreateStubs(projectKey);
  await mkdir(join(stubs, "maintenance", "draft-wiki"), { recursive: true });
  await mkdir(join(stubs, "maintenance", "reports"), { recursive: true });
  await writeFile(join(stubs, "maintenance", "draft-wiki", "index.md"), `# ${projectKey}\n\nIndex.\n`, "utf8");
  await writeFile(join(stubs, "maintenance", "draft-wiki", "runtime.md"), "# Runtime\n\nRuntime documentation updated from inbox.\n", "utf8");
  await writeJson(join(stubs, "maintenance", "reports", "documentation-maintenance-report.json"), {
    schema_version: 1,
    project_key: projectKey,
    status: "completed",
    dispositions: [
      {
        source_kind: "project_candidate",
        source_ref: "2026-07-06T09-00-00Z_a1b2c3",
        disposition: "already_covered",
        reason: "Create mode already documented the runtime surface.",
        output_refs: ["runtime.md"],
      },
    ],
    touched_paths: ["runtime.md"],
    evidence_paths: ["src/runtime.ts"],
    known_gaps: [],
  });
  return stubs;
}

async function writeCreateStages(stubs: string, projectKey: string): Promise<void> {
  await mkdir(join(stubs, "create-planner", "draft-wiki"), { recursive: true });
  await mkdir(join(stubs, "create-planner", "reports"), { recursive: true });
  await writeFile(join(stubs, "create-planner", "draft-wiki", "index.md"), `# ${projectKey}\n\nIndex.\n`, "utf8");
  await writeFile(join(stubs, "create-planner", "draft-wiki", "runtime.md"), "# Runtime\n\n", "utf8");
  await writeJson(join(stubs, "create-planner", "reports", "documentation-subject-manifest.json"), {
    schema_version: 1,
    project_key: projectKey,
    subjects: [{
      subject_id: "runtime",
      wiki_path: "runtime.md",
      title: "Runtime",
      purpose: "Runtime documentation.",
      suggested_repo_paths: ["src/runtime.ts"],
    }],
  });
  await writeJson(join(stubs, "create-planner", "reports", "documentation-planner-report.json"), {
    evidence_paths: ["README.md"],
    known_gaps: [],
  });
  await mkdir(join(stubs, "subject-runtime", "draft-wiki"), { recursive: true });
  await mkdir(join(stubs, "subject-runtime", "reports"), { recursive: true });
  await writeFile(join(stubs, "subject-runtime", "draft-wiki", "runtime.md"), "# Runtime\n\nRuntime documentation.\n", "utf8");
  await writeJson(join(stubs, "subject-runtime", "reports", "subject-report.json"), {
    schema_version: 1,
    project_key: projectKey,
    subject_id: "runtime",
    wiki_path: "runtime.md",
    status: "completed",
    evidence_paths: ["src/runtime.ts"],
    touched_paths: ["runtime.md"],
    known_gaps: [],
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
