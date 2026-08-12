# Chunk 03: Project Run Infrastructure

**Plan Set:** `../plan.md`
**Spec:** `../spec.md`
**Status:** Ready For Implementation
**Depends on:** None
**Enables:** `04-curator-service-prewrite-flow.md`, `06-phase-0-runner-retirement.md`

## Goal

Create mechanical run helpers for Project Memory Curator runs and explicitly freeze `src/pipeline/runner.ts` as legacy Project Memory scaffolding. This chunk does not delete `runner.ts`, route commands, or add Project Memory semantics to runtime helpers.

## Source Artifacts

- `../spec.md`: Run Artifacts and Relationship To Existing Pipeline Stages.
- `../agenda.md`: Question 5 curator-specific artifacts; Question 7 runner demotion.
- `../pseudocode/ProjectRunInfrastructureBoundary.md`: runtime/helper ownership boundary.
- `src/runtime/artifacts.ts`: existing run directory helpers.
- `src/runtime/json.ts`: stable JSON artifact writes.
- `src/runtime/llm-client.ts`: provider invocation wrapper using read-only Codex sandbox.
- `src/schema/compiler.ts`: schema context freshness helpers.

## Relationships

- **Depends on:** Existing runtime helpers.
- **Enables:** Curator service can create run directories, write artifacts, invoke provider, and ensure schema freshness without importing `src/pipeline/runner.ts`.
- **Shared contracts:** `ProjectCuratorRunPaths`, `createProjectCuratorRun`, `writeRunArtifact`, `writeMarkdownArtifact`, `ensureProjectLearnSchemaContext`, `invokeProjectCurator`.
- **Integration points:** `src/project/project-memory-curator-service.ts`, `tests/runtime/project-run-infrastructure.test.ts`, `tests/runtime/llm-client.test.ts`.

## File Responsibility Map

**Create:**
- `src/runtime/project-run-infrastructure.ts` - mechanical run helpers only.
- `tests/runtime/project-run-infrastructure.test.ts` - verifies run paths, JSON artifact writing, generic markdown artifact writing, schema context behavior, and provider wrapper arguments.

**Modify:**
- `src/pipeline/runner.ts` - add a short file-level legacy comment only if the codebase accepts comments at the top of legacy files.

**Test:**
- `tests/runtime/project-run-infrastructure.test.ts` - proves helpers are independent of `runProjectPipeline`.

## Implementation Tasks

### Task 1: Add Runtime Helper Tests

**Files:**
- Create: `tests/runtime/project-run-infrastructure.test.ts`

- [ ] **Step 1: Add tests for curator run helpers**

