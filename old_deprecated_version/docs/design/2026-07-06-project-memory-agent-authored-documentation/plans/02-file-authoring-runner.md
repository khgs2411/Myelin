# Chunk 02: File-Authoring Runner

**Plan Set:** `../plan.md`  
**Spec:** `../spec.md`  
**Status:** Ready For Implementation  
**Depends on:** `01-contracts-state-and-cli-surface.md`  
**Enables:** `04-agent-authored-create-mode.md`, `05-agent-authored-maintenance-mode.md`

## Goal

Build the provider runner that allows Codex or fixture-backed agents to author files in a run-local workspace while reading the target repository. This runner is separate from JSON-only `invokeLlm`; it records invocation metadata, discovers filesystem outputs, enforces allowed output roots, and fails closed on path escapes before create or maintenance orchestration can use it.

## Source Artifacts

- `../spec.md`: file-authoring runner, writable sandbox, artifact auditability.
- `../plan.md`: reconciliation that agent-authored documentation uses this file-authoring runner while JSON-only `invokeLlm` remains for read-only structured stages.
- `../../../adr/0067-use-agent-authored-project-memory-documentation.md`.
- Current code:
  - `src/runtime/llm-client.ts`
  - `src/runtime/process.ts`
  - `src/runtime/fs.ts`
  - `src/runtime/project-run-infrastructure.ts`
  - `tests/runtime/llm-client.test.ts`
  - `tests/runtime/project-run-infrastructure.test.ts`

## Relationships

- **Depends on:** chunk `01` contract names.
- **Enables:** planner, subject writer, and maintenance agent orchestration.
- **Shared contracts:** `FileAuthoringAgentInput`, `FileAuthoringAgentResult`, `FILE_AUTHORING_STUB_OUTPUTS_DIR`, target repo snapshot, output-root enforcement.
- **Integration points:** provider config resolution from `llm-client.ts`, `ProcessRunner`, run artifact directories under `projects/<key>/runs/project-learn/<run-id>/`.

## File Responsibility Map

**Create:**
- `src/runtime/file-authoring-agent.ts` - run-local workspace setup, live provider invocation, fixture output copying, output discovery, metadata writing, and escape checks.
- `tests/runtime/file-authoring-agent.test.ts` - safety, stub, metadata, and discovery behavior.

**Modify:**
- `src/runtime/project-run-infrastructure.ts` - export a thin `invokeFileAuthoringAgent` wrapper if later project code should import from the infrastructure module.

**Test:**
- `tests/runtime/llm-client.test.ts` - remains JSON-only and read-only; add an assertion that this file does not cover file-authoring behavior if needed.
- `tests/runtime/project-run-infrastructure.test.ts` - wrapper delegates to `runFileAuthoringAgent`.

## Implementation Tasks

### Task 1: Add Runner Types And Stub Contract

**Files:**
- Create: `src/runtime/file-authoring-agent.ts`
- Test: `tests/runtime/file-authoring-agent.test.ts`

- [ ] **Step 1: Add runner type tests**

```ts
import { describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { runFileAuthoringAgent } from "../../src/runtime/file-authoring-agent.ts";

describe("runFileAuthoringAgent", () => {
  test("copies fixture outputs into allowed roots and records stub metadata", async () => {
    const root = await mkdtemp(join(tmpdir(), "myelin-agent-root-"));
    const runDir = join(root, "projects", "demo", "runs", "project-learn", "run-1");
    const fixtureDir = join(root, "fixtures", "planner");
    await mkdir(join(fixtureDir, "draft-wiki"), { recursive: true });
    await writeFile(join(fixtureDir, "draft-wiki", "index.md"), "# Demo\n", "utf8");

    const result = await runFileAuthoringAgent({
      root,
      projectKey: "demo",
      stageId: "planner",
      prompt: "write docs",
      runDir,
      targetRepoDir: root,
      workspaceDir: join(runDir, "agents", "planner"),
      outputRoots: [{ name: "draft_wiki", relativePath: "draft-wiki" }],
      provider: "codex",
      env: { FILE_AUTHORING_STUB_OUTPUTS_DIR: join(root, "fixtures") },
    });

    expect(result.status).toBe("completed");
    expect(result.provider_mode).toBe("stub");
    expect(result.discovered_outputs.map((item) => item.relative_path)).toEqual(["draft-wiki/index.md"]);
    const metadata = JSON.parse(await readFile(join(runDir, "agents", "planner", "file-authoring-agent-result.json"), "utf8"));
    expect(metadata.cwd).toBe(join(runDir, "agents", "planner"));
  });
});
```

