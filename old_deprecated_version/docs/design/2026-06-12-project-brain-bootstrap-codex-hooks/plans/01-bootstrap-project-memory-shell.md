# Chunk 01: Bootstrap Project Memory Shell

**Plan Set:** `../plan.md`
**Spec:** `../spec.md`
**Status:** Ready For Implementation
**Depends on:** None
**Enables:** `02-experience-log-storage.md`, `04-capture-routing-and-errors.md`, `06-class-kit-verification.md`

## Goal

Add top-level `myelin bootstrap <key> --repo <absolute-path>` so a local software repo can be explicitly registered as a Myelin project. The command creates the Project Memory Shell, records canonical repo routing metadata, writes only uncurated placeholder memory, and reconciles stale `project onboard` vocabulary where it would confuse this first slice.

## Source Artifacts

- `../spec.md`: Repo Bootstrap Input, User-Facing Behavior, V1 Boundary.
- `../agenda.md`: Questions 5, 14, 20, 21, 35, 36.
- `../../../CONTEXT.md`: Bootstrap Command, Project Memory Shell, V2 CLI Vocabulary.
- `../../../docs/adr/0055-use-global-install-with-per-repo-capture-opt-in.md`.
- Existing code: `src/cli.ts`, `src/commands/project.ts`, `src/runtime/fs.ts`, `src/runtime/layout.ts`, `src/runtime/projects.ts`, `src/runtime/json.ts`, `src/runtime/layout.test.ts`, `src/runtime/runtime.test.ts`, `Makefile`, `schema/global.md`, `schema/schema-context.md`, `src/schema/compiler.ts`.

## Relationships

- **Depends on:** no prior implementation chunks.
- **Enables:** capture routing can resolve bootstrapped projects by `repo_paths`; manual `class-kit` verification can register `/Users/liadgoren/Repositories/class-kit`.
- **Shared contracts:** top-level command `myelin bootstrap <key> --repo <absolute-path>`; project registry `projects/<key>/state/project.json`; required project dirs `sources`, `wiki`, `schema`, `state`, `log`, `runs`; uncurated `wiki/index.md`.
- **Integration points:** CLI registry, runtime project layout, project discovery, schema command vocabulary, Make convenience alias. Bootstrap creates the project shell and schema directory but does not run `schema build`; it only makes the project eligible for a later explicit `schema build <key>`.

## File Responsibility Map

**Create:**
- `src/runtime/bootstrap.ts` - project shell creation, repo path validation, idempotency, and collision checks.
- `src/runtime/bootstrap.test.ts` - runtime behavior tests for shell creation and rerun/collision cases.
- `src/commands/bootstrap.ts` - top-level CLI command parser and output rendering.
- `src/commands/bootstrap.test.ts` - CLI parser/output tests.

**Modify:**
- `src/cli.ts` - register the top-level bootstrap command.
- `src/commands/project.ts` - remove or de-emphasize the unimplemented `project onboard` command if no compatibility alias is kept.
- `Makefile` - replace `onboard` convenience target with `bootstrap`.
- `schema/global.md` - replace `project onboard` vocabulary with `bootstrap`.
- `schema/schema-context.md` - update documented compiled command list.
- `src/schema/compiler.ts` - update `REQUIRED_CONTEXT_COMMANDS` so generated schema context matches V2 command vocabulary.

**Test:**
- `src/runtime/bootstrap.test.ts` - filesystem shell and metadata.
- `src/commands/bootstrap.test.ts` - CLI usage and errors.
- Existing schema tests - ensure command vocabulary output stays consistent.

## Implementation Tasks

### Task 1: Add Runtime Bootstrap Contract

**Files:**
- Create: `src/runtime/bootstrap.ts`
- Test: `src/runtime/bootstrap.test.ts`

- [ ] **Step 1: Add runtime tests first**