```ts
import { afterEach, beforeEach, expect, test } from "bun:test";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  createProjectCuratorRun,
  ensureProjectLearnSchemaContext,
  invokeProjectCurator,
  writeMarkdownArtifact,
  writeRunArtifact,
} from "../../src/runtime/project-run-infrastructure.ts";
import { writeJson } from "../../src/runtime/json.ts";

let root: string;

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "myelin-curator-runtime-"));
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

test("creates project-learn run paths and writes stable artifacts", async () => {
  await seedProject();
  const run = await createProjectCuratorRun(root, "demo", new Date("2026-06-23T10:00:00.000Z"));

  expect(run.run_id).toBe("2026-06-23T10-00-00.000Z-run");
  expect(run.relative_run_dir).toBe("projects/demo/runs/project-learn/2026-06-23T10-00-00.000Z-run");

  await writeRunArtifact(run, "input-packet.json", { b: 2, a: 1 });

  expect(await readFile(join(run.absolute_run_dir, "input-packet.json"), "utf8")).toBe("{\n  \"a\": 1,\n  \"b\": 2\n}\n");
});

test("writes generic markdown artifacts without owning product semantics", async () => {
  await seedProject();
  const run = await createProjectCuratorRun(root, "demo", new Date("2026-06-23T10:00:00.000Z"));

  await writeMarkdownArtifact(run, "summary.md", ["# Summary", "", "Product-specific text is composed by the caller."].join("\n"));

  const summary = await readFile(join(run.absolute_run_dir, "summary.md"), "utf8");
  expect(summary).toBe("# Summary\n\nProduct-specific text is composed by the caller.\n");
});

test("ensures schema context using learn semantics", async () => {
  await seedProject();
  await seedSchema();

  const schema = await ensureProjectLearnSchemaContext(root, "demo", {
    dryRun: false,
    now: new Date("2026-06-23T10:00:00.000Z"),
  });

  expect(schema.hash).toHaveLength(64);
  expect(schema.wrote).toBe(true);
});

test("invokes curator through pipeline workload without importing the old runner", async () => {
  await seedProject();
  await writeFile(join(root, "myelin.config"), "DEFAULT_PROVIDER=codex\nPIPELINE_CODEX_MODEL=gpt-curator\n", "utf8");
  const captured: { command?: string[]; stdin?: string } = {};

  const result = await invokeProjectCurator({
    root,
    prompt: "Return JSON",
    stageId: "curator-maintain",
    runner: async (command, options) => {
      captured.command = command;
      captured.stdin = options?.stdin;
      return { exitCode: 0, stdout: "{\"ok\":true}", stderr: "" };
    },
  });

  expect(result.response).toEqual({ ok: true });
  expect(captured.command).toContain("--sandbox");
  expect(captured.command).toContain("read-only");
  expect(captured.stdin).toBe("Return JSON");
});

async function seedProject(): Promise<void> {
  await writeJson(join(root, "projects", "demo", "state", "project.json"), {
    key: "demo",
    name: "Demo",
    repo_paths: [join(root, "repos", "demo")],
  });
}

async function seedSchema(): Promise<void> {
  await mkdir(join(root, "schema", "rules"), { recursive: true });
  await writeFile(join(root, "schema", "global.md"), "Project schema\n", "utf8");
  await writeJson(join(root, "schema", "rules", "source-classification.json"), {
    source_kind: ["handoff"],
    ownership: ["project"],
    action: ["update-existing-pages"],
    required_fields: ["source_kind"],
  });
  await writeJson(join(root, "schema", "rules", "memory-scopes.json"), {
    phase_0_active: ["project"],
    phase_0_deferred: [],
    scopes: [{ key: "project", description: "Project" }],
  });
  await writeJson(join(root, "schema", "rules", "page-taxonomy.json"), {
    categories: [{ key: "setup", description: "Setup" }],
  });
}
```

- [ ] **Step 2: Run the focused test**

Run: `bun test tests/runtime/project-run-infrastructure.test.ts`
Expected: fails because `src/runtime/project-run-infrastructure.ts` does not exist.

### Task 2: Implement Mechanical Runtime Helpers

**Files:**
- Create: `src/runtime/project-run-infrastructure.ts`

- [ ] **Step 1: Add helper implementation**

