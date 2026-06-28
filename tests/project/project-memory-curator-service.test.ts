import { afterEach, beforeEach, expect, test } from "bun:test";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createRuntimeInboxItem } from "../../src/inbox/runtime-inbox-items.ts";
import { createMemoryCandidate, getMemoryCandidate } from "../../src/memory/candidates.ts";
import { createHandoffInstruction, listHandoffInstructions } from "../../src/memory/handoffs.ts";
import { ProjectMemoryCuratorService } from "../../src/project/project-memory-curator-service.ts";
import { openMemoryDb } from "../../src/memory/db.ts";
import { writeJson } from "../../src/runtime/json.ts";

let root: string;

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "myelin-curator-service-"));
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

test("runs project learn in create mode and applies valid low-risk output", async () => {
  await seedProject("uncurated");
  seedMemoryDb();
  await seedSchema();
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
  expect(result.stopped_before_writes).toBe(false);
  expect(result.artifacts.input_packet).toBe("input-packet.json");
  expect(result.artifacts.prompt_budget).toBe("prompt-budget.json");
  expect(result.artifacts.curator_output).toBe("curator-creation-draft.json");
  expect(result.artifacts.apply_journal).toBe("project-memory-apply-journal.json");
  expect(result.artifacts.apply_result).toBe("project-memory-apply-result.json");
  expect(result.artifacts.changeset).toBe("project-memory-changeset.json");
  expect(await Bun.file(join(root, result.run_dir, "curator-validation.json")).exists()).toBe(true);
  expect(await Bun.file(join(root, result.run_dir, "curator-run-result.json")).exists()).toBe(true);
  expect(await Bun.file(join(root, result.run_dir, "prompt-budget.json")).exists()).toBe(true);
  expect(await Bun.file(join(root, result.run_dir, "summary.md")).exists()).toBe(true);
  expect(await readFile(join(root, "projects", "demo", "wiki", "index.md"), "utf8")).toContain("# Demo");
  expect(await readFile(join(root, "projects", "demo", "wiki", "setup", "index.md"), "utf8")).toContain("# Setup");
});

test("runs maintain mode and applies eligible low-risk maintenance output", async () => {
  await seedProject("curated");
  seedMemoryDb();
  await mkdir(join(root, "projects", "demo", "wiki", "setup"), { recursive: true });
  await writeFile(join(root, "projects", "demo", "wiki", "setup", "index.md"), "# Setup\n", "utf8");
  await seedSchema();
  const service = new ProjectMemoryCuratorService(root);

  const result = await service.runProjectLearn({
    projectKey: "demo",
    dryRun: false,
    review: false,
    now: new Date("2026-06-23T13:00:00.000Z"),
    runner: async () => ({
      exitCode: 0,
      stdout: JSON.stringify(maintenanceProposal("projects/demo/runs/project-learn/2026-06-23T13-00-00.000Z-run")),
      stderr: "",
    }),
  });

  expect(result.status).toBe("completed");
  expect(result.mode).toBe("maintain");
  expect(result.stopped_before_writes).toBe(false);
  expect(result.applied_item_ids).toEqual(["item_1"]);
  expect(await readFile(join(root, "projects", "demo", "wiki", "setup", "index.md"), "utf8")).toContain('id="setup.cli"');
});

test("reconciles consumed Project Memory sources before building the next curator packet", async () => {
  await seedProject("curated");
  seedMemoryDb();
  seedPendingProjectSources();
  await writeJson(join(root, "projects", "demo", "state", "project-memory-source-consumptions.json"), {
    schema_version: 1,
    project_key: "demo",
    records: [
      sourceRecord("project_candidate", "cand_1"),
      sourceRecord("project_handoff", "handoff_1"),
    ],
  });
  await mkdir(join(root, "projects", "demo", "wiki", "setup"), { recursive: true });
  await writeFile(join(root, "projects", "demo", "wiki", "setup", "index.md"), "# Setup\n", "utf8");
  await seedSchema();
  const service = new ProjectMemoryCuratorService(root);

  const result = await service.runProjectLearn({
    projectKey: "demo",
    dryRun: false,
    review: false,
    now: new Date("2026-06-23T13:30:00.000Z"),
    runner: async (_command, options) => {
      expect(options?.stdin).not.toContain("Already consumed candidate");
      expect(options?.stdin).not.toContain("Already consumed handoff");
      return {
        exitCode: 0,
        stdout: JSON.stringify(maintenanceProposal("projects/demo/runs/project-learn/2026-06-23T13-30-00.000Z-run")),
        stderr: "",
      };
    },
  });

  expect(result.status).toBe("completed");
  const db = openMemoryDb(root);
  try {
    expect(getMemoryCandidate(db, "cand_1")?.status).toBe("processed");
    expect(listHandoffInstructions(db, { target_scope: "project", project_key: "demo", status: "processed" })[0]?.id).toBe(
      "handoff_1",
    );
  } finally {
    db.close();
  }
});