```ts
import { afterEach, beforeEach, expect, test } from "bun:test";
import { mkdir, mkdtemp, readFile, rm } from "node:fs/promises";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { bootstrapProject } from "./bootstrap.ts";
import { readJson } from "./json.ts";

let root: string;
let repo: string;

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "myelin-bootstrap-"));
  repo = join(root, "repos", "class-kit");
  await mkdir(repo, { recursive: true });
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

test("bootstrap creates an uncurated project memory shell", async () => {
  const result = await bootstrapProject(root, "class-kit", repo, {
    now: new Date("2026-06-12T10:00:00.000Z"),
  });

  expect(result.projectKey).toBe("class-kit");
  expect(result.created).toContain("projects/class-kit/state/project.json");
  expect(result.created).toContain("projects/class-kit/wiki/index.md");

  const project = await readJson<{ key: string; repo_paths: string[] }>(
    join(root, "projects", "class-kit", "state", "project.json"),
  );
  expect(project).toEqual({
    key: "class-kit",
    name: "class-kit",
    repo_paths: [resolve(repo)],
  });

  expect(await readFile(join(root, "projects", "class-kit", "wiki", "index.md"), "utf8")).toContain(
    "Project Memory has not been curated yet.",
  );
});

test("bootstrap rerun is idempotent and does not overwrite curated index", async () => {
  await bootstrapProject(root, "class-kit", repo);
  const indexPath = join(root, "projects", "class-kit", "wiki", "index.md");
  await Bun.write(indexPath, "Curated content\n");

  const result = await bootstrapProject(root, "class-kit", repo);

  expect(result.created).toEqual([]);
  expect(result.kept).toContain("projects/class-kit/wiki/index.md");
  expect(await readFile(indexPath, "utf8")).toBe("Curated content\n");
});

test("bootstrap rejects relative repo paths and invalid project keys", async () => {
  await expect(bootstrapProject(root, "Class Kit", repo)).rejects.toThrow("Invalid project key");
  await expect(bootstrapProject(root, "class-kit", "relative/path")).rejects.toThrow(
    "Repo path must be absolute",
  );
});

test("bootstrap rejects repo path already registered to another key", async () => {
  await bootstrapProject(root, "class-kit", repo);

  await expect(bootstrapProject(root, "other", repo)).rejects.toThrow(
    "Repo path is already registered to project class-kit",
  );
});
```

- [ ] **Step 2: Run the focused test**

Run: `bun test src/runtime/bootstrap.test.ts`  
Expected: fails because `src/runtime/bootstrap.ts` does not exist.

- [ ] **Step 3: Implement runtime bootstrap helper**

```ts
import { mkdir, stat, writeFile } from "node:fs/promises";
import { isAbsolute, resolve } from "node:path";
import { assertProjectKey, projectPath } from "./fs.ts";
import { projectLayout } from "./layout.ts";
import { discoverProjects } from "./projects.ts";
import { readJsonIfExists, writeJson } from "./json.ts";

export type BootstrapResult = {
  projectKey: string;
  repoPath: string;
  created: string[];
  kept: string[];
};

type ProjectConfig = {
  key: string;
  name?: string;
  repo_paths?: string[];
};

export async function bootstrapProject(
  root: string,
  projectKey: string,
  repoPath: string,
  _options: { now?: Date } = {},
): Promise<BootstrapResult> {
  assertProjectKey(projectKey);
  if (!isAbsolute(repoPath)) throw new Error("Repo path must be absolute");

  const resolvedRepo = resolve(repoPath);
  await assertDirectory(resolvedRepo, "Repo path does not exist");
  await assertRepoPathAvailable(root, projectKey, resolvedRepo);

  const paths = projectLayout(root, projectKey);
  const created: string[] = [];
  const kept: string[] = [];

  for (const dir of ["sources", "wiki", "schema", "state", "log", "runs"] as const) {
    const path = paths[dir];
    if (await exists(path)) kept.push(`projects/${projectKey}/${dir}`);
    else {
      await mkdir(path, { recursive: true });
      created.push(`projects/${projectKey}/${dir}`);
    }
  }

  const projectJsonPath = projectPath(root, projectKey, "state", "project.json");
  const existingConfig = await readJsonIfExists<ProjectConfig>(projectJsonPath);
  const nextConfig: ProjectConfig = {
    key: projectKey,
    name: existingConfig?.name ?? projectKey,
    repo_paths: mergeRepoPaths(existingConfig?.repo_paths ?? [], resolvedRepo),
  };
  if (!existingConfig) created.push(`projects/${projectKey}/state/project.json`);
  else kept.push(`projects/${projectKey}/state/project.json`);
  await writeJson(projectJsonPath, nextConfig);

  const indexPath = projectPath(root, projectKey, "wiki", "index.md");
  if (await exists(indexPath)) kept.push(`projects/${projectKey}/wiki/index.md`);
  else {
    await writeFile(
      indexPath,
      [
        `# ${projectKey}`,
        "",
        "Project Memory has not been curated yet.",
        "",
        `Registered repo: \`${resolvedRepo}\``,
        "",
      ].join("\n"),
      "utf8",
    );
    created.push(`projects/${projectKey}/wiki/index.md`);
  }

  const bootstrapStatePath = projectPath(root, projectKey, "state", "bootstrap-state.json");
  if (await exists(bootstrapStatePath)) kept.push(`projects/${projectKey}/state/bootstrap-state.json`);
  else {
    await writeJson(bootstrapStatePath, {
      status: "uncurated",
      missing: ["curated_project_memory", "experience_log_capture_verification"],
    });
    created.push(`projects/${projectKey}/state/bootstrap-state.json`);
  }

  return { projectKey, repoPath: resolvedRepo, created, kept };
}

