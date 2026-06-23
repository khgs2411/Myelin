import { afterEach, beforeEach, expect, test } from "bun:test";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ProjectMemoryCuratorService } from "../../src/project/project-memory-curator-service.ts";
import { writeJson } from "../../src/runtime/json.ts";

let root: string;

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "myelin-curator-service-"));
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

test("runs project learn in create mode, writes curator artifacts, and stops before wiki writes", async () => {
  await seedProject("uncurated");
  await seedSchema();
  const originalWiki = await readFile(join(root, "projects", "demo", "wiki", "index.md"), "utf8");
  const service = new ProjectMemoryCuratorService(root);

  const result = await service.runProjectLearn({
    projectKey: "demo",
    dryRun: false,
    review: false,
    now: new Date("2026-06-23T10:00:00.000Z"),
    runner: async () => ({
      exitCode: 0,
      stdout: JSON.stringify(creationDraft("projects/demo/runs/project-learn/2026-06-23T10-00-00.000Z-run")),
      stderr: "",
    }),
  });

  expect(result.status).toBe("completed");
  expect(result.mode).toBe("create");
  expect(result.stopped_before_writes).toBe(true);
  expect(result.artifacts.input_packet).toBe("input-packet.json");
  expect(result.artifacts.curator_output).toBe("curator-creation-draft.json");
  expect(await Bun.file(join(root, result.run_dir, "curator-validation.json")).exists()).toBe(true);
  expect(await Bun.file(join(root, result.run_dir, "curator-run-result.json")).exists()).toBe(true);
  expect(await Bun.file(join(root, result.run_dir, "summary.md")).exists()).toBe(true);
  expect(await readFile(join(root, "projects", "demo", "wiki", "index.md"), "utf8")).toBe(originalWiki);
});

test("runs maintain mode and returns needs_review when validation rejects all items", async () => {
  await seedProject("curated");
  await seedSchema();
  const service = new ProjectMemoryCuratorService(root);

  const result = await service.runProjectLearn({
    projectKey: "demo",
    dryRun: false,
    review: false,
    now: new Date("2026-06-23T11:00:00.000Z"),
    runner: async () => ({
      exitCode: 0,
      stdout: JSON.stringify({
        schema_version: 1,
        project_key: "demo",
        mode: "maintain",
        packet_ref: {
          run_dir: "projects/demo/runs/project-learn/2026-06-23T11-00-00.000Z-run",
          artifact: "input-packet.json",
          packet_schema_version: 1,
        },
        packet_context: packetContext(),
        summary: "Rejected update",
        items: [
          {
            id: "bad",
            operation: "PATCH_ENTRY",
            target_page: { path: "../state/project.json", path_kind: "existing_wiki_page" },
            content_intent: "bad",
            source_packet_refs: [],
            evidence_refs: [],
            repo_citations: [],
            applicability: {},
            lifecycle_intent: "active",
            risk: lowRisk(),
            preconditions: [],
            expected_outcome: "reject",
          },
        ],
        noop_inputs: [],
        risk: lowRisk(),
      }),
      stderr: "",
    }),
  });

  expect(result.status).toBe("needs_review");
  expect(result.validation_ok).toBe(false);
  expect(result.stopped_reason).toBe("curator validation did not produce eligible output");
  expect(result.artifacts.curator_output).toBe("curator-maintenance-proposal.json");
});

test("writes failure artifacts when provider invocation fails after packet creation", async () => {
  await seedProject("curated");
  await seedSchema();
  const service = new ProjectMemoryCuratorService(root);

  const result = await service.runProjectLearn({
    projectKey: "demo",
    dryRun: false,
    review: false,
    now: new Date("2026-06-23T12:00:00.000Z"),
    runner: async () => ({ exitCode: 2, stdout: "", stderr: "provider unavailable" }),
  });

  expect(result.status).toBe("failed");
  expect(result.validation_ok).toBe(false);
  expect(result.artifacts.curator_output).toBe("curator-output-error.json");
  expect(await Bun.file(join(root, result.run_dir, "input-packet.json")).exists()).toBe(true);
  expect(await Bun.file(join(root, result.run_dir, "curator-output-error.json")).exists()).toBe(true);
  expect(await Bun.file(join(root, result.run_dir, "curator-validation.json")).exists()).toBe(true);
  expect(await readFile(join(root, result.run_dir, "summary.md"), "utf8")).toContain("provider invocation failed");
});

test("writes failure artifacts when curator output is not valid JSON", async () => {
  await seedProject("curated");
  await seedSchema();
  const service = new ProjectMemoryCuratorService(root);

  const result = await service.runProjectLearn({
    projectKey: "demo",
    dryRun: false,
    review: false,
    now: new Date("2026-06-23T12:30:00.000Z"),
    runner: async () => ({ exitCode: 0, stdout: "not json", stderr: "" }),
  });

  expect(result.status).toBe("failed");
  expect(result.validation_ok).toBe(false);
  expect(result.stopped_reason).toContain("curator output was not valid JSON");
  expect(await Bun.file(join(root, result.run_dir, "curator-run-result.json")).exists()).toBe(true);
  expect(await Bun.file(join(root, result.run_dir, "summary.md")).exists()).toBe(true);
});

async function seedProject(status: "curated" | "uncurated"): Promise<void> {
  await writeJson(join(root, "projects", "demo", "state", "project.json"), {
    key: "demo",
    name: "Demo",
    repo_paths: [join(root, "repos", "demo")],
  });
  await writeJson(join(root, "projects", "demo", "state", "bootstrap-state.json"), { status });
  if (status === "curated") {
    await writeJson(join(root, "projects", "demo", "state", "project-memory.json"), { status: "curated" });
  }
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

function creationDraft(runDir: string) {
  return {
    schema_version: 1,
    project_key: "demo",
    mode: "create",
    packet_ref: { run_dir: runDir, artifact: "input-packet.json", packet_schema_version: 1 },
    packet_context: packetContext(),
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
    risk: lowRisk(),
  };
}

function packetContext() {
  return { degraded: false, degraded_reasons: [], budgets: { max_items: 25, max_content_chars: 4_000 } };
}

function lowRisk() {
  return { level: "low" as const, reasons: [], requires_quarantine: false };
}