- [ ] **Step 2: Run the focused test**

Run: `bun test tests/runtime/file-authoring-agent.test.ts`  
Expected: fails because the runner module does not exist.

- [ ] **Step 3: Implement public types and constants**

```ts
import { createHash } from "node:crypto";
import { cp, mkdir, readdir, readFile, stat, writeFile } from "node:fs/promises";
import { isAbsolute, join, relative, resolve, sep } from "node:path";
import type { Provider, Workload } from "./config.ts";
import { resolveInvocation, type ProcessRunner } from "./llm-client.ts";
import { runProcess } from "./process.ts";
import { resolveInside } from "./fs.ts";

export const FILE_AUTHORING_AGENT_RESULT = "file-authoring-agent-result.json" as const;
export const FILE_AUTHORING_STUB_OUTPUTS_DIR = "FILE_AUTHORING_STUB_OUTPUTS_DIR" as const;

export type FileAuthoringOutputRoot = {
  name: string;
  relativePath: string;
};

export type FileAuthoringAgentInput = {
  root: string;
  projectKey: string;
  stageId: string;
  prompt: string;
  runDir: string;
  targetRepoDir: string;
  workspaceDir: string;
  outputRoots: FileAuthoringOutputRoot[];
  workload?: Workload;
  provider?: Provider;
  modelOverride?: string;
  env?: NodeJS.ProcessEnv;
  runner?: ProcessRunner;
  timeoutMs?: number;
};

export type FileAuthoringDiscoveredOutput = {
  root_name: string;
  relative_path: string;
  absolute_path: string;
  size_bytes: number;
};

export type FileAuthoringAgentResult = {
  schema_version: 1;
  project_key: string;
  stage_id: string;
  status: "completed" | "failed";
  provider_mode: "live" | "stub" | "test";
  provider: Provider;
  model?: string;
  sandbox: "workspace-write";
  cwd: string;
  target_repo_snapshot: string;
  allowed_output_roots: FileAuthoringOutputRoot[];
  discovered_outputs: FileAuthoringDiscoveredOutput[];
  result_ref: typeof FILE_AUTHORING_AGENT_RESULT;
  error?: string;
};
```

### Task 2: Implement Live And Fixture Execution

**Files:**
- Modify: `src/runtime/file-authoring-agent.ts`
- Test: `tests/runtime/file-authoring-agent.test.ts`

- [ ] **Step 1: Add process invocation test**

```ts
test("invokes codex in a run-local cwd with workspace-write sandbox", async () => {
  const commands: string[][] = [];
  const root = await mkdtemp(join(tmpdir(), "myelin-agent-root-"));
  const runDir = join(root, "projects", "demo", "runs", "project-learn", "run-2");
  const result = await runFileAuthoringAgent({
    root,
    projectKey: "demo",
    stageId: "writer",
    prompt: "write docs",
    runDir,
    targetRepoDir: root,
    workspaceDir: join(runDir, "agents", "writer"),
    outputRoots: [{ name: "subject", relativePath: "subject" }],
    provider: "codex",
    runner: async (command, options) => {
      commands.push(command);
      expect(options?.cwd).toBe(join(runDir, "agents", "writer"));
      expect(options?.stdin).toContain("write docs");
      expect(options?.stdin).toContain("target-repo");
      await writeFile(join(runDir, "agents", "writer", "subject", "topic.md"), "# Topic\n");
      return { stdout: "done", stderr: "", exitCode: 0 };
    },
  });

  expect(result.status).toBe("completed");
  expect(commands[0]).toContain("--sandbox");
  expect(commands[0]).toContain("workspace-write");
  expect(result.discovered_outputs.map((item) => item.relative_path)).toEqual(["subject/topic.md"]);
});
```