async function assertRepoPathAvailable(root: string, projectKey: string, repoPath: string): Promise<void> {
  for (const project of await discoverProjects(root)) {
    if (project.key === projectKey) continue;
    for (const existing of project.config.repo_paths ?? []) {
      if (resolve(existing) === repoPath) {
        throw new Error(`Repo path is already registered to project ${project.key}`);
      }
    }
  }
}

function mergeRepoPaths(existing: string[], repoPath: string): string[] {
  return [...new Set([...existing.map((path) => resolve(path)), repoPath])].sort();
}

async function assertDirectory(path: string, message: string): Promise<void> {
  try {
    if (!(await stat(path)).isDirectory()) throw new Error(message);
  } catch (error) {
    if (error && typeof error === "object" && "code" in error && error.code === "ENOENT") {
      throw new Error(message);
    }
    throw error;
  }
}

async function exists(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch (error) {
    if (error && typeof error === "object" && "code" in error && error.code === "ENOENT") return false;
    throw error;
  }
}
```

- [ ] **Step 4: Run focused runtime test**

Run: `bun test src/runtime/bootstrap.test.ts`  
Expected: passes.

### Task 2: Add Top-Level Bootstrap CLI

**Files:**
- Create: `src/commands/bootstrap.ts`
- Create: `src/commands/bootstrap.test.ts`
- Modify: `src/cli.ts`

- [ ] **Step 1: Add command tests**

```ts
import { afterEach, beforeEach, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createCli } from "./registry.ts";
import { registerBootstrapCommand } from "./bootstrap.ts";

let root: string;
let repo: string;
let oldCwd: string;

beforeEach(async () => {
  oldCwd = process.cwd();
  root = await mkdtemp(join(tmpdir(), "myelin-bootstrap-cli-"));
  repo = join(root, "repos", "class-kit");
  await mkdir(repo, { recursive: true });
  process.chdir(root);
});

afterEach(async () => {
  process.chdir(oldCwd);
  await rm(root, { recursive: true, force: true });
});

test("bootstrap command creates a project shell", async () => {
  const cli = createCli("myelin");
  registerBootstrapCommand(cli);

  const result = await cli.run(["bootstrap", "class-kit", "--repo", repo]);

  expect(result.exitCode).toBe(0);
  expect(result.message).toContain("Bootstrapped project class-kit.");
  expect(result.message).toContain("repo:");
});

test("bootstrap command requires key and repo", async () => {
  const cli = createCli("myelin");
  registerBootstrapCommand(cli);

  expect((await cli.run(["bootstrap"])).message).toContain("Usage: myelin bootstrap <project-key> --repo <absolute-path>");
  expect((await cli.run(["bootstrap", "class-kit"])).message).toContain("--repo requires an absolute path");
});
```

- [ ] **Step 2: Run focused CLI test**

Run: `bun test src/commands/bootstrap.test.ts`  
Expected: fails because `registerBootstrapCommand` does not exist.

- [ ] **Step 3: Implement command parser**

```ts
import type { Cli } from "./registry.ts";
import { fail, ok } from "./registry.ts";
import { repoRoot } from "../runtime/fs.ts";
import { bootstrapProject } from "../runtime/bootstrap.ts";

export function registerBootstrapCommand(cli: Cli): void {
  cli.command(["bootstrap"], async (args) => {
    const parsed = parseArgs(args);
    if (parsed.error) return fail(parsed.error);

    try {
      const result = await bootstrapProject(repoRoot().root, parsed.projectKey, parsed.repoPath);
      return ok(
        [
          `Bootstrapped project ${result.projectKey}.`,
          `repo: ${result.repoPath}`,
          `created: ${result.created.length}`,
          `kept: ${result.kept.length}`,
        ].join("\n"),
      );
    } catch (error) {
      return fail(error instanceof Error ? error.message : String(error));
    }
  });
}

