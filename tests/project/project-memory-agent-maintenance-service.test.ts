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

test("gives a live maintenance agent an authoritative report contract", async () => {
  const root = await mkdtemp(join(tmpdir(), "myelin-maintenance-root-"));
  const targetRepoDir = await mkdtemp(join(tmpdir(), "myelin-maintenance-target-"));
  const absoluteRunDir = join(root, "projects", "demo", "runs", "project-learn", "run-1");
  const baseWikiDir = join(absoluteRunDir, "pre-maintenance-wiki");
  await mkdir(baseWikiDir, { recursive: true });
  await writeFile(join(baseWikiDir, "index.md"), "# Demo\n", "utf8");
  await writeFile(join(targetRepoDir, "README.md"), "# Target\n", "utf8");

  const result = await runProjectMemoryMaintenanceMode({
    root,
    projectKey: "demo",
    runDir: "projects/demo/runs/project-learn/run-1",
    absoluteRunDir,
    targetRepoDir,
    baseWikiDir,
    pendingSources: [{
      source_kind: "project_candidate",
      source_ref: "candidate-1",
      summary: "Candidate summary",
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

test("identifies the invalid report artifact and contract", async () => {
  const root = await mkdtemp(join(tmpdir(), "myelin-maintenance-root-"));
  const targetRepoDir = await mkdtemp(join(tmpdir(), "myelin-maintenance-target-"));
  const absoluteRunDir = join(root, "projects", "demo", "runs", "project-learn", "run-2");
  const baseWikiDir = join(absoluteRunDir, "pre-maintenance-wiki");
  await mkdir(baseWikiDir, { recursive: true });
  await writeFile(join(baseWikiDir, "index.md"), "# Demo\n", "utf8");

  const result = await runProjectMemoryMaintenanceMode({
    root,
    projectKey: "demo",
    runDir: "projects/demo/runs/project-learn/run-2",
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
