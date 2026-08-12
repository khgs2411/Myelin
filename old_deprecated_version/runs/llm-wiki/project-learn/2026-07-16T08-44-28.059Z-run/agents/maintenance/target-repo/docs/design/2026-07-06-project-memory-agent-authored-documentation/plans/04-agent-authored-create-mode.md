# Chunk 04: Agent-Authored Create Mode

**Plan Set:** `../plan.md`  
**Spec:** `../spec.md`  
**Status:** Ready For Implementation  
**Depends on:** `01-contracts-state-and-cli-surface.md`, `02-file-authoring-runner.md`, `03-draft-wiki-promotion.md`  
**Enables:** `06-project-learn-composition-and-recreate.md`, `08-live-dogfood-and-acceptance.md`

## Goal

Implement first-create documentation generation as a two-layer multi-agent flow. A planner/index agent inspects the repository, creates `draft-wiki/index.md`, placeholder subject files, a subject manifest, and a planner report. Then one subject writer agent per manifest entry fills exactly its assigned documentation file. The create service returns a completed draft wiki and reports for orchestration; it does not promote canonical files itself and does not add a synthesis agent.

## Source Artifacts

- `../spec.md`: create mode, planner/index agent, subject writer agents, bounded parallelism, retry.
- `../agenda.md`: no enforced `architecture.md`, agent decides shape, no third layer.
- `../../../adr/0067-use-agent-authored-project-memory-documentation.md`.
- Chunk outputs:
  - `src/project/project-memory-agent-contracts.ts`
  - `src/runtime/file-authoring-agent.ts`
  - `src/project/project-memory-draft-promotion.ts`
- Current code:
  - `src/project/project-memory-curator-service.ts`
  - `src/runtime/project-run-infrastructure.ts`
  - `tests/project/project-memory-curator-service.test.ts`

## Relationships

- **Depends on:** contracts, file-authoring runner, draft promotion helper.
- **Enables:** full `project learn` composition in chunk `06`.
- **Shared contracts:** `runProjectMemoryCreateMode`, `ProjectMemoryCreateModeInput`, `ProjectMemoryCreateModeResult`, `reports/documentation-subject-manifest.json`, subject writer reports.
- **Integration points:** runner wrapper, run artifact directories, future `ProjectMemoryCuratorService.runProjectLearn` composition.

## File Responsibility Map

**Create:**
- `src/project/project-memory-agent-create-service.ts` - create-mode planner invocation, manifest loading, bounded subject writer pool, retry, reports, and pre-maintenance snapshot.
- `tests/project/project-memory-agent-create-service.test.ts` - planner and subject writer orchestration with fixture-backed runner.

**Modify:**
- `src/project/project-memory-agent-contracts.ts` - add helper predicates for manifest/report parsing only if chunk `01` did not include them.

**Test:**
- `tests/project/project-memory-curator-service.test.ts` is not changed in this chunk unless imports break; service routing changes are chunk `06`.

## Implementation Tasks

### Task 1: Add Create Service Types And Planner Invocation

**Files:**
- Create: `src/project/project-memory-agent-create-service.ts`
- Test: `tests/project/project-memory-agent-create-service.test.ts`

- [ ] **Step 1: Add planner orchestration test**