- [ ] **Step 2: Implement run flow**

Core implementation:

```ts
export async function runFileAuthoringAgent(input: FileAuthoringAgentInput): Promise<FileAuthoringAgentResult> {
  const env = input.env ?? process.env;
  await mkdir(input.workspaceDir, { recursive: true });
  const targetRepoSnapshot = await prepareTargetRepoSnapshot(input);
  const allowed = input.outputRoots.map((root) => ({
    ...root,
    absolutePath: resolveInside(input.workspaceDir, root.relativePath),
  }));
  for (const root of allowed) await mkdir(root.absolutePath, { recursive: true });
  const before = await snapshotWorkspaceFiles(input.workspaceDir);

  const stubRoot = env[FILE_AUTHORING_STUB_OUTPUTS_DIR];
  const resolved = await resolveInvocation(input.root, input.workload ?? "pipeline", input.provider, input.modelOverride, env);

  try {
    if (stubRoot) {
      await copyFixtureOutputs(stubRoot, input.stageId, input.workspaceDir);
    } else {
      await invokeLiveFileAuthoringAgent(input, resolved, env, targetRepoSnapshot);
    }
    await assertNoWritesOutsideAllowedRoots(input.workspaceDir, allowed, before);
    const discovered = await discoverOutputs(allowed);
    const result = agentResult(input, resolved, stubRoot ? "stub" : "live", "completed", discovered, targetRepoSnapshot);
    await writeResult(input.workspaceDir, result);
    return result;
  } catch (error) {
    const result = agentResult(input, resolved, stubRoot ? "stub" : "live", "failed", [], errorMessage(error), targetRepoSnapshot);
    await writeResult(input.workspaceDir, result);
    return result;
  }
}
```

Target repo read access is provided through a run-local snapshot, not by setting cwd to the target repo:

```ts
async function prepareTargetRepoSnapshot(input: FileAuthoringAgentInput): Promise<string> {
  const snapshotDir = resolveInsideWorkspace(input.workspaceDir, "target-repo");
  await cp(input.targetRepoDir, snapshotDir, {
    recursive: true,
    filter: (source) => {
      const rel = relative(input.targetRepoDir, source);
      if (rel === "") return true;
      if (rel === ".git" || rel.startsWith(`.git${sep}`)) return false;
      if (rel.startsWith(`projects${sep}${input.projectKey}${sep}runs${sep}`)) return false;
      return true;
    },
  });
  return snapshotDir;
}
```

Codex command behavior:

```ts
async function invokeLiveFileAuthoringAgent(
  input: FileAuthoringAgentInput,
  resolved: { provider: Provider; model?: string; reasoningEffort?: string },
  env: NodeJS.ProcessEnv,
  targetRepoSnapshot: string,
): Promise<void> {
  if (resolved.provider !== "codex") throw new Error("file-authoring agents currently require codex provider");
  const command = [env.CODEX_BIN ?? "codex", "exec", "--skip-git-repo-check", "--sandbox", "workspace-write"];
  if (resolved.model) command.push("--model", resolved.model);
  if (resolved.reasoningEffort) command.push("-c", `model_reasoning_effort="${resolved.reasoningEffort}"`);
  command.push("-");
  const runner = input.runner ?? runProcess;
  const output = await runner(command, {
    cwd: input.workspaceDir,
    stdin: [
      input.prompt,
      "",
      `Target repository snapshot: ${targetRepoSnapshot}`,
      "Read repository files from target-repo/. Write only to the explicit output roots named in the prompt.",
    ].join("\n"),
    env,
    timeoutMs: input.timeoutMs,
  });
  if (output.exitCode !== 0) throw new Error(`file-authoring agent failed: ${output.stderr || output.stdout}`);
}
```

- [ ] **Step 3: Run focused live-invocation test**

