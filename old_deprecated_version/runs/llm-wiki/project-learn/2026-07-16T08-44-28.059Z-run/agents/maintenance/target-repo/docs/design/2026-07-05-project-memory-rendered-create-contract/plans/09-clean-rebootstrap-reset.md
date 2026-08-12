# Chunk 09: Clean Rebootstrap Reset

**Plan Set:** `../plan.md`
**Spec:** `../spec.md`
**Status:** Ready For Implementation
**Depends on:** `08-all-or-nothing-promotion-state.md`
**Enables:** `10-dogfood-regression-slice.md`

## Goal

Add an explicit destructive operator command that deletes and recreates `projects/<key>/` project-shell material while preserving the repo-root SQLite memory database at `state/memory.db`. The resolved CLI spelling is `myelin project reset <project-key> --clean --confirm <project-key> [--json]`.

## Source Artifacts

- `../spec.md`: Clean Rebootstrap Reset.
- `../agenda.md`: Question 6.
- `../../../adr/0066-allow-clean-project-shell-rebootstrap-reset.md`
- `src/commands/project.ts`
- `src/runtime/bootstrap.ts`
- `src/runtime/project-shell.ts`
- `src/memory/db.ts`
- `tests/commands/project.test.ts`

## Relationships

- **Depends on:** Terminal create state distinguishes trusted/untrusted project memory.
- **Enables:** Dogfood regression can start from a clean shell without wiping Session Memory/candidates.
- **Shared contracts:** `project reset <key> --clean --confirm <key> [--json]`.
- **Integration points:** CLI command, project config discovery, bootstrap repair/recreate, filesystem deletion scoped to `projects/<key>`.

## File Responsibility Map

**Create:**
- `src/project/project-reset-service.ts` - reset/rebootstrap service with path safety and memory DB preservation check.
- `tests/project/project-reset-service.test.ts` - service-level reset tests if command tests become too broad.

**Modify:**
- `src/commands/project.ts` - register `project reset`.
- `src/project/project-service.ts` - expose reset service if project commands route through `ProjectService`.

**Test:**
- `tests/commands/project.test.ts` - command parsing, confirmation, JSON output, memory DB preservation.

## Implementation Tasks

### Task 1: Implement Reset Service

**Files:**
- Create: `src/project/project-reset-service.ts`
- Test: `tests/project/project-reset-service.test.ts`

- [ ] **Step 1: Add service contract**

```ts
import { rm } from "node:fs/promises";
import { existsSync } from "node:fs";
import { memoryDbPath } from "../memory/db.ts";
import { bootstrapProject } from "../runtime/bootstrap.ts";
import { projectPath, resolveInside } from "../runtime/fs.ts";
import { findProject } from "../runtime/projects.ts";

export type ProjectResetResult = {
  project_key: string;
  reset_scope: "project_shell";
  deleted_project_path: string;
  preserved_memory_db: string;
  bootstrap_status: string;
};
```

- [ ] **Step 2: Add clean reset method**

```ts
export class ProjectResetService {
  constructor(private readonly root: string) {}

  async cleanRebootstrap(projectKey: string): Promise<ProjectResetResult> {
    const project = await findProject(this.root, projectKey);
    const repoPath = project.config.repo_paths?.[0];
    if (!repoPath) throw new Error(`Project ${projectKey} has no repo path to rebootstrap from.`);

    const memoryDb = memoryDbPath(this.root);
    const hadMemoryDb = existsSync(memoryDb);
    const projectDir = projectPath(this.root, projectKey);
    const projectsRoot = resolveInside(this.root, "projects");
    if (!projectDir.startsWith(`${projectsRoot}/`)) {
      throw new Error(`Refusing to reset unsafe project path: ${projectDir}`);
    }

    await rm(projectDir, { recursive: true, force: true });
    const bootstrap = await bootstrapProject(this.root, projectKey, repoPath);

    if (hadMemoryDb && !existsSync(memoryDb)) {
      throw new Error("Clean project reset must preserve existing root state/memory.db.");
    }

    return {
      project_key: projectKey,
      reset_scope: "project_shell",
      deleted_project_path: projectDir,
      preserved_memory_db: memoryDb,
      bootstrap_status: bootstrap.status,
    };
  }
}
```