```ts
import { describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runProjectMemoryCreateMode } from "../../src/project/project-memory-agent-create-service.ts";

describe("runProjectMemoryCreateMode", () => {
  test("runs planner then one writer per manifest subject", async () => {
    const root = await mkdtemp(join(tmpdir(), "myelin-create-service-"));
    const fixtures = join(root, "fixtures");
    await mkdir(join(fixtures, "create-planner", "draft-wiki"), { recursive: true });
    await writeFile(join(fixtures, "create-planner", "draft-wiki", "index.md"), "# Demo\n\n- [Runtime](runtime.md)\n", "utf8");
    await writeFile(join(fixtures, "create-planner", "draft-wiki", "runtime.md"), "# Runtime\n\nPlaceholder.\n", "utf8");
    await mkdir(join(fixtures, "create-planner", "reports"), { recursive: true });
    await writeFile(join(fixtures, "create-planner", "reports", "documentation-subject-manifest.json"), JSON.stringify({
      schema_version: 1,
      project_key: "demo",
      subjects: [{
        subject_id: "runtime",
        wiki_path: "runtime.md",
        title: "Runtime",
        purpose: "Document runtime behavior",
        suggested_repo_paths: ["src/runtime"],
      }],
    }, null, 2));
    await writeFile(join(fixtures, "create-planner", "reports", "documentation-planner-report.json"), JSON.stringify({
      schema_version: 1,
      project_key: "demo",
      status: "completed",
      evidence_paths: ["src/runtime"],
      known_gaps: [],
    }, null, 2));
    await mkdir(join(fixtures, "subject-runtime", "draft-wiki"), { recursive: true });
    await writeFile(join(fixtures, "subject-runtime", "draft-wiki", "runtime.md"), "# Runtime\n\nDetailed runtime docs.\n", "utf8");
    await mkdir(join(fixtures, "subject-runtime", "reports"), { recursive: true });
    await writeFile(join(fixtures, "subject-runtime", "reports", "subject-report.json"), JSON.stringify({
      schema_version: 1,
      project_key: "demo",
      subject_id: "runtime",
      wiki_path: "runtime.md",
      status: "completed",
      evidence_paths: ["src/runtime"],
      touched_paths: ["runtime.md"],
      known_gaps: [],
    }, null, 2));

    const runDir = join(root, "projects", "demo", "runs", "project-learn", "run-1");
    const result = await runProjectMemoryCreateMode({
      root,
      projectKey: "demo",
      runDir: "projects/demo/runs/project-learn/run-1",
      absoluteRunDir: runDir,
      targetRepoDir: root,
      provider: "codex",
      env: { FILE_AUTHORING_STUB_OUTPUTS_DIR: fixtures },
      concurrency: 4,
      now: new Date("2026-07-06T00:00:00.000Z"),
    });

    expect(result.status).toBe("completed");
    expect(result.manifest.subjects.map((subject) => subject.subject_id)).toEqual(["runtime"]);
    expect(await readFile(join(result.draft_wiki_dir, "runtime.md"), "utf8")).toContain("Detailed runtime docs");
    expect(result.subject_reports).toHaveLength(1);
  });
});
```

- [ ] **Step 2: Run the focused test**

Run: `bun test tests/project/project-memory-agent-create-service.test.ts`  
Expected: fails because the create service does not exist.

- [ ] **Step 3: Implement create service public types**

```ts
import { cp, mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import type { Provider } from "../runtime/config.ts";
import type { ProcessRunner } from "../runtime/llm-client.ts";
import { invokeFileAuthoringAgent } from "../runtime/project-run-infrastructure.ts";
import { readJson, writeJson } from "../runtime/json.ts";
import type {
  ProjectMemorySubjectManifest,
  ProjectMemorySubjectReport,
} from "./project-memory-agent-contracts.ts";

export type ProjectMemoryCreateModeInput = {
  root: string;
  projectKey: string;
  runDir: string;
  absoluteRunDir: string;
  targetRepoDir: string;
  provider?: Provider;
  modelOverride?: string;
  env?: NodeJS.ProcessEnv;
  runner?: ProcessRunner;
  concurrency?: number;
  now?: Date;
};

export type ProjectMemoryCreateModeResult = {
  status: "completed" | "failed";
  project_key: string;
  draft_wiki_dir: string;
  manifest: ProjectMemorySubjectManifest;
  planner_report_ref: "reports/documentation-planner-report.json";
  subject_manifest_ref: "reports/documentation-subject-manifest.json";
  subject_reports: ProjectMemorySubjectReport[];
  subject_report_refs: string[];
  file_authoring_run_refs: string[];
  pre_maintenance_wiki_ref: "pre-maintenance-wiki";
  error?: string;
};
```

- [ ] **Step 4: Implement planner run**

```ts
export async function runProjectMemoryCreateMode(input: ProjectMemoryCreateModeInput): Promise<ProjectMemoryCreateModeResult> {
  const createDir = join(input.absoluteRunDir, "agents", "create");
  const draftWikiDir = join(createDir, "draft-wiki");
  await mkdir(draftWikiDir, { recursive: true });
  const planner = await invokeFileAuthoringAgent({
    root: input.root,
    projectKey: input.projectKey,
    stageId: "create-planner",
    prompt: createPlannerPrompt(input.projectKey),
    runDir: input.absoluteRunDir,
    targetRepoDir: input.targetRepoDir,
    workspaceDir: createDir,
    outputRoots: [
      { name: "draft_wiki", relativePath: "draft-wiki" },
      { name: "planner_reports", relativePath: "reports" },
    ],
    provider: input.provider,
    modelOverride: input.modelOverride,
    env: input.env,
    runner: input.runner,
  });
  if (planner.status !== "completed") return failedCreateResult(input, planner.error ?? "planner failed");

  const manifest = await readJson<ProjectMemorySubjectManifest>(join(createDir, "reports", "documentation-subject-manifest.json"));
  assertCreateManifest(input.projectKey, manifest);
  assertDraftWikiHasSubjectFiles(draftWikiDir, manifest);
  const subjectReports = await runSubjectWriters(input, manifest, draftWikiDir);
  await cp(draftWikiDir, join(input.absoluteRunDir, "pre-maintenance-wiki"), { recursive: true });
  return completedCreateResult(input, draftWikiDir, manifest, subjectReports);
}
```

