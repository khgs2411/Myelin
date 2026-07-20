import { expect, test } from "bun:test";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  assertMaintenanceReport,
  runProjectMemoryMaintenanceMode,
  type ProjectMemoryMaintenancePendingSource,
} from "../../src/project/project-memory-agent-maintenance-service.ts";

test("rejects duplicate dispositions for the same pending source", () => {
  const pending: ProjectMemoryMaintenancePendingSource[] = [{
    source_kind: "project_candidate",
    source_ref: "candidate-1",
    summary: "Candidate summary",
  }];
  const disposition = {
    source_kind: "project_candidate" as const,
    source_ref: "candidate-1",
    disposition: "already_covered" as const,
    reason: "Existing documentation covers it.",
    output_refs: ["wiki/runtime.md"],
  };

  expect(() => assertMaintenanceReport("demo", pending, {
    schema_version: 1,
    project_key: "demo",
    status: "completed",
    dispositions: [disposition, disposition],
    touched_paths: [],
    evidence_paths: [],
    known_gaps: [],
  })).toThrow("duplicate disposition for source: project_candidate:candidate-1");
});

test("fails closed for missing, unknown, and malformed dispositions", () => {
  const pending: ProjectMemoryMaintenancePendingSource[] = [{
    source_kind: "project_candidate",
    source_ref: "candidate-1",
    summary: "Candidate summary",
  }];
  const report = {
    schema_version: 1 as const,
    project_key: "demo",
    status: "completed" as const,
    dispositions: [],
    touched_paths: [],
    evidence_paths: [],
    known_gaps: [],
  };

  expect(() => assertMaintenanceReport("demo", pending, report))
    .toThrow("missing disposition for source: project_candidate:candidate-1");
  expect(() => assertMaintenanceReport("demo", pending, {
    ...report,
    dispositions: [{
      source_kind: "project_candidate",
      source_ref: "candidate-2",
      disposition: "already_covered",
      reason: "Covered.",
      output_refs: [],
    }],
  })).toThrow("references unknown source: project_candidate:candidate-2");
  expect(() => assertMaintenanceReport("demo", pending, {
    ...report,
    dispositions: [{
      source_kind: "project_candidate",
      source_ref: "candidate-1",
      disposition: "already_covered",
      reason: "",
      output_refs: [],
    }],
  })).toThrow("maintenance disposition reason is required");
});

test("requires every touched draft path to trace to an applied source", () => {
  const pending: ProjectMemoryMaintenancePendingSource[] = [{
    source_kind: "project_candidate",
    source_ref: "candidate-1",
    summary: "Candidate summary",
  }];
  const baseReport = {
    schema_version: 1 as const,
    project_key: "demo",
    status: "completed" as const,
    dispositions: [{
      source_kind: "project_candidate" as const,
      source_ref: "candidate-1",
      disposition: "applied_to_project_memory" as const,
      reason: "Updated the runtime contract.",
      output_refs: ["draft-wiki/runtime.md"],
    }],
    touched_paths: ["draft-wiki/runtime.md"],
    evidence_paths: ["target-repo/src/runtime.ts"],
    known_gaps: [],
  };

  expect(() => assertMaintenanceReport("demo", pending, {
    ...baseReport,
    touched_paths: ["draft-wiki/unrelated.md"],
  })).toThrow("applied output_ref is not listed in touched_paths: draft-wiki/runtime.md");

  expect(() => assertMaintenanceReport("demo", pending, {
    ...baseReport,
    touched_paths: [...baseReport.touched_paths, "draft-wiki/unrelated.md"],
  })).toThrow("touched draft path is not traced to an applied source: draft-wiki/unrelated.md");

  expect(() => assertMaintenanceReport("demo", pending, baseReport)).not.toThrow();
});

test("rejects non-document artifacts in maintenance touched paths", () => {
  const pending: ProjectMemoryMaintenancePendingSource[] = [{
    source_kind: "project_candidate",
    source_ref: "candidate-1",
    summary: "Candidate summary",
  }];
  expect(() => assertMaintenanceReport("demo", pending, {
    schema_version: 1,
    project_key: "demo",
    status: "completed",
    dispositions: [{
      source_kind: "project_candidate",
      source_ref: "candidate-1",
      disposition: "already_covered",
      reason: "Existing documentation covers it.",
      output_refs: [],
    }],
    touched_paths: ["reports/documentation-maintenance-report.json"],
    evidence_paths: [],
    known_gaps: [],
  })).toThrow("touched_paths must identify draft markdown only");
});