function parseArgs(args: string[]): { projectKey: string; repoPath: string; error?: string } {
  let projectKey = "";
  let repoPath = "";

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === "--repo") {
      repoPath = args[++index] ?? "";
      if (!repoPath) return { projectKey, repoPath, error: "--repo requires an absolute path" };
    } else if (arg.startsWith("-")) {
      return { projectKey, repoPath, error: `Unknown bootstrap option: ${arg}` };
    } else if (!projectKey) {
      projectKey = arg;
    } else {
      return { projectKey, repoPath, error: `Unexpected bootstrap argument: ${arg}` };
    }
  }

  if (!projectKey || !repoPath) {
    return { projectKey, repoPath, error: "Usage: myelin bootstrap <project-key> --repo <absolute-path>" };
  }

  return { projectKey, repoPath };
}
```

- [ ] **Step 4: Register command in `src/cli.ts`**

```ts
import { registerBootstrapCommand } from "./commands/bootstrap.ts";
```

Add this registration before project commands:

```ts
registerBootstrapCommand(cli);
```

- [ ] **Step 5: Run command tests**

Run: `bun test src/commands/bootstrap.test.ts`  
Expected: passes.

### Task 3: Reconcile Stale Onboard Vocabulary

**Files:**
- Modify: `src/commands/project.ts`
- Modify: `Makefile`
- Modify: `schema/global.md`
- Modify: `schema/schema-context.md`
- Modify: `src/schema/compiler.ts`

- [ ] **Step 1: Replace unimplemented project onboard stub**

In `src/commands/project.ts`, remove the `project onboard` registration unless a compatibility alias is explicitly desired during implementation review. Preferred first-slice behavior is that `myelin project onboard` is not listed in help.

- [ ] **Step 2: Update Makefile target**

Replace:

```make
.PHONY: status query learn ingest onboard schema-check schema-build session-close test typecheck
```

with:

```make
.PHONY: status query learn ingest bootstrap schema-check schema-build session-close test typecheck
```

Replace:

```make
onboard:
	$(MYELIN) project onboard $(PROJECT)
```

with:

```make
bootstrap:
	$(MYELIN) bootstrap $(PROJECT) --repo $(REPO)
```

Add near the top:

```make
REPO ?=
```

- [ ] **Step 3: Update schema vocabulary**

In `src/schema/compiler.ts`, replace `"project onboard"` in `REQUIRED_CONTEXT_COMMANDS` with `"bootstrap"`.

In `schema/global.md`, change operator verbs to:

```md
Operator verbs: `bootstrap`, `project learn|ingest`, `memory query`, `status`, `schema check|build`, `session close`. `schema candidates|apply` are deferred (ADR 0049). Old `compile`/`update`/`ask` names are not the product vocabulary.
```

In `schema/schema-context.md`, update the command list to include `"bootstrap"` instead of `"project onboard"`.

- [ ] **Step 4: Run vocabulary-related tests**

Run: `bun test src/commands/bootstrap.test.ts src/schema`  
Expected: all matching tests pass, and schema tests expecting compiled command vocabulary are updated to `"bootstrap"` if they fail.

## Verification

Run: `bun test src/runtime/bootstrap.test.ts src/commands/bootstrap.test.ts src/runtime/runtime.test.ts src/runtime/layout.test.ts`  
Expected: all tests pass.

Run: `bun run typecheck`  
Expected: TypeScript completes without errors.

Run: `bun src/cli.ts --help`  
Expected: output includes `myelin bootstrap` and does not advertise the unimplemented `myelin project onboard`.

Run: `bun src/cli.ts bootstrap class-kit --repo /Users/liadgoren/Repositories/class-kit`  
Expected: creates or updates `projects/class-kit/state/project.json` and prints `Bootstrapped project class-kit.`. If this is run before the user is ready to create `projects/class-kit`, stop and use a temp repo path for smoke testing instead.

## Acceptance Criteria Covered

- Top-level Bootstrap Command exists.
- Bootstrap creates Project Memory Shell without curated facts.
- Same key/path rerun is idempotent.
- Repo path registered to another key fails loudly.
- Explicit slug key and absolute repo path are required.
- Stale `project onboard` vocabulary is reconciled where it affects this slice.
- Bootstrap does not build generated schema context; it creates enough project structure for a later explicit `schema build <key>` command.

## Risks And Rollback

- Risk: running the real `class-kit` bootstrap creates project files in this repo. Use temp-root tests first.
- Rollback: remove created `projects/<key>/` only when it was created by this test run and contains no user-curated content; otherwise leave it and document cleanup.
- Risk: schema command vocabulary update may affect existing schema tests. Fix tests to reflect approved V2 vocabulary, not old `project onboard`.

## Non-Goals

- Do not install hooks.
- Do not write Experience Log rows.
- Do not generate curated Project Memory.
- Do not run `project learn` or `project ingest`.
- Do not run `schema build`.

## Type And Name Consistency

- Exported runtime helper: `bootstrapProject`.
- Exported command registration: `registerBootstrapCommand`.
- Command string: `bootstrap`.
- Project config field: `repo_paths`.
- Placeholder file: `projects/<key>/wiki/index.md`.