### Task 2: Implement Planner Prompt And Manifest Checks

**Files:**
- Modify: `src/project/project-memory-agent-create-service.ts`
- Test: `tests/project/project-memory-agent-create-service.test.ts`

- [ ] **Step 1: Add manifest rejection tests**

```ts
test("rejects planner manifest paths outside draft wiki", async () => {
  const manifest = {
    schema_version: 1,
    project_key: "demo",
    subjects: [{
      subject_id: "bad",
      wiki_path: "../state/index.md",
      title: "Bad",
      purpose: "Bad path",
      suggested_repo_paths: [],
    }],
  };
  expect(() => assertCreateManifest("demo", manifest)).toThrow("subject wiki_path must stay inside draft wiki");
});
```

Export `assertCreateManifest` only if the test imports it directly; otherwise assert through `runProjectMemoryCreateMode`.

- [ ] **Step 2: Implement prompt**

```ts
function createPlannerPrompt(projectKey: string): string {
  return [
    `You are creating Project Memory documentation for project ${projectKey}.`,
    "Inspect the repository thoroughly.",
    "Decide the documentation shape yourself. Do not assume required filenames other than index.md.",
    "Write draft-wiki/index.md and create one placeholder markdown file per documentation subject.",
    "Write reports/documentation-subject-manifest.json with schema_version 1, project_key, and subjects.",
    "Each subject needs subject_id, wiki_path, title, purpose, and suggested_repo_paths.",
    "Write documentation-planner-report.json with evidence_paths and known_gaps.",
    "Do not write outside the allowed output roots.",
  ].join("\n");
}
```

- [ ] **Step 3: Implement manifest checks**

```ts
export function assertCreateManifest(projectKey: string, manifest: ProjectMemorySubjectManifest): void {
  if (manifest.schema_version !== 1) throw new Error("documentation subject manifest schema_version must be 1");
  if (manifest.project_key !== projectKey) throw new Error("documentation subject manifest project_key mismatch");
  if (!Array.isArray(manifest.subjects) || manifest.subjects.length === 0) {
    throw new Error("documentation subject manifest must include at least one subject");
  }
  const ids = new Set<string>();
  for (const subject of manifest.subjects) {
    if (!subject.subject_id || ids.has(subject.subject_id)) throw new Error(`duplicate or empty subject_id: ${subject.subject_id}`);
    ids.add(subject.subject_id);
    if (!subject.wiki_path.endsWith(".md")) throw new Error(`subject wiki_path must be markdown: ${subject.wiki_path}`);
    if (subject.wiki_path.startsWith("/") || subject.wiki_path.includes("..")) {
      throw new Error(`subject wiki_path must stay inside draft wiki: ${subject.wiki_path}`);
    }
  }
}
```

- [ ] **Step 4: Run focused tests**

Run: `bun test tests/project/project-memory-agent-create-service.test.ts`  
Expected: manifest checks pass.

### Task 3: Run Subject Writers With Bounded Parallelism And One Retry

**Files:**
- Modify: `src/project/project-memory-agent-create-service.ts`
- Test: `tests/project/project-memory-agent-create-service.test.ts`

- [ ] **Step 1: Add retry/concurrency test**

```ts
test("retries a mechanically failed subject writer once", async () => {
  let calls = 0;
  const runner = async () => {
    calls += 1;
    if (calls === 1) return { stdout: "", stderr: "failed", exitCode: 1 };
    return { stdout: "ok", stderr: "", exitCode: 0 };
  };
  // Use a prebuilt planner fixture and assert result.status is completed after the second writer call.
  expect(calls).toBe(2);
});
```

Use the repo's existing process-runner test style for exact fixture setup.

- [ ] **Step 2: Implement writer pool**

```ts
async function runSubjectWriters(
  input: ProjectMemoryCreateModeInput,
  manifest: ProjectMemorySubjectManifest,
  draftWikiDir: string,
): Promise<ProjectMemorySubjectReport[]> {
  const concurrency = Math.max(1, Math.min(input.concurrency ?? 4, 8));
  const reports: ProjectMemorySubjectReport[] = [];
  let index = 0;
  async function worker(): Promise<void> {
    while (index < manifest.subjects.length) {
      const subject = manifest.subjects[index++];
      reports.push(await runSubjectWriterWithRetry(input, subject, draftWikiDir));
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, manifest.subjects.length) }, () => worker()));
  const failed = reports.filter((report) => report.status !== "completed");
  if (failed.length > 0) throw new Error(`subject writers failed: ${failed.map((report) => report.subject_id).join(", ")}`);
  return reports.sort((a, b) => a.subject_id.localeCompare(b.subject_id));
}
```