If `bootstrapProject` returns a different status field, map the actual result to a stable string.

### Task 2: Add Explicit CLI Command

**Files:**
- Modify: `src/commands/project.ts`
- Test: `tests/commands/project.test.ts`

- [ ] **Step 1: Register command**

```ts
cli.command(["project", "reset"], async (args) => projectResetCommand(args));
```

- [ ] **Step 2: Parse destructive confirmation**

```ts
function parseProjectResetArgs(args: string[]): {
  projectKey: string;
  clean: boolean;
  confirm?: string;
  json: boolean;
  error?: string;
} {
  let projectKey = "";
  let clean = false;
  let confirm: string | undefined;
  let json = false;
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === "--clean") clean = true;
    else if (arg === "--json") json = true;
    else if (arg === "--confirm") confirm = args[++index];
    else if (arg.startsWith("-")) return { projectKey, clean, confirm, json, error: `Unknown project reset option: ${arg}` };
    else if (!projectKey) projectKey = arg;
    else return { projectKey, clean, confirm, json, error: `Unexpected project reset argument: ${arg}` };
  }
  if (!projectKey || !clean || confirm !== projectKey) {
    return { projectKey, clean, confirm, json, error: "Usage: myelin project reset <project-key> --clean --confirm <project-key> [--json]" };
  }
  return { projectKey, clean, confirm, json };
}
```

- [ ] **Step 3: Execute reset**

```ts
async function projectResetCommand(args: string[]) {
  const parsed = parseProjectResetArgs(args);
  if (parsed.error) return fail(parsed.error);
  try {
    const result = await new ProjectResetService(repoRoot().root).cleanRebootstrap(parsed.projectKey);
    if (parsed.json) return ok(stableJson(result));
    return ok([
      `Reset project shell for ${result.project_key}.`,
      `scope: ${result.reset_scope}`,
      `deleted: ${result.deleted_project_path}`,
      `preserved memory db: ${result.preserved_memory_db}`,
      `bootstrap: ${result.bootstrap_status}`,
    ].join("\n"));
  } catch (error) {
    return fail(error instanceof Error ? error.message : String(error));
  }
}
```

### Task 3: Test Memory DB Preservation

**Files:**
- Test: `tests/commands/project.test.ts`
- Test: `tests/project/project-reset-service.test.ts`

- [ ] **Step 1: Create fixture with root memory DB and project shell**

The test should create:

```text
state/memory.db
projects/llm-wiki/wiki/index.md
projects/llm-wiki/state/project-memory.json
```

Run reset, then assert:

```ts
expect(existsSync(join(root, "state", "memory.db"))).toBe(true);
expect(existsSync(join(root, "projects", "llm-wiki", "wiki", "index.md"))).toBe(false);
expect(existsSync(join(root, "projects", "llm-wiki", "state", "bootstrap-state.json"))).toBe(true);
```

Adjust the final bootstrap-state assertion to the actual bootstrap output path.

## Verification

- Run: `bun test tests/commands/project.test.ts`
  - Expected: exits 0; reset requires `--clean --confirm <key>` and preserves `state/memory.db`.
- Run: `bun test tests/project/project-reset-service.test.ts`
  - Expected: exits 0 if service-level tests were added.
- Run: `bun run typecheck`
  - Expected: exits 0.
- Run: `git diff --check`
  - Expected: no whitespace errors.

## Acceptance Criteria Covered

- Clean rebootstrap reset preserves root memory DB.
- Destructive behavior is explicit and preflighted.
- Ordinary `project learn` remains non-destructive.

## Risks And Rollback

- Risk: unsafe path deletion. Use `projectPath`/`resolveInside`, never accept raw filesystem paths from CLI.
- Rollback: remove command registration and reset service. No Project Memory create contract depends on this command at runtime.

## Non-Goals

- No memory wipe command.
- No automatic reset inside `project learn`.
- No archive/adopt behavior for old wiki files.

## Type And Name Consistency

Before finishing, verify command help, parser usage string, tests, and docs all use `myelin project reset <project-key> --clean --confirm <project-key> [--json]`.