Run: `bun test tests/runtime/file-authoring-agent.test.ts`  
Expected: fixture and runner-command tests pass.

### Task 3: Enforce Output Roots And Path Escapes

**Files:**
- Modify: `src/runtime/file-authoring-agent.ts`
- Test: `tests/runtime/file-authoring-agent.test.ts`

- [ ] **Step 1: Add path escape test**

```ts
test("fails when an output root escapes the run-local workspace", async () => {
  const root = await mkdtemp(join(tmpdir(), "myelin-agent-root-"));
  const runDir = join(root, "projects", "demo", "runs", "project-learn", "run-3");
  const result = await runFileAuthoringAgent({
    root,
    projectKey: "demo",
    stageId: "escape",
    prompt: "write docs",
    runDir,
    targetRepoDir: root,
    workspaceDir: join(runDir, "agents", "escape"),
    outputRoots: [{ name: "bad", relativePath: "../../wiki" }],
    provider: "codex",
    env: { FILE_AUTHORING_STUB_OUTPUTS_DIR: join(root, "fixtures") },
  });

  expect(result.status).toBe("failed");
  expect(result.error).toContain("outside file-authoring workspace");
});

test("fails when the agent writes outside allowed output roots", async () => {
  const root = await mkdtemp(join(tmpdir(), "myelin-agent-root-"));
  const runDir = join(root, "projects", "demo", "runs", "project-learn", "run-4");
  const result = await runFileAuthoringAgent({
    root,
    projectKey: "demo",
    stageId: "stray-write",
    prompt: "write docs",
    runDir,
    targetRepoDir: root,
    workspaceDir: join(runDir, "agents", "stray-write"),
    outputRoots: [{ name: "draft_wiki", relativePath: "draft-wiki" }],
    provider: "codex",
    runner: async (_command, options) => {
      await writeFile(join(String(options?.cwd), "extra.md"), "# outside\n", "utf8");
      return { stdout: "done", stderr: "", exitCode: 0 };
    },
  });

  expect(result.status).toBe("failed");
  expect(result.error).toContain("outside allowed output roots");
});
```

- [ ] **Step 2: Implement root checks and discovery**

Use `resolveInside(input.workspaceDir, root.relativePath)` for every output root. If `resolveInside` currently resolves against repo root semantics only, add a local helper in this module:

```ts
function resolveInsideWorkspace(workspaceDir: string, relativePath: string): string {
  const absolute = resolve(workspaceDir, relativePath);
  const rel = relative(workspaceDir, absolute);
  if (rel.startsWith("..") || rel === ".." || isAbsolute(rel)) {
    throw new Error(`output root ${relativePath} resolves outside file-authoring workspace`);
  }
  return absolute;
}
```

Discovery must recurse only inside allowed roots:

```ts
async function discoverOutputs(
  roots: Array<FileAuthoringOutputRoot & { absolutePath: string }>,
): Promise<FileAuthoringDiscoveredOutput[]> {
  const outputs: FileAuthoringDiscoveredOutput[] = [];
  for (const root of roots) {
    for (const file of await listFiles(root.absolutePath)) {
      outputs.push({
        root_name: root.name,
        relative_path: `${root.relativePath}/${relative(root.absolutePath, file)}`,
        absolute_path: file,
        size_bytes: (await stat(file)).size,
      });
    }
  }
  return outputs.sort((a, b) => a.relative_path.localeCompare(b.relative_path));
}
```

Workspace mutation enforcement must inspect the whole workspace, not just allowed roots:

