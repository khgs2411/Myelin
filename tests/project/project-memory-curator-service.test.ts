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
  const service = new ProjectMemoryCuratorService(root, completedRetrievalDeps());

  const result = await service.runProjectLearn({
    projectKey: "demo",
    dryRun: false,
    review: false,
    now: new Date("2026-06-23T10:00:00.000Z"),
    runner: async (command, options) => {
      if (options?.stdin?.includes("auditing first-create Project Memory usefulness")) {
        expect(command).toContain("--output-schema");
        expect(command).toContain(join(root, "projects", "demo", "runs", "project-learn", "2026-06-23T10-00-00.000Z-run", "project-memory-usefulness-critique-contract.json"));
        expect(options.stdin).toContain("project-memory-evidence-map.json");
        expect(options.stdin).toContain("--- index.md ---");
        return {
          exitCode: 0,
          stdout: JSON.stringify(usefulnessCritique("pass")),
          stderr: "",
        };
      }
      expect(command).toContain("--output-schema");
      expect(command).toContain(join(root, "projects", "demo", "runs", "project-learn", "2026-06-23T10-00-00.000Z-run", "curator-output-contract.json"));
      expect(options?.stdin).toContain("curator-output-contract.json");
      expect(options?.stdin).toContain("project-memory-evidence-map.json");
      expect(await Bun.file(join(root, "projects", "demo", "runs", "project-learn", "2026-06-23T10-00-00.000Z-run", "project-memory-evidence-map.json")).exists()).toBe(true);
      return {
        exitCode: 0,
        stdout: JSON.stringify(creationDraft("projects/demo/runs/project-learn/2026-06-23T10-00-00.000Z-run")),
        stderr: "",
      };
    },
  });

  expect(result.status).toBe("completed");
  expect(result.mode).toBe("create");
  expect(result.stopped_before_writes).toBe(false);
  expect(result.artifacts.input_packet).toBe("input-packet.json");
  expect(result.artifacts.curator_output_contract).toBe("curator-output-contract.json");
  expect(result.artifacts.prompt_budget).toBe("prompt-budget.json");
  expect(result.artifacts.evidence_map).toBe("project-memory-evidence-map.json");
  expect(result.artifacts.usefulness_critique).toBe("project-memory-usefulness-critique.json");
  expect(result.artifacts.curator_output).toBe("curator-creation-draft.json");
  expect(result.content_quality_status).toBe("trusted");
  expect(result.retrieval_readiness_status).toBe("ready");
  expect(result.quality_diagnostics_ref).toBe("curator-validation.json");
  expect(result.artifacts.apply_journal).toBe("project-memory-apply-journal.json");
  expect(result.artifacts.apply_result).toBe("project-memory-apply-result.json");
  expect(result.artifacts.changeset).toBe("project-memory-changeset.json");
  expect(await Bun.file(join(root, result.run_dir, "curator-validation.json")).exists()).toBe(true);
  expect(await Bun.file(join(root, result.run_dir, "curator-output-contract.json")).exists()).toBe(true);
  expect(await Bun.file(join(root, result.run_dir, "curator-run-result.json")).exists()).toBe(true);
  expect(await Bun.file(join(root, result.run_dir, "prompt-budget.json")).exists()).toBe(true);
  expect(await Bun.file(join(root, result.run_dir, "project-memory-evidence-map.json")).exists()).toBe(true);
  expect(await Bun.file(join(root, result.run_dir, "project-memory-usefulness-critique.json")).exists()).toBe(true);
  expect(await Bun.file(join(root, result.run_dir, "summary.md")).exists()).toBe(true);
  expect(await readFile(join(root, "projects", "demo", "wiki", "index.md"), "utf8")).toContain("# Demo");
  expect(await readFile(join(root, "projects", "demo", "wiki", "runtime.md"), "utf8")).toContain("# Runtime");
  const state = JSON.parse(await readFile(join(root, "projects", "demo", "state", "project-memory.json"), "utf8"));
  expect(state).toMatchObject({
    status: "curated",
    retrieval_readiness: {
      status: "ready",
      checked_at: "2026-06-23T10:00:00.000Z",
      reason: null,
    },
  });
});