Writer invocation:

```ts
async function runSubjectWriterWithRetry(
  input: ProjectMemoryCreateModeInput,
  subject: ProjectMemorySubjectManifest["subjects"][number],
  draftWikiDir: string,
): Promise<ProjectMemorySubjectReport> {
  for (let attempt = 1; attempt <= 2; attempt += 1) {
    const workspaceDir = join(input.absoluteRunDir, "agents", `subject-${subject.subject_id}`);
    const indexMarkdown = await readFile(join(draftWikiDir, "index.md"), "utf8");
    const result = await invokeFileAuthoringAgent({
      root: input.root,
      projectKey: input.projectKey,
      stageId: `subject-${subject.subject_id}`,
      prompt: subjectWriterPrompt(input.projectKey, subject, indexMarkdown),
      runDir: input.absoluteRunDir,
      targetRepoDir: input.targetRepoDir,
      workspaceDir,
      outputRoots: [
        { name: "draft_wiki", relativePath: "draft-wiki" },
        { name: "subject_reports", relativePath: "reports" },
      ],
      provider: input.provider,
      modelOverride: input.modelOverride,
      env: input.env,
      runner: input.runner,
    });
    if (result.status !== "completed" && attempt === 1) continue;
    if (result.status !== "completed") return failedSubjectReport(input.projectKey, subject, result.error ?? "writer failed");
    await copySubjectOutput(workspaceDir, draftWikiDir, subject.wiki_path);
    return await readJson<ProjectMemorySubjectReport>(join(workspaceDir, "reports", "subject-report.json"));
  }
  return failedSubjectReport(input.projectKey, subject, "writer failed");
}
```

- [ ] **Step 3: Implement subject prompt**

```ts
function subjectWriterPrompt(projectKey: string, subject: ProjectMemorySubjectManifest["subjects"][number], indexMarkdown: string): string {
  return [
    `You are documenting one Project Memory subject for project ${projectKey}.`,
    `Subject id: ${subject.subject_id}`,
    `Assigned wiki path: ${subject.wiki_path}`,
    `Title: ${subject.title}`,
    `Purpose: ${subject.purpose}`,
    `Suggested repo paths: ${subject.suggested_repo_paths.join(", ") || "inspect the repository as needed"}`,
    "Current draft-wiki/index.md:",
    indexMarkdown,
    "Read the repository and write only the assigned markdown file under draft-wiki.",
    "Write reports/subject-report.json with schema_version, project_key, subject_id, wiki_path, status, evidence_paths, touched_paths, and known_gaps.",
    "Use concrete repo path references naturally where they help future agents.",
  ].join("\n");
}
```

- [ ] **Step 4: Run create service tests**

Run: `bun test tests/project/project-memory-agent-create-service.test.ts`  
Expected: passes.

## Verification

- Run: `bun test tests/project/project-memory-agent-create-service.test.ts`  
  Expected: pass.
- Run: `bun test tests/runtime/file-authoring-agent.test.ts`  
  Expected: pass; create service depends on runner guarantees.
- Run: `bun run typecheck`  
  Expected: pass.

## Acceptance Criteria Covered

- Planner/index agent owns documentation shape.
- Only `index.md` is enforced as a navigable root.
- Subject manifest drives per-file agents.
- Subject writers are bounded to default concurrency `4`.
- Each subject writer gets one retry after mechanical failure.
- No synthesis agent is added.
- Create mode emits a draft wiki, manifest, planner report, subject reports, and `pre-maintenance-wiki`.

## Risks And Rollback

- Risk: subject writer snippets in tests need fixture setup that mirrors runner output roots. Keep tests fixture-backed instead of depending on live Codex.
- Risk: no synthesis layer may produce uneven docs. This is accepted for this design and verified by chunk `08`.
- Rollback: remove `project-memory-agent-create-service.ts`; chunks `06` and `08` cannot proceed.

## Non-Goals

- Does not promote canonical wiki files.
- Does not process memory candidates.
- Does not run retrieval indexing.
- Does not preserve old JSON curator create output.

## Type And Name Consistency

- Create service: `runProjectMemoryCreateMode`.
- Input type: `ProjectMemoryCreateModeInput`.
- Result type: `ProjectMemoryCreateModeResult`.
- Planner stage id: `create-planner`.
- Subject stage id prefix: `subject-`.
- Manifest artifact: `reports/documentation-subject-manifest.json`.
- Planner report artifact: `reports/documentation-planner-report.json`.