test("gives a live maintenance agent an authoritative report contract", async () => {
  const root = await mkdtemp(join(tmpdir(), "myelin-maintenance-root-"));
  const targetRepoDir = await mkdtemp(join(tmpdir(), "myelin-maintenance-target-"));
  const absoluteRunDir = join(root, "runs", "demo", "project-learn", "run-1");
  const baseWikiDir = join(absoluteRunDir, "pre-maintenance-wiki");
  await mkdir(baseWikiDir, { recursive: true });
  await writeFile(join(baseWikiDir, "index.md"), "# Demo\n", "utf8");
  await writeFile(join(targetRepoDir, "README.md"), "# Target\n", "utf8");

  const result = await runProjectMemoryMaintenanceMode({
    root,
    projectKey: "demo",
    runDir: "runs/demo/project-learn/run-1",
    absoluteRunDir,
    targetRepoDir,
    baseWikiDir,
    pendingSources: [{
      source_kind: "project_candidate",
      source_ref: "candidate-1",
      candidate_type: "project.architecture",
      summary: "Candidate summary",
      evidence: {
        observed_facts: ["The project layout changed."],
        relevant_paths: ["src/runtime/fs.ts"],
        uncertainties: [],
      },
      proposed_payload: {
        durable_facts: ["Canonical markdown lives under projects/<key>."],
        change_kind: "architecture.layout",
        suggested_subjects: ["runtime and project layout"],
        verification_needed: ["Verify path helpers."],
      },
    }],
    provider: "codex",
    runner: async (_command, options) => {
      const cwd = String(options?.cwd);
      const contract = JSON.parse(await readFile(
        join(cwd, "contracts", "project-memory-maintenance-report.schema.json"),
        "utf8",
      ));
      expect(contract.title).toBe("ProjectMemoryMaintenanceReport");
      expect(options?.stdin).toContain("contracts/project-memory-maintenance-report.schema.json");
      expect(options?.stdin).toContain('"observed_facts"');
      expect(options?.stdin).toContain('"durable_facts"');
      expect(options?.stdin).toContain("Attribute that evidence-bearing shape to the ingest provider-output schema and worker parser");
      expect(options?.stdin).toContain("Maintenance deliberately accepts legacy and runtime-inbox candidates");
      expect(options?.stdin).toContain('"candidate_type": "project.architecture"');
      expect(options?.stdin).toContain("relevant_paths, uncertainties, suggested_subjects, and verification_needed fields are required arrays but may be empty");
      expect(options?.stdin).toContain("another project or repository belongs_to_other_layer");
      expect(options?.stdin).toContain("do not perform unrelated cleanup");
      expect(options?.stdin).toContain("do not edit canonical prose solely to reconcile checkout snapshots");
      expect(options?.stdin).toContain("Do not include the maintenance report");
      expect(options?.stdin).toContain("Legacy candidates and handoffs may have empty evidence or proposed payloads");
      expect(options?.stdin).toContain("becomes covered by an update attributed to another source in the same pass");
      expect(options?.stdin).toContain("treat the source as stale and use already_covered or apply a correction");
      expect(options?.stdin).toContain("do not run repository test commands inside the isolated authoring workspace");
      expect(options?.stdin).toContain("An explicitly open product-policy decision is different from a stale factual claim");
      expect(options?.stdin).toContain("Do not promote a candidate's proposed known gap");
      expect(options?.stdin).toContain("classify the stale naming lead already_covered rather than deferred_unsafe_change");
      await mkdir(join(cwd, "reports"), { recursive: true });
      await writeFile(join(cwd, "reports", "documentation-maintenance-report.json"), JSON.stringify({
        schema_version: 1,
        project_key: "demo",
        status: "completed",
        dispositions: [{
          source_kind: "project_candidate",
          source_ref: "candidate-1",
          disposition: "already_covered",
          reason: "Existing documentation covers it.",
          output_refs: ["wiki/runtime.md"],
        }],
        touched_paths: [],
        evidence_paths: ["README.md"],
        known_gaps: [],
      }), "utf8");
      return { stdout: "done", stderr: "", exitCode: 0 };
    },
  });

  expect(result.status).toBe("completed");
  expect(result.source_consumptions).toHaveLength(1);
});