test("runs maintain mode and applies eligible low-risk maintenance output", async () => {
  await seedProject("curated");
  seedMemoryDb();
  await mkdir(join(root, "projects", "demo", "wiki", "setup"), { recursive: true });
  await writeFile(join(root, "projects", "demo", "wiki", "setup", "index.md"), "# Setup\n", "utf8");
  await seedSchema();
  const service = new ProjectMemoryCuratorService(root, completedRetrievalDeps());

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

test("returns completed_with_pending_index when apply succeeds but retrieval indexing remains pending", async () => {
  await seedProject("uncurated");
  seedMemoryDb();
  await seedSchema();
  const service = new ProjectMemoryCuratorService(root, pendingRetrievalDeps());

  const result = await service.runProjectLearn({
    projectKey: "demo",
    dryRun: false,
    review: false,
    now: new Date("2026-06-28T10:00:00.000Z"),
    runner: async (_command, options) => ({
      exitCode: 0,
      stdout: JSON.stringify(
        options?.stdin?.includes("auditing first-create Project Memory usefulness")
          ? usefulnessCritique("pass")
          : creationDraft("projects/demo/runs/project-learn/2026-06-28T10-00-00.000Z-run"),
      ),
      stderr: "",
    }),
  });

  expect(result.status).toBe("completed_with_pending_index");
  expect(result.content_quality_status).toBe("trusted");
  expect(result.retrieval_readiness_status).toBe("pending");
  expect(result.stopped_before_writes).toBe(false);
  expect(result.stopped_reason).toContain("mandatory hint generation failed");
  expect(result.artifacts.retrieval_index_result).toBe("project-memory-retrieval-index-result.json");
  const state = JSON.parse(await readFile(join(root, "projects", "demo", "state", "project-memory.json"), "utf8"));
  expect(state).toMatchObject({
    status: "curated",
    retrieval_readiness: {
      status: "pending",
      checked_at: "2026-06-28T10:00:00.000Z",
      reason: "mandatory hint generation failed",
    },
  });
});

test("returns needs_review before writes for shallow quality diagnostics", async () => {
  await seedProject("uncurated");
  seedMemoryDb();
  await seedSchema();
  const service = new ProjectMemoryCuratorService(root, pendingRetrievalDeps());

  const result = await service.runProjectLearn({
    projectKey: "demo",
    dryRun: false,
    review: false,
    now: new Date("2026-06-28T10:15:00.000Z"),
    runner: async () => ({
      exitCode: 0,
      stdout: JSON.stringify({
        ...creationDraft("projects/demo/runs/project-learn/2026-06-28T10-15-00.000Z-run"),
        quality_diagnostics: qualityDiagnostics("create", "shallow"),
      }),
      stderr: "",
    }),
  });

  expect(result.status).toBe("needs_review");
  expect(result.stopped_before_writes).toBe(true);
  expect(result.stopped_reason).toBe("Project Memory content quality is not trusted");
  expect(result.content_quality_status).toBe("shallow");
  expect(await Bun.file(join(root, "projects", "demo", "wiki", "runtime.md")).exists()).toBe(false);
  const state = JSON.parse(await readFile(join(root, "projects", "demo", "state", "project-memory.json"), "utf8"));
  expect(state).toMatchObject({
    status: "shallow",
    quality_contract_version: "answer-domain-v1",
    latest_create_run_ref: "projects/demo/runs/project-learn/2026-06-28T10-15-00.000Z-run",
    evidence_map_ref: "project-memory-evidence-map.json",
    validation_diagnostics_ref: "curator-validation.json",
  });
  expect(state.usefulness_critique_ref).toBeUndefined();
});

test("returns needs_review before writes when create usefulness critique is review_only", async () => {
  await seedProject("uncurated");
  seedMemoryDb();
  await seedSchema();
  const service = new ProjectMemoryCuratorService(root, completedRetrievalDeps());

  const result = await service.runProjectLearn({
    projectKey: "demo",
    dryRun: false,
    review: false,
    now: new Date("2026-06-28T10:20:00.000Z"),
    runner: async (_command, options) => ({
      exitCode: 0,
      stdout: JSON.stringify(
        options?.stdin?.includes("auditing first-create Project Memory usefulness")
          ? usefulnessCritique("review_only", "useful but needs human review")
          : creationDraft("projects/demo/runs/project-learn/2026-06-28T10-20-00.000Z-run"),
      ),
      stderr: "",
    }),
  });

  expect(result.status).toBe("needs_review");
  expect(result.stopped_before_writes).toBe(true);
  expect(result.stopped_reason).toContain("Project Memory usefulness critique returned review_only");
  expect(result.artifacts.usefulness_critique).toBe("project-memory-usefulness-critique.json");
  expect(await Bun.file(join(root, "projects", "demo", "wiki", "runtime.md")).exists()).toBe(false);
  const state = JSON.parse(await readFile(join(root, "projects", "demo", "state", "project-memory.json"), "utf8"));
  expect(state).toMatchObject({
    status: "review_only",
    evidence_map_ref: "project-memory-evidence-map.json",
    validation_diagnostics_ref: "curator-validation.json",
    usefulness_critique_ref: "project-memory-usefulness-critique.json",
  });
});

test("returns needs_review before writes when create usefulness critique fails", async () => {
  await seedProject("uncurated");
  seedMemoryDb();
  await seedSchema();
  const service = new ProjectMemoryCuratorService(root, completedRetrievalDeps());

  const result = await service.runProjectLearn({
    projectKey: "demo",
    dryRun: false,
    review: false,
    now: new Date("2026-06-28T10:25:00.000Z"),
    runner: async (_command, options) => ({
      exitCode: 0,
      stdout: JSON.stringify(
        options?.stdin?.includes("auditing first-create Project Memory usefulness")
          ? usefulnessCritique("fail", "too generic")
          : creationDraft("projects/demo/runs/project-learn/2026-06-28T10-25-00.000Z-run"),
      ),
      stderr: "",
    }),
  });

  expect(result.status).toBe("needs_review");
  expect(result.stopped_before_writes).toBe(true);
  expect(result.stopped_reason).toContain("Project Memory usefulness critique returned fail");
  expect(result.artifacts.usefulness_critique).toBe("project-memory-usefulness-critique.json");
  expect(await Bun.file(join(root, "projects", "demo", "wiki", "runtime.md")).exists()).toBe(false);
  const state = JSON.parse(await readFile(join(root, "projects", "demo", "state", "project-memory.json"), "utf8"));
  expect(state).toMatchObject({
    status: "blocked",
    evidence_map_ref: "project-memory-evidence-map.json",
    validation_diagnostics_ref: "curator-validation.json",
    usefulness_critique_ref: "project-memory-usefulness-critique.json",
  });
});

test("returns completed when apply and retrieval indexing succeed", async () => {
  await seedProject("uncurated");
  seedMemoryDb();
  await seedSchema();
  const service = new ProjectMemoryCuratorService(root, completedRetrievalDeps());

  const result = await service.runProjectLearn({
    projectKey: "demo",
    dryRun: false,
    review: false,
    now: new Date("2026-06-28T10:30:00.000Z"),
    runner: async (_command, options) => ({
      exitCode: 0,
      stdout: JSON.stringify(
        options?.stdin?.includes("auditing first-create Project Memory usefulness")
          ? usefulnessCritique("pass")
          : creationDraft("projects/demo/runs/project-learn/2026-06-28T10-30-00.000Z-run"),
      ),
      stderr: "",
    }),
  });

  expect(result.status).toBe("completed");
  expect(result.retrieval_readiness_status).toBe("ready");
  expect(result.artifacts.retrieval_index_result).toBe("project-memory-retrieval-index-result.json");
  const state = JSON.parse(await readFile(join(root, "projects", "demo", "state", "project-memory.json"), "utf8"));
  expect(state.retrieval_readiness).toMatchObject({
    status: "ready",
    checked_at: "2026-06-28T10:30:00.000Z",
    reason: null,
  });
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
  const service = new ProjectMemoryCuratorService(root, completedRetrievalDeps());

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
      expect(options?.cwd).toBe(join(root, "repos", "demo"));
      expect(options?.stdin).toContain("Read input-packet.json before answering.");
      expect(options?.stdin).toContain("Read curator-output-contract.json before answering.");
      expect(options?.stdin).toContain(
        `Absolute path: ${join(root, "projects", "demo", "runs", "project-learn", "2026-06-25T11-00-00.000Z-run", "input-packet.json")}`,
      );
      expect(options?.stdin).toContain(
        `Absolute path: ${join(root, "projects", "demo", "runs", "project-learn", "2026-06-25T11-00-00.000Z-run", "curator-output-contract.json")}`,
      );
      expect(options?.stdin).toContain("You are running from the target repository cwd");
      expect(options?.stdin).toContain("Do not run broad repository searches.");
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
  expect(result.artifacts.curator_output_contract).toBe("curator-output-contract.json");
  const packetArtifact = await readFile(join(root, result.run_dir, "input-packet.json"), "utf8");
  expect(packetArtifact).toContain("Runtime inbox intake should enter the Project Memory packet.");
  expect(packetArtifact).toContain("project.inbox");
  const intakeArtifact = JSON.parse(await readFile(join(root, result.run_dir, "runtime-inbox-intake.json"), "utf8"));
  expect(intakeArtifact.created_candidate_ids).toEqual(["project_inbox:demo:2026-06-25T10-00-00Z_a1b2c3"]);
});

test("applies fallback advisory no-op as source consumption without treating the packet as degraded", async () => {
  await seedProject("curated");
  seedMemoryDb();
  seedPendingCandidate("cand_1");
  await mkdir(join(root, "projects", "demo", "wiki", "setup"), { recursive: true });
  await writeFile(join(root, "projects", "demo", "wiki", "setup", "index.md"), "# Setup\nDocument setup.\n", "utf8");
  await seedSchema();
  const service = new ProjectMemoryCuratorService(root);
  const runDir = "projects/demo/runs/project-learn/2026-06-25T12-00-00.000Z-run";

  const result = await service.runProjectLearn({
    projectKey: "demo",
    dryRun: false,
    review: false,
    now: new Date("2026-06-25T12:00:00.000Z"),
    runner: async () => {
      const packet = JSON.parse(await readFile(join(root, runDir, "input-packet.json"), "utf8"));
      expect(packet.degraded).toBe(false);
      expect(packet.lookup.results[0]?.lookup_quality).toBe("fallback");
      return {
        exitCode: 0,
        stdout: JSON.stringify(explicitNoopProposal(runDir, packet.lookup.results[0].id)),
        stderr: "",
      };
    },
  });

  expect(result.status).toBe("completed");
  expect(result.validation_ok).toBe(true);
  expect(result.stopped_before_writes).toBe(false);
  expect(result.applied_item_ids).toEqual([]);
  expect(result.source_consumptions).toEqual(["project_candidate:cand_1"]);
  expect(result.changed_files).toEqual(["projects/demo/state/project-memory-source-consumptions.json"]);
  const sourceState = JSON.parse(await readFile(join(root, "projects", "demo", "state", "project-memory-source-consumptions.json"), "utf8"));
  expect(sourceState.records[0]).toMatchObject({
    source_ref: "cand_1",
    source_kind: "project_candidate",
    terminal_decision: "already_trusted",
  });
});

test("requires review for maintenance writes depending on fallback lookup", async () => {
  await seedProject("curated");
  seedMemoryDb();
  seedPendingCandidate("cand_1");
  await mkdir(join(root, "projects", "demo", "wiki", "setup"), { recursive: true });
  await writeFile(join(root, "projects", "demo", "wiki", "setup", "index.md"), "# Setup\nDocument setup.\n", "utf8");
  await seedSchema();
  const service = new ProjectMemoryCuratorService(root);
  const runDir = "projects/demo/runs/project-learn/2026-06-25T12-30-00.000Z-run";

  const result = await service.runProjectLearn({
    projectKey: "demo",
    dryRun: false,
    review: false,
    now: new Date("2026-06-25T12:30:00.000Z"),
    runner: async () => {
      const packet = JSON.parse(await readFile(join(root, runDir, "input-packet.json"), "utf8"));
      const proposal = maintenanceProposal(runDir);
      (proposal.items[0] as Record<string, unknown>).evidence_dependencies = [
        { kind: "lookup_result", ref: packet.lookup.results[0].id, required_for: "dedupe" },
      ];
      return {
        exitCode: 0,
        stdout: JSON.stringify(proposal),
        stderr: "",
      };
    },
  });

  expect(result.status).toBe("needs_review");
  expect(result.validation_ok).toBe(false);
  expect(result.stopped_reason).toBe("curator validation did not produce eligible output");
  expect(await readFile(join(root, "projects", "demo", "wiki", "setup", "index.md"), "utf8")).not.toContain('id="setup.cli"');
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
    quality_diagnostics: qualityDiagnostics("maintain"),
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
    runner: async () => ({
      exitCode: 2,
      stdout: "",
      stderr: [
        "large transcript prefix",
        "ERROR: Selected model is at capacity. Please try a different model.",
        "large transcript body ".repeat(500),
        "tokens used",
        "87,670",
      ].join("\n"),
    }),
  });

  expect(result.status).toBe("failed");
  expect(result.validation_ok).toBe(false);
  expect(result.failure_kind).toBe("provider_failed_before_output");
  const stoppedReason = result.stopped_reason ?? "";
  expect(stoppedReason).toContain("provider invocation failed before curator output");
  expect(stoppedReason).toContain("Selected model is at capacity");
  expect(stoppedReason).toContain("tokens used 87,670");
  expect(stoppedReason.length).toBeLessThan(400);
  expect(stoppedReason).not.toContain("large transcript body");
  expect(result.artifacts.curator_output).toBe("curator-output-error.json");
  expect(result.artifacts.prompt_budget).toBe("prompt-budget.json");
  expect(await Bun.file(join(root, result.run_dir, "input-packet.json")).exists()).toBe(true);
  expect(await Bun.file(join(root, result.run_dir, "prompt-budget.json")).exists()).toBe(true);
  expect(await Bun.file(join(root, result.run_dir, "curator-output-contract.json")).exists()).toBe(true);
  expect(await Bun.file(join(root, result.run_dir, "curator-output-error.json")).exists()).toBe(true);
  expect(await Bun.file(join(root, result.run_dir, "curator-validation.json")).exists()).toBe(true);
  const errorArtifact = JSON.parse(await readFile(join(root, result.run_dir, "curator-output-error.json"), "utf8"));
  const validation = JSON.parse(await readFile(join(root, result.run_dir, "curator-validation.json"), "utf8"));
  const summary = await readFile(join(root, result.run_dir, "summary.md"), "utf8");
  expect(errorArtifact.failure_kind).toBe("provider_failed_before_output");
  expect(validation.global_findings[0].category).toBe("provider");
  expect(validation.global_findings[0].code).toBe("provider_failed_before_output");
  expect(summary).toContain("failure_kind: provider_failed_before_output");
  expect(summary).toContain("curator_output_status: not_produced");
  expect(summary).toContain("apply_stage: not_reached");
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
  expect(result.failure_kind).toBe("curator_output_invalid_json");
  expect(result.stopped_reason).toContain("curator output was not valid JSON");
  const validation = JSON.parse(await readFile(join(root, result.run_dir, "curator-validation.json"), "utf8"));
  expect(validation.global_findings[0].code).toBe("curator_output_invalid_json");
  expect(await Bun.file(join(root, result.run_dir, "curator-run-result.json")).exists()).toBe(true);
  expect(await Bun.file(join(root, result.run_dir, "summary.md")).exists()).toBe(true);
});

