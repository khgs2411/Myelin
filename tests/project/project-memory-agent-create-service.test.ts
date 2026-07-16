import { expect, test } from "bun:test";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  assertCreatePlannerReport,
  runProjectMemoryCreateMode,
} from "../../src/project/project-memory-agent-create-service.ts";
import type { ProjectLearnProgressEvent } from "../../src/project/project-learn-progress.ts";
import { writeJson } from "../../src/runtime/json.ts";

test("retries a capacity-limited subject writer with visible backoff", async () => {
  const root = await mkdtemp(join(tmpdir(), "myelin-create-retry-"));
  const targetRepoDir = join(root, "repo");
  const absoluteRunDir = join(root, "projects", "demo", "runs", "project-learn", "run-1");
  await mkdir(targetRepoDir, { recursive: true });
  await writeFile(join(targetRepoDir, "README.md"), "# Demo\n", "utf8");
  const retryDelays: number[] = [];
  const progress: ProjectLearnProgressEvent[] = [];
  let subjectCalls = 0;
  let plannerPrompt = "";
  let subjectPrompt = "";

  const result = await runProjectMemoryCreateMode({
    root,
    projectKey: "demo",
    runDir: "projects/demo/runs/project-learn/run-1",
    absoluteRunDir,
    targetRepoDir,
    concurrency: 1,
    retryDelay: async (milliseconds) => { retryDelays.push(milliseconds); },
    progress: (event) => progress.push(event),
    runner: async (_command, options) => {
      const cwd = String(options?.cwd);
      if (cwd.endsWith("/agents/create")) {
        plannerPrompt = String(options?.stdin);
        await mkdir(join(cwd, "draft-wiki"), { recursive: true });
        await mkdir(join(cwd, "reports"), { recursive: true });
        await writeFile(
          join(cwd, "draft-wiki", "index.md"),
          "# Demo\n\n## Planned canonical subjects\n\n- [Runtime](runtime.md)\n",
          "utf8",
        );
        await writeFile(join(cwd, "draft-wiki", "runtime.md"), "# Runtime\n", "utf8");
        await writeJson(join(cwd, "reports", "documentation-subject-manifest.json"), {
          schema_version: 1,
          project_key: "demo",
          subjects: [{
            subject_id: "runtime",
            wiki_path: "runtime.md",
            title: "Runtime",
            purpose: "Document runtime behavior.",
            suggested_repo_paths: ["README.md"],
          }],
        });
        await writeJson(join(cwd, "reports", "documentation-planner-report.json"), {
          schema_version: 1,
          project_key: "demo",
          evidence_paths: ["README.md"],
          surface_coverage: demoSurfaceCoverage(),
          known_gaps: [],
        });
        return { exitCode: 0, stdout: "planned", stderr: "" };
      }
      if (cwd.endsWith("/agents/create-index-finalizer")) {
        await mkdir(join(cwd, "finalized-index"), { recursive: true });
        await writeFile(
          join(cwd, "finalized-index", "index.md"),
          "# Demo\n\n## Canonical subjects\n\n- [Runtime](runtime.md)\n",
          "utf8",
        );
        return { exitCode: 0, stdout: "finalized", stderr: "" };
      }

      subjectCalls += 1;
      subjectPrompt = String(options?.stdin);
      if (subjectCalls <= 2) {
        return {
          exitCode: 1,
          stdout: "",
          stderr: "ERROR: Selected model is at capacity. Please try a different model.",
        };
      }
      await mkdir(join(cwd, "draft-wiki"), { recursive: true });
      await mkdir(join(cwd, "reports"), { recursive: true });
      await writeFile(join(cwd, "draft-wiki", "runtime.md"), "# Runtime\n\nRecovered after retry.\n", "utf8");
      await writeJson(join(cwd, "reports", "subject-report.json"), {
        schema_version: 1,
        project_key: "demo",
        subject_id: "runtime",
        wiki_path: "runtime.md",
        status: "completed",
        evidence_paths: ["README.md"],
        touched_paths: ["runtime.md"],
        known_gaps: [],
      });
      return { exitCode: 0, stdout: "completed", stderr: "" };
    },
  });

  expect(result.status).toBe("completed");
  expect(result.retry_limit).toBe(3);
  expect(subjectCalls).toBe(3);
  expect(retryDelays).toEqual([15_000, 45_000]);
  expect(progress.map((event) => event.message).filter(Boolean)).toContain(
    "retrying runtime in 15s (attempt 2/4)",
  );
  expect(plannerPrompt).toContain("Status must be exactly covered or not_present");
  expect(subjectPrompt).toContain("destructive_or_irreversible_operation");
  expect(subjectPrompt).toContain("Reset runtime state");
  expect(progress.map((event) => event.message).filter(Boolean)).toContain(
    "retrying runtime now (attempt 3/4)",
  );
  expect(await readFile(join(absoluteRunDir, "agents", "create", "draft-wiki", "runtime.md"), "utf8"))
    .toContain("Recovered after retry");
  expect(await readFile(join(absoluteRunDir, "agents", "create", "draft-wiki", "index.md"), "utf8"))
    .not.toContain("Planned canonical subjects");
  expect(await readFile(join(absoluteRunDir, "agents", "subject-runtime", "retry-attempts", "attempt-1.json"), "utf8"))
    .toContain("Selected model is at capacity");
});

test("rejects planner reports that omit a required repository surface kind", () => {
  expect(() => assertCreatePlannerReport("demo", {
    schema_version: 1,
    project_key: "demo",
    evidence_paths: ["README.md"],
    surface_coverage: demoSurfaceCoverage().filter((coverage) => coverage.kind !== "administrative_surface"),
    known_gaps: [],
  }, {
    schema_version: 1,
    project_key: "demo",
    subjects: [{
      subject_id: "runtime",
      wiki_path: "runtime.md",
      title: "Runtime",
      purpose: "Document runtime behavior.",
      suggested_repo_paths: ["README.md"],
    }],
  })).toThrow("must account for surface kind: administrative_surface");
});

function demoSurfaceCoverage() {
  return [
    {
      surface_id: "runtime-api",
      kind: "public_interface" as const,
      status: "covered" as const,
      summary: "Public runtime interface.",
      evidence_paths: ["README.md"],
      subject_ids: ["runtime"],
    },
    {
      surface_id: "runtime-commands",
      kind: "operator_workflow" as const,
      status: "covered" as const,
      summary: "Operator runtime commands.",
      evidence_paths: ["README.md"],
      subject_ids: ["runtime"],
    },
    {
      surface_id: "absent-administrative-surface",
      kind: "administrative_surface" as const,
      status: "not_present" as const,
      summary: "No administrative surface is present.",
      evidence_paths: ["README.md"],
      subject_ids: [],
    },
    {
      surface_id: "runtime-reset",
      kind: "destructive_or_irreversible_operation" as const,
      status: "covered" as const,
      summary: "Reset runtime state.",
      evidence_paths: ["README.md"],
      subject_ids: ["runtime"],
    },
  ];
}