test("retries once with validation feedback and accepts a repaired report", async () => {
  const root = await mkdtemp(join(tmpdir(), "myelin-maintenance-root-"));
  const targetRepoDir = await mkdtemp(join(tmpdir(), "myelin-maintenance-target-"));
  const absoluteRunDir = join(root, "runs", "demo", "project-learn", "run-retry");
  const baseWikiDir = join(absoluteRunDir, "pre-maintenance-wiki");
  await mkdir(baseWikiDir, { recursive: true });
  await writeFile(join(baseWikiDir, "index.md"), "# Demo\n", "utf8");
  await writeFile(join(targetRepoDir, "README.md"), "# Target\n", "utf8");
  let calls = 0;
  const progress: Array<{ status: string; message?: string }> = [];

  const result = await runProjectMemoryMaintenanceMode({
    root,
    projectKey: "demo",
    runDir: "runs/demo/project-learn/run-retry",
    absoluteRunDir,
    targetRepoDir,
    baseWikiDir,
    pendingSources: [{
      source_kind: "project_candidate",
      source_ref: "candidate-1",
      summary: "Candidate summary",
    }],
    provider: "codex",
    progress: (event) => progress.push(event),
    runner: async (_command, options) => {
      calls += 1;
      const cwd = String(options?.cwd);
      await mkdir(join(cwd, "reports"), { recursive: true });
      if (calls === 1) {
        await writeFile(join(cwd, "reports", "documentation-maintenance-report.json"), JSON.stringify({
          schema_version: 1,
          project_key: "demo",
          status: "completed",
          dispositions: [{
            source_kind: "project_candidate",
            source_ref: "candidate-1",
            disposition: "applied_to_project_memory",
            reason: "Incorrectly used evidence as an output.",
            output_refs: ["repository-identity.json"],
          }],
          touched_paths: [],
          evidence_paths: ["repository-identity.json"],
          known_gaps: [],
        }), "utf8");
      } else {
        expect(options?.stdin).toContain("bounded retry");
        expect(options?.stdin).toContain("applied output_ref is not listed in touched_paths: repository-identity.json");
        await writeFile(join(cwd, "reports", "documentation-maintenance-report.json"), JSON.stringify({
          schema_version: 1,
          project_key: "demo",
          status: "completed",
          dispositions: [{
            source_kind: "project_candidate",
            source_ref: "candidate-1",
            disposition: "already_covered",
            reason: "Existing documentation covers it.",
            output_refs: ["draft-wiki/index.md"],
          }],
          touched_paths: [],
          evidence_paths: ["repository-identity.json"],
          known_gaps: [],
        }), "utf8");
      }
      return { stdout: "done", stderr: "", exitCode: 0 };
    },
  });

  expect(calls).toBe(2);
  expect(result.status).toBe("completed");
  expect(progress.some((event) => event.status === "progress" && event.message?.includes("retrying"))).toBe(true);
});

test("identifies the invalid report artifact and contract", async () => {
  const root = await mkdtemp(join(tmpdir(), "myelin-maintenance-root-"));
  const targetRepoDir = await mkdtemp(join(tmpdir(), "myelin-maintenance-target-"));
  const absoluteRunDir = join(root, "runs", "demo", "project-learn", "run-2");
  const baseWikiDir = join(absoluteRunDir, "pre-maintenance-wiki");
  await mkdir(baseWikiDir, { recursive: true });
  await writeFile(join(baseWikiDir, "index.md"), "# Demo\n", "utf8");

  const result = await runProjectMemoryMaintenanceMode({
    root,
    projectKey: "demo",
    runDir: "runs/demo/project-learn/run-2",
    absoluteRunDir,
    targetRepoDir,
    baseWikiDir,
    pendingSources: [{ source_kind: "project_candidate", source_ref: "candidate-1", summary: "Candidate" }],
    provider: "codex",
    runner: async (_command, options) => {
      const cwd = String(options?.cwd);
      await mkdir(join(cwd, "reports"), { recursive: true });
      await writeFile(join(cwd, "reports", "documentation-maintenance-report.json"), JSON.stringify({
        project: "demo",
        sources: [],
      }), "utf8");
      return { stdout: "done", stderr: "", exitCode: 0 };
    },
  });

  expect(result.status).toBe("failed");
  expect(result.error).toContain("agents/maintenance/reports/documentation-maintenance-report.json");
  expect(result.error).toContain("agents/maintenance/contracts/project-memory-maintenance-report.schema.json");
  expect(result.error).toContain("schema_version must be 1");
});