```ts
type WorkspaceSnapshot = Map<string, { sha256: string; size: number }>;

async function snapshotWorkspaceFiles(workspaceDir: string): Promise<WorkspaceSnapshot> {
  const snapshot: WorkspaceSnapshot = new Map();
  for (const file of await listFiles(workspaceDir)) {
    const rel = relative(workspaceDir, file);
    snapshot.set(rel, { sha256: await sha256File(file), size: (await stat(file)).size });
  }
  return snapshot;
}

async function assertNoWritesOutsideAllowedRoots(
  workspaceDir: string,
  allowedRoots: Array<FileAuthoringOutputRoot & { absolutePath: string }>,
  before: WorkspaceSnapshot,
): Promise<void> {
  const after = await snapshotWorkspaceFiles(workspaceDir);
  for (const [relativePath, metadata] of after) {
    const previous = before.get(relativePath);
    const changed = !previous || previous.sha256 !== metadata.sha256 || previous.size !== metadata.size;
    if (!changed) continue;
    const absolutePath = join(workspaceDir, relativePath);
    const allowed = allowedRoots.some((root) => isInsideOrEqual(root.absolutePath, absolutePath));
    if (!allowed) throw new Error(`agent wrote outside allowed output roots: ${relativePath}`);
  }
}

function isInsideOrEqual(parent: string, child: string): boolean {
  const rel = relative(parent, child);
  return rel === "" || (!rel.startsWith("..") && rel !== ".." && !isAbsolute(rel));
}

async function sha256File(path: string): Promise<string> {
  return createHash("sha256").update(await readFile(path)).digest("hex");
}
```

- [ ] **Step 3: Run safety tests**

Run: `bun test tests/runtime/file-authoring-agent.test.ts`  
Expected: passes, including path escape failure and output discovery.

### Task 4: Add Infrastructure Wrapper

**Files:**
- Modify: `src/runtime/project-run-infrastructure.ts`
- Test: `tests/runtime/project-run-infrastructure.test.ts`

- [ ] **Step 1: Export wrapper**

```ts
import {
  runFileAuthoringAgent,
  type FileAuthoringAgentInput,
  type FileAuthoringAgentResult,
} from "./file-authoring-agent.ts";

export async function invokeFileAuthoringAgent(input: FileAuthoringAgentInput): Promise<FileAuthoringAgentResult> {
  return await runFileAuthoringAgent(input);
}
```

- [ ] **Step 2: Test wrapper behavior**

Add a small test that calls `invokeFileAuthoringAgent` with `FILE_AUTHORING_STUB_OUTPUTS_DIR` and expects `provider_mode` to be `stub`.

- [ ] **Step 3: Run infrastructure tests**

Run: `bun test tests/runtime/project-run-infrastructure.test.ts tests/runtime/file-authoring-agent.test.ts`  
Expected: passes.

## Verification

- Run: `bun test tests/runtime/file-authoring-agent.test.ts`  
  Expected: pass with coverage for allowed output roots, path escapes, run-local cwd, provider/stub metadata, and filesystem output discovery.
- Run: `bun test tests/runtime/project-run-infrastructure.test.ts`  
  Expected: pass.
- Run: `bun test tests/runtime/llm-client.test.ts`  
  Expected: existing JSON-only read-only assertions still pass.
- Run: `bun run typecheck`  
  Expected: pass.

## Acceptance Criteria Covered

- File-authoring agents do not use JSON-only `invokeLlm`.
- Agents write only inside a run-local workspace.
- Canonical project files are never directly writable by the agent runner.
- Stub mode can populate deterministic output files for tests.
- Runner metadata records provider mode, provider, model, sandbox, cwd, allowed roots, and discovered outputs.
- Output-root path escapes fail closed.

## Risks And Rollback

- Risk: Codex provider CLI flags may drift. Rollback is isolated to `file-authoring-agent.ts` because create and maintenance import the wrapper.
- Risk: fixture copying could hide live-provider issues. Chunk `08` requires live dogfood with stub env unset.
- Rollback: remove `src/runtime/file-authoring-agent.ts` and wrapper exports; later chunks cannot run without this boundary.

## Non-Goals

- Does not build create or maintenance prompts.
- Does not promote generated files.
- Does not support Claude file-authoring agents.
- Does not infer documentation structure.

## Type And Name Consistency

- Runner function: `runFileAuthoringAgent`.
- Infrastructure wrapper: `invokeFileAuthoringAgent`.
- Result artifact: `file-authoring-agent-result.json`.
- Stub env var: `FILE_AUTHORING_STUB_OUTPUTS_DIR`.
- Sandbox metadata value: `workspace-write`.
