import { afterEach, beforeEach, expect, test } from "bun:test";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { registerProjectCommands } from "../../src/commands/project.ts";
import { createCli } from "../../src/commands/registry.ts";
import { writeJson } from "../../src/runtime/json.ts";

let root: string;
let oldCwd: string;

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

test("project learn routes through curator service and writes curator artifacts", async () => {
  await seedProject("active", "active");
  await writeJson(join(root, "projects", "active", "state", "bootstrap-state.json"), {
    status: "uncurated",
    missing: ["curated_project_memory"],
  });
  await mkdir(join(root, "projects", "active", "wiki"), { recursive: true });
  await writeFile(join(root, "projects", "active", "wiki", "index.md"), "# Active\n", "utf8");
  await seedSchema();
  const cli = createCli("myelin");
  registerProjectCommands(cli, {
    now: () => new Date("2026-06-23T10:00:00.000Z"),
    runner: async () => ({
      exitCode: 0,
      stdout: JSON.stringify(creationDraft("active", "projects/active/runs/project-learn/2026-06-23T10-00-00.000Z-run")),
      stderr: "",
    }),
  });

  const result = await cli.run(["project", "learn", "active", "--json"]);
  const response = JSON.parse(result.message);

  expect(result.exitCode).toBe(0);
  expect(response.project_key).toBe("active");
  expect(response.artifacts.curator_output).toBe("curator-creation-draft.json");
  expect(response.stopped_before_writes).toBe(true);
  expect(await readFile(join(root, response.run_dir, "summary.md"), "utf8")).toContain("stopped_before_writes: true");
});

test("project ingest is not a Project Memory command", async () => {
  const cli = createCli("myelin");
  registerProjectCommands(cli);

  const result = await cli.run(["project", "ingest", "active"]);

  expect(result.exitCode).toBe(1);
  expect(result.message).toContain("Unknown command");
});

test("project learn reports validation failures in human-readable output", async () => {
  await seedProject("active", "active");
  await writeJson(join(root, "projects", "active", "state", "bootstrap-state.json"), { status: "curated" });
  await writeJson(join(root, "projects", "active", "state", "project-memory.json"), { status: "curated" });
  await mkdir(join(root, "projects", "active", "wiki"), { recursive: true });
  await writeFile(join(root, "projects", "active", "wiki", "index.md"), "# Active\n", "utf8");
  await seedSchema();
  const cli = createCli("myelin");
  registerProjectCommands(cli, {
    now: () => new Date("2026-06-23T10:30:00.000Z"),
    runner: async () => ({
      exitCode: 0,
      stdout: JSON.stringify({
        schema_version: 1,
        project_key: "active",
        mode: "maintain",
        packet_ref: {
          run_dir: "projects/active/runs/project-learn/2026-06-23T10-30-00.000Z-run",
          artifact: "input-packet.json",
          packet_schema_version: 1,
        },
        packet_context: { degraded: false, degraded_reasons: [], budgets: { max_items: 25, max_content_chars: 4_000 } },
        summary: "bad",
        items: [],
        noop_inputs: [],
        risk: { level: "low", reasons: [], requires_quarantine: false },
      }),
      stderr: "",
    }),
  });

  const result = await cli.run(["project", "learn", "active"]);

  expect(result.exitCode).toBe(0);
  expect(result.message).toContain("Project learn needs_review for active.");
  expect(result.message).toContain("validation: failed");
  expect(result.message).toContain("stopped_before_writes: true");
  expect(result.message).toContain("stopped: curator validation did not produce eligible output");
});

async function seedProject(key: string, lifecycle: "active" | "legacy"): Promise<void> {
  await writeJson(join(root, "projects", key, "state", "project.json"), {
    key,
    name: key,
    lifecycle,
    repo_paths: [join(root, "repos", key)],
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
    categories: [{ key: "setup", summary: "Setup." }],
  });
}

function creationDraft(projectKey: string, runDir: string) {
  return {
    schema_version: 1,
    project_key: projectKey,
    mode: "create",
    packet_ref: { run_dir: runDir, artifact: "input-packet.json", packet_schema_version: 1 },
    packet_context: { degraded: false, degraded_reasons: [], budgets: { max_items: 25, max_content_chars: 4_000 } },
    summary: "Initial brain",
    brain_intent: {
      name: projectKey,
      first_brain_summary: "Create first brain",
      untrusted_existing_markdown_policy: "adopt",
    },
    pages: [
      {
        id: "index",
        target: { path: "index.md", path_kind: "new_wiki_page" },
        title: projectKey,
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
  };
}