test("summarizes structured provider errors without collapsing JSON stderr", async () => {
  await seedProject("curated");
  await seedSchema();
  const service = new ProjectMemoryCuratorService(root);

  const result = await service.runProjectLearn({
    projectKey: "demo",
    dryRun: false,
    review: false,
    now: new Date("2026-06-23T12:45:00.000Z"),
    runner: async () => ({
      exitCode: 1,
      stdout: "",
      stderr: [
        "ERROR: {",
        '  "error": {',
        '    "message": "Invalid schema for response_format final: every property must be required.",',
        '    "type": "invalid_request_error",',
        '    "param": "response_format"',
        "  }",
        "}",
      ].join("\n"),
    }),
  });

  expect(result.status).toBe("failed");
  expect(result.failure_kind).toBe("provider_failed_before_output");
  expect(result.stopped_reason).toContain("Invalid schema for response_format final");
  expect(result.stopped_reason).toContain("type=invalid_request_error");
  expect(result.stopped_reason).toContain("param=response_format");
  expect(result.stopped_reason).not.toContain("ERROR: {");
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
  await writeFile(join(root, "projects", "demo", "wiki", "index.md"), "# Demo\n", "utf8");
  await seedRepoEvidence(repoPath);
}

async function seedRepoEvidence(repoPath: string): Promise<void> {
  await mkdir(join(repoPath, "src", "memory"), { recursive: true });
  await mkdir(join(repoPath, "src", "commands"), { recursive: true });
  await mkdir(join(repoPath, "src", "project"), { recursive: true });
  await mkdir(join(repoPath, "docs", "adr"), { recursive: true });
  await writeFile(join(repoPath, "MY_VISION.md"), "Project Memory is living repo documentation from Session Memory leads.\n", "utf8");
  await writeFile(join(repoPath, "docs", "ROADMAP.md"), "Step 5 Step 6 ADR roadmap decisions.\n", "utf8");
  await writeFile(join(repoPath, "src", "memory", "db.ts"), "state/memory.db sqlite session_memories project memory retrieval embeddings\n", "utf8");
  await writeFile(join(repoPath, "src", "commands", "project.ts"), "project learn memory query memory index session memory inbox intake\n", "utf8");
  await writeFile(join(repoPath, "src", "project", "project-memory-curator-service.ts"), "validateCuratorOutput applyCreationDraft curator-validation.json project-memory-changeset.json\n", "utf8");
  await writeFile(join(repoPath, "src", "project", "project-memory-candidate-intake-service.ts"), "project_candidate project_handoff lead source_event_refs producer_kind\n", "utf8");
  await writeFile(join(repoPath, "docs", "adr", "0063-use-answer-domain-project-memory-documentation-map.md"), "ADR answer domain map\n", "utf8");
  await writeFile(join(repoPath, "docs", "adr", "0064-use-two-pass-project-memory-evidence-workflow.md"), "ADR evidence workflow\n", "utf8");
  await writeFile(join(repoPath, "docs", "adr", "0065-require-independent-first-create-usefulness-critique.md"), "ADR usefulness critique\n", "utf8");
  await writeFile(join(repoPath, "docs", "adr", "0066-allow-clean-project-shell-rebootstrap-reset.md"), "ADR reset\n", "utf8");
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

function seedPendingCandidate(id: string): void {
  const db = openMemoryDb(root);
  try {
    createMemoryCandidate(db, {
      id,
      project_key: "demo",
      scope: "project",
      status: "pending",
      candidate_type: "project.fact",
      title: "Setup",
      summary: "Document setup.",
      source_event_refs: ["evt_1"],
      evidence: {},
      proposed_payload: {},
      confidence: "medium",
      risk: "low",
      reason: "durable",
      now: "2026-06-25T11:50:00.000Z",
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

function explicitNoopProposal(runDir: string, lookupRef: string) {
  return {
    schema_version: 1,
    project_key: "demo",
    mode: "maintain",
    packet_ref: { run_dir: runDir, artifact: "input-packet.json", packet_schema_version: 1 },
    packet_context: packetContext(),
    summary: "Existing memory already covers the candidate.",
    quality_diagnostics: qualityDiagnostics("maintain"),
    items: [],
    noop_inputs: [],
    explicit_noop_decisions: [
      {
        id: "noop_1",
        source_packet_refs: [{ kind: "project_candidate", ref: "cand_1", required_for: "noop_support" }],
        checked_existing_memory_refs: [{ kind: "lookup_result", ref: lookupRef, required_for: "noop_support" }],
        reason: "already_trusted",
        explanation: "Existing setup memory covers the candidate.",
      },
    ],
    risk: lowRisk(),
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
    quality_diagnostics: qualityDiagnostics("create"),
    documentation_contract: documentationContract(),
    brain_intent: {
      name: "Demo",
      first_brain_summary: "Create first brain",
      untrusted_existing_markdown_policy: "adopt",
    },
    pages: [
      creationPage("page_index", "index.md", "Demo", "Project Memory index", "orientation_index"),
      creationPage("page_product", "product.md", "Product", "Product and memory model", "product_memory_model"),
      creationPage("page_runtime", "runtime.md", "Runtime", "Runtime workflows", "runtime_workflows"),
      creationPage("page_architecture", "architecture.md", "Architecture", "Architecture and data flow", "architecture_data_flow"),
      creationPage("page_roadmap", "roadmap.md", "Roadmap", "Current work and roadmap", "current_work_roadmap"),
      creationPage("page_decisions", "decisions.md", "Decisions", "Decisions and terms", "decisions_terms"),
    ],
    state_intent: { mark_project_memory_curated: true, freshness_intent: "initialize" },
    evidence_refs: [{ kind: "project_state", ref: "bootstrap_state" }],
    repo_citations: [],
    risk: lowRisk(),
  };
}

function documentationContract() {
  return {
    inspected_default_surfaces: ["docs/ROADMAP.md", "docs/adr/", "src/memory/", "src/project/", "src/commands/"],
    curator_added_surfaces: [],
    missing_orientation_surfaces: [],
    missing_coverage: [],
    shallow_summary_findings: [],
  };
}

function creationPage(
  id: string,
  path: string,
  title: string,
  purpose: string,
  role:
    | "orientation_index"
    | "product_memory_model"
    | "runtime_workflows"
    | "architecture_data_flow"
    | "current_work_roadmap"
    | "decisions_terms",
) {
  return {
    id,
    target: { path, path_kind: "new_wiki_page" },
    title,
    purpose,
    role,
    answer_domains: [answerDomainForRole(role)],
    required_topics: ["Overview", "Details"],
    representative_questions: [`How does ${title} work?`],
    content_intent: `Create ${title}`,
    apply_payload: {
      schema_version: 1,
      pages: [
        {
          page_path: path,
          title,
          purpose,
          body: { paragraphs: [`${title} describes ${purpose}. `.repeat(20)] },
          sections: [
            {
              heading: "Overview",
              level: 2,
              body: { paragraphs: [domainBody(answerDomainForRole(role), "Overview")] },
              evidence_refs: [{ kind: "project_state", ref: "bootstrap_state" }],
              repo_citations: [repoCitation()],
              inference: {
                label: "initial_project_memory",
                why_direct_repo_evidence_is_unavailable: "Creation summary is based on project state.",
              },
            },
            {
              heading: "Details",
              level: 2,
              body: { paragraphs: [domainBody(answerDomainForRole(role), "Details")] },
              evidence_refs: [{ kind: "project_state", ref: "bootstrap_state" }],
              repo_citations: [repoCitation()],
              inference: {
                label: "initial_project_memory",
                why_direct_repo_evidence_is_unavailable: "Creation summary is based on project state.",
              },
            },
          ],
          evidence_refs: [{ kind: "project_state", ref: "bootstrap_state" }],
          repo_citations: [repoCitation()],
          inference: {
            label: "initial_project_memory",
            why_direct_repo_evidence_is_unavailable: "Creation summary is based on project state.",
          },
        },
      ],
    },
    required_sections: ["Overview", "Details"],
    inspected_surface_refs: ["README.md"],
    evidence_refs: [{ kind: "project_state", ref: "bootstrap_state" }],
    repo_citations: [repoCitation()],
    notes_for_apply: [],
  };
}

function repoCitation() {
  return { path: "README.md", line_start: 1, line_end: 5, reason: "Project overview" };
}

function maintenanceProposal(runDir: string) {
  return {
    schema_version: 1,
    project_key: "demo",
    mode: "maintain",
    packet_ref: { run_dir: runDir, artifact: "input-packet.json", packet_schema_version: 1 },
    packet_context: packetContext(),
    summary: "maintenance",
    quality_diagnostics: qualityDiagnostics("maintain"),
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

function qualityDiagnostics(mode: "create" | "maintain", status: "trusted" | "review_only" | "shallow" | "blocked" = "trusted") {
  const role_coverage = mode === "create"
    ? [
        "orientation_index",
        "product_memory_model",
        "runtime_workflows",
        "architecture_data_flow",
        "current_work_roadmap",
        "decisions_terms",
      ].map((role) => ({
        role,
        page_ref: `${role}.md`,
        sections_seen: 2,
        citations_seen: 1,
        body_chars_seen: 500,
      }))
    : [];
  return {
    schema_version: 1,
    content_quality: { status, reasons: status === "trusted" ? [] : [`${status} fixture`] },
    retrieval_readiness: { status: "not_applicable", reason: null },
    domain_coverage: answerDomainCoverage(),
    role_coverage,
    candidate_dispositions: [],
    missing_coverage: status === "shallow" ? ["shallow fixture"] : [],
    shallow_summary_findings: [],
    answerability_findings: [],
  };
}

function answerDomainCoverage() {
  return [
    "product_memory_model",
    "storage_retrieval",
    "command_workflows",
    "curation_apply_lifecycle",
    "evidence_provenance_candidates",
    "current_work_roadmap_decisions",
  ].map((domain) => ({
    domain,
    page_refs: [`${domain}.md`],
    section_refs: [`${domain}/overview`],
    representative_questions: [`How does ${domain} work?`],
    citations_seen: 1,
    body_chars_seen: 500,
    missing_topics: [],
  }));
}

function answerDomainForRole(role: string) {
  const map: Record<string, string> = {
    orientation_index: "product_memory_model",
    product_memory_model: "storage_retrieval",
    runtime_workflows: "command_workflows",
    architecture_data_flow: "curation_apply_lifecycle",
    current_work_roadmap: "evidence_provenance_candidates",
    decisions_terms: "current_work_roadmap_decisions",
  };
  return map[role] ?? "product_memory_model";
}

function domainBody(domain: string, label: "Overview" | "Details"): string {
  return [
    `${label} for ${domain} explains how Myelin turns Project Memory into living repo documentation with cited markdown pages.`,
    `The ${domain} section distinguishes Session Memory continuity from curated Project Memory truth so candidates stay leads until repo evidence supports them.`,
    `For ${domain}, state/memory.db, sqlite, session_memories, embeddings, and derived markdown retrieval rows are named as separate storage and serving concepts.`,
    `The ${domain} workflow names project learn, memory query, memory index session, memory index project, memory inbox create, and memory inbox intake as operator surfaces.`,
    `The ${domain} lifecycle describes curator output, deterministic validation, apply journals, project-memory-changeset.json, retrieval sections, hint generation, and canonical markdown writes.`,
    `The ${domain} evidence trail points future agents to ROADMAP, ADR decisions, source files, and tests instead of letting generic prose stand in for documentation.`,
  ].join(" ");
}

function packetContext() {
  return { degraded: false, degraded_reasons: [], budgets: { max_items: 25, max_content_chars: 4_000 } };
}

function lowRisk() {
  return { level: "low" as const, reasons: [], requires_quarantine: false };
}

function usefulnessCritique(verdict: "pass" | "review_only" | "fail", reason = "useful Project Memory") {
  return {
    schema_version: 1,
    project_key: "demo",
    verdict,
    reasons: [reason],
    weak_sections: [],
    evidence_map_ref: "project-memory-evidence-map.json",
    rendered_markdown_refs: ["index.md", "product.md", "runtime.md", "architecture.md", "roadmap.md", "decisions.md"],
  };
}

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

function pendingRetrievalDeps() {
  return {
    retrievalLifecycle: {
      async afterProjectMemoryApply() {
        return {
          status: "pending" as const,
          artifacts: {
            retrieval_sections: "project-memory-retrieval-sections.json" as const,
            hint_generation: "project-memory-hint-generation-result.json" as const,
            retrieval_index_result: "project-memory-retrieval-index-result.json" as const,
          },
          degraded_reason: "mandatory hint generation failed",
        };
      },
    },
  };
}