test("runs runtime inbox intake before building the curator packet", async () => {
  await seedProject("curated");
  seedMemoryDb();
  await seedSchema();
  const inbox = await createRuntimeInboxItem(root, {
    projectKey: "demo",
    targetLayer: "project",
    title: "Runtime inbox intake candidate",
    body: "Runtime inbox intake should enter the Project Memory packet.",
    rationale: "Project learn should compose runtime inbox intake before packet construction.",
    evidenceRefs: ["docs/design/spec.md"],
    targetHint: null,
    confidence: "high",
    risk: "medium",
    creator: "operator:test",
    now: new Date("2026-06-25T10:00:00.000Z"),
    id: "2026-06-25T10-00-00Z_a1b2c3",
  });
  if (inbox.status !== "created") throw new Error("failed to create inbox fixture");
  await mkdir(join(root, "projects", "demo", "wiki", "setup"), { recursive: true });
  await writeFile(join(root, "projects", "demo", "wiki", "setup", "index.md"), "# Setup\n", "utf8");
  const service = new ProjectMemoryCuratorService(root);

  const result = await service.runProjectLearn({
    projectKey: "demo",
    dryRun: true,
    review: false,
    now: new Date("2026-06-25T11:00:00.000Z"),
    runner: async (_command, options) => {
      expect(options?.stdin).toContain(
        "Input packet artifact: projects/demo/runs/project-learn/2026-06-25T11-00-00.000Z-run/input-packet.json",
      );
      expect(options?.stdin).toContain("Read the input packet artifact from the repository before answering.");
      expect(options?.stdin).not.toContain("Runtime inbox intake should enter the Project Memory packet.");
      return {
        exitCode: 0,
        stdout: JSON.stringify(maintenanceProposal("projects/demo/runs/project-learn/2026-06-25T11-00-00.000Z-run")),
        stderr: "",
      };
    },
  });

  expect(result.status).toBe("completed");
  expect(result.artifacts.runtime_inbox_intake).toBe("runtime-inbox-intake.json");
  const packetArtifact = await readFile(join(root, result.run_dir, "input-packet.json"), "utf8");
  expect(packetArtifact).toContain("Runtime inbox intake should enter the Project Memory packet.");
  expect(packetArtifact).toContain("project.inbox");
  const intakeArtifact = JSON.parse(await readFile(join(root, result.run_dir, "runtime-inbox-intake.json"), "utf8"));
  expect(intakeArtifact.created_candidate_ids).toEqual(["project_inbox:demo:2026-06-25T10-00-00Z_a1b2c3"]);
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
  expect(result.artifacts.prompt_budget).toBe("prompt-budget.json");
  expect(await Bun.file(join(root, result.run_dir, "input-packet.json")).exists()).toBe(true);
  expect(await Bun.file(join(root, result.run_dir, "prompt-budget.json")).exists()).toBe(true);
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

test("recovery failure for missing apply artifacts does not advertise them", async () => {
  await seedProject("curated");
  await writeJson(join(root, "projects", "demo", "runs", "project-learn", "run-missing-artifacts", "project-memory-apply-journal.json"), {
    schema_version: 1,
    project_key: "demo",
    run_dir: "projects/demo/runs/project-learn/run-missing-artifacts",
    mode: "maintain",
    status: "applied",
    packet_ref: "input-packet.json",
    curator_output_ref: "curator-maintenance-proposal.json",
    validation_ref: "curator-validation.json",
    staged_outputs_dir: "staged",
    expected_writes: [],
    observed_promotions: [],
    recovery: { required_before_new_curator: false },
  });
  const service = new ProjectMemoryCuratorService(root);

  const result = await service.runProjectLearn({
    projectKey: "demo",
    dryRun: false,
    review: false,
    now: new Date("2026-06-23T14:00:00.000Z"),
    runner: async () => {
      throw new Error("curator should not run during recovery preflight");
    },
  });

  expect(result.status).toBe("failed");
  expect(result.artifacts.apply_journal).toBeUndefined();
  expect(result.artifacts.apply_result).toBeUndefined();
  expect(result.artifacts.changeset).toBeUndefined();
  expect(result.stopped_reason).toContain("apply result or changeset artifact is missing");
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

function seedMemoryDb(): void {
  const db = openMemoryDb(root);
  db.close();
}

function seedPendingProjectSources(): void {
  const db = openMemoryDb(root);
  try {
    createMemoryCandidate(db, {
      id: "cand_1",
      project_key: "demo",
      scope: "project",
      status: "pending",
      candidate_type: "project.fact",
      title: "Already consumed candidate",
      summary: "Already consumed candidate should not be re-fed to the curator.",
      source_event_refs: ["tomb_1"],
      evidence: {},
      proposed_payload: {},
      confidence: "medium",
      risk: "low",
      reason: "Already consumed candidate",
      now: "2026-06-23T13:20:00.000Z",
    });
    createHandoffInstruction(db, {
      id: "handoff_1",
      target_scope: "project",
      project_key: "demo",
      status: "pending",
      objective: "Already consumed handoff",
      prompt_text: "Already consumed handoff should not be re-fed to the curator.",
      source_session_memory_ids: ["mem_1"],
      source_event_refs: ["tomb_1"],
      suggested_actions: ["query project memory"],
      reason: "Already consumed handoff",
      confidence: "medium",
      risk: "low",
      now: "2026-06-23T13:21:00.000Z",
    });
  } finally {
    db.close();
  }
}

function sourceRecord(source_kind: "project_candidate" | "project_handoff", source_ref: string) {
  return {
    source_kind,
    source_ref,
    project_key: "demo",
    consumed_by_run: "projects/demo/runs/project-learn/previous-run",
    consumed_at: "2026-06-23T13:25:00.000Z",
    terminal_decision: "applied_to_project_memory" as const,
    output_refs: ["project-memory-changeset.json"],
  };
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
      creationPage("page_index", "index.md", "Demo", "Project Memory index"),
      creationPage("page_setup", "setup/index.md", "Setup", "Setup workflows"),
    ],
    state_intent: { mark_project_memory_curated: true, freshness_intent: "initialize" },
    evidence_refs: [{ kind: "project_state", ref: "bootstrap_state" }],
    repo_citations: [],
    risk: lowRisk(),
  };
}

function creationPage(id: string, path: string, title: string, purpose: string) {
  return {
    id,
    target: { path, path_kind: "new_wiki_page" },
    title,
    purpose,
    content_intent: `Create ${title}`,
    apply_payload: {
      schema_version: 1,
      pages: [
        {
          page_path: path,
          title,
          purpose,
          body: { paragraphs: [`${title} describes ${purpose}.`] },
          evidence_refs: [{ kind: "project_state", ref: "bootstrap_state" }],
          repo_citations: [],
          inference: {
            label: "initial_project_memory",
            why_direct_repo_evidence_is_unavailable: "Creation summary is based on project state.",
          },
        },
      ],
    },
    required_sections: ["Overview"],
    evidence_refs: [{ kind: "project_state", ref: "bootstrap_state" }],
    repo_citations: [],
    notes_for_apply: [],
  };
}

function maintenanceProposal(runDir: string) {
  return {
    schema_version: 1,
    project_key: "demo",
    mode: "maintain",
    packet_ref: { run_dir: runDir, artifact: "input-packet.json", packet_schema_version: 1 },
    packet_context: packetContext(),
    summary: "maintenance",
    items: [
      {
        id: "item_1",
        operation: "CREATE_ENTRY",
        target_page: { path: "setup/index.md", path_kind: "existing_wiki_page" },
        proposed_entry_id: "setup.cli",
        content_intent: "Document CLI setup command.",
        apply_payload: {
          schema_version: 1,
          entries: [
            {
              entry_id: "setup.cli",
              title: "Setup CLI",
              body: { paragraphs: ["Document CLI setup command."] },
              lifecycle: "active",
              evidence_refs: [{ kind: "project_state", ref: "project_memory" }],
              repo_citations: [
                { path: "src/commands/project.ts", line_start: 1, line_end: 20, reason: "CLI command registration" },
              ],
            },
          ],
        },
        source_packet_refs: [{ kind: "project_state", ref: "project_memory" }],
        evidence_refs: [{ kind: "project_state", ref: "project_memory" }],
        repo_citations: [{ path: "src/commands/project.ts", line_start: 1, line_end: 20, reason: "CLI command registration" }],
        applicability: { commands: ["myelin project learn demo"] },
        lifecycle_intent: "active",
        risk: lowRisk(),
        preconditions: ["setup page exists"],
        expected_outcome: "setup page changes",
      },
    ],
    noop_inputs: [],
    risk: lowRisk(),
  };
}

function packetContext() {
  return { degraded: false, degraded_reasons: [], budgets: { max_items: 25, max_content_chars: 4_000 } };
}

function lowRisk() {
  return { level: "low" as const, reasons: [], requires_quarantine: false };
}