```ts
import { createHash } from "node:crypto";
import { join, relative } from "node:path";
import { createRunDir, timestampRunId } from "./artifacts.ts";
import { writeJson, stableJson, readJsonIfExists } from "./json.ts";
import { invokeLlm, type LlmResult, type ProcessRunner } from "./llm-client.ts";
import { statePath } from "./state.ts";
import { buildSchemaContext, checkSchema, validateSchemaContext } from "../schema/compiler.ts";

export type ProjectCuratorRunPaths = {
  root: string;
  project_key: string;
  run_id: string;
  absolute_run_dir: string;
  relative_run_dir: string;
};

export async function createProjectCuratorRun(root: string, projectKey: string, now = new Date()): Promise<ProjectCuratorRunPaths> {
  const runId = timestampRunId(now);
  const absoluteRunDir = await createRunDir(root, projectKey, runId, "project-learn");
  return {
    root,
    project_key: projectKey,
    run_id: runId,
    absolute_run_dir: absoluteRunDir,
    relative_run_dir: relative(root, absoluteRunDir),
  };
}

export async function writeRunArtifact(run: ProjectCuratorRunPaths, artifact: string, value: unknown): Promise<string> {
  const path = join(run.absolute_run_dir, artifact);
  await writeJson(path, value);
  return artifact;
}

export async function writeMarkdownArtifact(run: ProjectCuratorRunPaths, artifact: string, markdown: string): Promise<string> {
  const content = markdown.endsWith("\n") ? markdown : `${markdown}\n`;
  await Bun.write(join(run.absolute_run_dir, artifact), content);
  return artifact;
}

export async function ensureProjectLearnSchemaContext(
  root: string,
  projectKey: string,
  options: { dryRun: boolean; now: Date },
): Promise<{ hash: string; wrote: boolean }> {
  const existing = await readJsonIfExists<unknown>(statePath(root, projectKey, "schema-context.json"));
  if (!existing) {
    const built = await buildSchemaContext(root, projectKey, { dryRun: options.dryRun, builtAt: options.now });
    return { hash: sha256(stableJson(built.context)), wrote: built.wrote };
  }

  const checked = await checkSchema(root, projectKey);
  if (!checked.ok) {
    const built = await buildSchemaContext(root, projectKey, { dryRun: options.dryRun, builtAt: options.now });
    if (options.dryRun) return { hash: sha256(stableJson(built.context)), wrote: false };
    const rechecked = await checkSchema(root, projectKey);
    if (!rechecked.ok) throw new Error(`schema check failed before learn: ${rechecked.errors.join("; ")}`);
    return { hash: sha256(stableJson(built.context)), wrote: built.wrote };
  }

  const parsed = await validateSchemaContext(existing);
  return { hash: sha256(stableJson(parsed)), wrote: false };
}

export async function invokeProjectCurator(input: {
  root: string;
  prompt: string;
  stageId: "curator-create" | "curator-maintain" | string;
  provider?: "codex" | "claude";
  modelOverride?: string;
  env?: NodeJS.ProcessEnv;
  runner?: ProcessRunner;
}): Promise<LlmResult> {
  return invokeLlm({
    root: input.root,
    workload: "pipeline",
    stageId: input.stageId,
    prompt: input.prompt,
    provider: input.provider,
    modelOverride: input.modelOverride,
    env: input.env,
    cwd: input.root,
    runner: input.runner,
  });
}

function sha256(text: string): string {
  return createHash("sha256").update(text, "utf8").digest("hex");
}
```

- [ ] **Step 2: Add an optional legacy comment to runner**

If editing `src/pipeline/runner.ts`, place this single comment above `export type PipelineKind`:

```ts
// Legacy Phase-0 Project Memory runner. New Project Memory Curator behavior must use src/project/project-memory-curator-service.ts and mechanical helpers under src/runtime/.
```

Do not change behavior in `runner.ts` in this chunk.

- [ ] **Step 3: Run focused tests**

Run: `bun test tests/runtime/project-run-infrastructure.test.ts`
Expected: passes.

## Verification

- `bun test tests/runtime/project-run-infrastructure.test.ts`
  - Expected: run path, JSON artifact, generic markdown artifact, schema, and provider wrapper tests pass.
- `bun run typecheck`
  - Expected: helper exports typecheck and do not import `src/pipeline/runner.ts`.
- `rg -n "runProjectPipeline|pipeline/runner" src/runtime src/project/project-memory-curator-service.ts`
  - Expected after Chunk 04: no `src/runtime` or curator service imports from `pipeline/runner`.

## Acceptance Criteria Covered

- Useful runner mechanics are replaced or extracted as mechanical runtime support.
- `runner.ts` is deprecated early as a Project Memory boundary.
- Curator-specific artifact support exists without old Phase-0 stage semantics.

## Risks And Rollback

- Risk: helper scope can expand into Project Memory semantics. Keep mode decisions, validation outcomes, evidence rules, and stopped-before-writes product meaning out of runtime helpers.
- Rollback: delete `src/runtime/project-run-infrastructure.ts` and its tests; remove the optional comment from `runner.ts`.

## Non-Goals

- No command wiring.
- No `runner.ts` deletion.
- No Project Memory proposal validation.
- No wiki markdown apply.

## Type And Name Consistency

Before marking this chunk done, verify these exports exist exactly: `createProjectCuratorRun`, `writeRunArtifact`, `writeMarkdownArtifact`, `ensureProjectLearnSchemaContext`, and `invokeProjectCurator`.
