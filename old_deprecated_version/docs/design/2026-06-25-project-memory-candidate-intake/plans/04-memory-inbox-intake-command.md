# Chunk 04: Memory Inbox Intake Command

**Plan Set:** `../plan.md`  
**Spec:** `../spec.md`  
**Status:** Ready For Implementation  
**Depends on:** `03-project-candidate-intake-service.md`  
**Enables:** deterministic operator/test access to source-to-candidate conversion

## Goal

Expose `myelin memory inbox intake <project-key>` as a provider-free deterministic command that calls `ProjectMemoryCandidateIntakeService`. This command gives operators and tests direct visibility into source-to-candidate normalization without invoking the Project Memory Curator.

## Source Artifacts

- `../spec.md`: User-Facing Behavior, Intake Boundary, Testing Strategy, Acceptance Criteria.
- `../agenda.md`: Question 4.
- `../pseudocode/ProjectMemoryCandidateIntakeService.ts`
- `../pseudocode/ProjectLearnCandidateIntakeFlow.md`
- `../plan.md`: command and documentation ownership.
- Code context: `src/commands/memory.ts`, `src/project/project-memory-candidate-intake-service.ts`, `docs/CLI.md`.
- Test context: `tests/commands/memory.test.ts`.

## Relationships

- **Depends on:** `ProjectMemoryCandidateIntakeService.intakeProjectInbox`.
- **Enables:** deterministic pre-curator candidate creation and later `project learn` composition.
- **Shared contracts:** `memory inbox intake <project-key> [--json]`, service summary result shape.
- **Integration points:** `src/commands/memory.ts`, `docs/CLI.md`, root SQLite `memory_candidates`.

## File Responsibility Map

**Create:**

- None.

**Modify:**

- `src/commands/memory.ts` - register and implement `memory inbox intake`.
- `docs/CLI.md` - document `memory inbox intake`.

**Test:**

- `tests/commands/memory.test.ts` - command invokes service and reports created/existing/degraded counts.

## Implementation Tasks

### Task 1: Add Failing Intake Command Tests

**Files:**

- Modify: `tests/commands/memory.test.ts`

- [ ] **Step 1: Add imports if missing**

```ts
import { getMemoryCandidate } from "../../src/memory/candidates.ts";
import { createRuntimeInboxItem } from "../../src/inbox/runtime-inbox-items.ts";
```

If either import already exists after previous chunks, reuse the existing import.

- [ ] **Step 2: Add command tests**

```ts
test("memory inbox intake converts runtime inbox items into candidates", async () => {
  const created = await createRuntimeInboxItem(root, {
    projectKey: "demo",
    targetLayer: "project",
    title: "Runtime inbox intake",
    body: "Runtime inbox intake creates candidates.",
    rationale: "Project learn should consume normalized candidates.",
    evidenceRefs: ["docs/design/spec.md"],
    targetHint: null,
    confidence: "high",
    risk: "medium",
    creator: "operator:test",
    now: new Date("2026-06-25T10:00:00.000Z"),
    id: "2026-06-25T10-00-00Z_a1b2c3",
  });
  if (created.status !== "created") throw new Error("failed to create inbox fixture");
  const cli = createCli("myelin");
  registerMemoryCommands(cli, {
    now: () => new Date("2026-06-25T11:00:00.000Z"),
  });

  const result = await cli.run(["memory", "inbox", "intake", "demo", "--json"]);
  const response = JSON.parse(result.message);

  expect(result.exitCode).toBe(0);
  expect(response.created_candidate_ids).toEqual(["project_inbox:demo:2026-06-25T10-00-00Z_a1b2c3"]);
  const db = openMemoryDb(root);
  try {
    expect(getMemoryCandidate(db, "project_inbox:demo:2026-06-25T10-00-00Z_a1b2c3")?.status).toBe("needs_review");
  } finally {
    db.close();
  }
});

test("memory inbox intake reports summary counts in default output", async () => {
  const created = await createRuntimeInboxItem(root, {
    projectKey: "demo",
    targetLayer: "project",
    title: "Runtime inbox intake",
    body: "Runtime inbox intake creates candidates.",
    rationale: "Project learn should consume normalized candidates.",
    evidenceRefs: [],
    targetHint: null,
    confidence: "medium",
    risk: "low",
    creator: "operator:test",
    now: new Date("2026-06-25T10:00:00.000Z"),
    id: "2026-06-25T10-00-00Z_a1b2c3",
  });
  if (created.status !== "created") throw new Error("failed to create inbox fixture");
  const cli = createCli("myelin");
  registerMemoryCommands(cli, {
    now: () => new Date("2026-06-25T11:00:00.000Z"),
  });

  const result = await cli.run(["memory", "inbox", "intake", "demo"]);

  expect(result.exitCode).toBe(0);
  expect(result.message).toContain("Runtime inbox intake for demo.");
  expect(result.message).toContain("created: 1");
  expect(result.message).toContain("existing: 0");
  expect(result.message).toContain("terminal duplicates: 0");
  expect(result.message).toContain("degraded: no");
});

test("memory inbox intake rejects unknown options, missing keys, and unknown projects", async () => {
  const cli = createCli("myelin");
  registerMemoryCommands(cli);

  const missing = await cli.run(["memory", "inbox", "intake"]);
  const unknown = await cli.run(["memory", "inbox", "intake", "demo", "--dry-run"]);
  const unknownProject = await cli.run(["memory", "inbox", "intake", "missing"]);

  expect(missing.exitCode).toBe(1);
  expect(missing.message).toContain("Usage: myelin memory inbox intake <project-key> [--json]");
  expect(unknown.exitCode).toBe(1);
  expect(unknown.message).toContain("Unknown memory inbox intake option: --dry-run");
  expect(unknownProject.exitCode).toBe(1);
  expect(unknownProject.message).toContain("Unknown project: missing");
});
```

- [ ] **Step 3: Run focused command tests**

Run: `bun test tests/commands/memory.test.ts`  
Expected: fails because `memory inbox intake` is unknown.

### Task 2: Implement The Intake Command

**Files:**

- Modify: `src/commands/memory.ts`

- [ ] **Step 1: Add import**

```ts
import { ProjectMemoryCandidateIntakeService } from "../project/project-memory-candidate-intake-service.ts";
```

- [ ] **Step 2: Register the command**

Inside `registerMemoryCommands`, add this before broader memory commands:

```ts
cli.command(["memory", "inbox", "intake"], (args) => memoryInboxIntake(args, deps));
```

- [ ] **Step 3: Add parser, handler, and formatter**

```ts
type ParsedMemoryInboxIntakeArgs = {
  projectKey: string;
  json: boolean;
  error?: string;
};

async function memoryInboxIntake(args: string[], deps: MemoryCommandDeps): Promise<CommandResult> {
  const parsed = parseMemoryInboxIntakeArgs(args);
  if (parsed.error) return fail(parsed.error);

  const result = await new ProjectMemoryCandidateIntakeService(repoRoot().root).intakeProjectInbox(
    parsed.projectKey,
    deps.now?.() ?? new Date(),
  );
  if (parsed.json) return result.blocking ? fail(stableJson(result)) : ok(stableJson(result));
  const message = formatMemoryInboxIntakeSummary(result);
  return result.blocking ? fail(message) : ok(message);
}

function parseMemoryInboxIntakeArgs(args: string[]): ParsedMemoryInboxIntakeArgs {
  let projectKey = "";
  let json = false;

  for (const arg of args) {
    if (arg === "--json") json = true;
    else if (arg.startsWith("-")) return { projectKey, json, error: `Unknown memory inbox intake option: ${arg}` };
    else if (!projectKey) projectKey = arg;
    else return { projectKey, json, error: `Unexpected memory inbox intake argument: ${arg}` };
  }

  if (!projectKey) return { projectKey, json, error: "Usage: myelin memory inbox intake <project-key> [--json]" };
  return { projectKey, json };
}

function formatMemoryInboxIntakeSummary(result: Awaited<ReturnType<ProjectMemoryCandidateIntakeService["intakeProjectInbox"]>>): string {
  return [
    `Runtime inbox intake for ${result.project_key}.`,
    `created: ${result.created_candidate_ids.length}`,
    `existing: ${result.existing_candidate_ids.length}`,
    `terminal duplicates: ${result.terminal_duplicate_candidate_ids.length}`,
    `skipped: ${result.skipped_source_refs.length}`,
    `unsupported: ${result.unsupported_source_refs.length}`,
    `invalid: ${result.invalid_source_refs.length}`,
    `degraded: ${result.degraded ? "yes" : "no"}`,
    result.degraded_reasons.length > 0 ? `degraded reasons: ${result.degraded_reasons.join("; ")}` : "",
  ].filter(Boolean).join("\n");
}
```

- [ ] **Step 4: Run focused tests**

Run: `bun test tests/commands/memory.test.ts`  
Expected: passes.

### Task 3: Document The Command

**Files:**

- Modify: `docs/CLI.md`

- [ ] **Step 1: Add a `memory inbox intake` subsection near `memory inbox create`**

```md
### `myelin memory inbox intake <project-key> [--json]`

Deterministically normalizes valid Project runtime inbox source records into Project Memory candidates without invoking a provider.

Arguments:

- `project-key`: project whose runtime inbox source records should be normalized.

Options:

- `--json`: emit the structured intake summary.

Output:

- Human-readable counts for created, existing, terminal duplicate, skipped, unsupported, and invalid source records by default.
- Structured intake summary with `--json`.

Side effects:

- Creates or reuses `memory_candidates` rows for valid `projects/<project-key>/sources/inbox/*.json` files.
- Creates only `scope="project"`, `candidate_type="project.inbox"`, `status="needs_review"` candidates in this slice.
- Does not invoke the Project Memory Curator.
- Does not rewrite runtime inbox source files.
```

## Verification

- Run: `bun test tests/project/project-memory-candidate-intake-service.test.ts`  
  Expected: pass, proving the service contract still works.
- Run: `bun test tests/commands/memory.test.ts`  
  Expected: pass, including the new intake command tests.
- Run: `bun run typecheck`  
  Expected: pass with no TypeScript errors.
- Run: `rtk git diff --check`  
  Expected: no whitespace errors.

## Acceptance Criteria Covered

- `memory inbox intake <project-key>` exposes the deterministic intake boundary.
- The command is provider-free and does not invoke `project learn`.
- Existing memory-candidate inspection commands can see candidates after intake.
- Intake output reports created/existing/terminal/skipped/unsupported/invalid states.
- Unknown projects fail instead of becoming no-op intake runs.

## Risks And Rollback

- Risk: command formatting becomes a second source of truth. Mitigation: command delegates all normalization to `ProjectMemoryCandidateIntakeService`.
- Risk: blocking intake failures could be hidden by successful exit codes. Mitigation: handler returns `fail` when `result.blocking` is true.
- Rollback: remove command registration/parser/tests/docs; the service remains available for Chunk 05.

## Non-Goals

- No source writer changes.
- No candidate normalization logic inside the command.
- No `project learn` integration.
- No provider invocation.
- No Practice/Personal consumers.
- No gap/stale producer routing.

## Type And Name Consistency

- Command path: `memory inbox intake`.
- Parser helper: `parseMemoryInboxIntakeArgs`.
- Handler: `memoryInboxIntake`.
- Formatter: `formatMemoryInboxIntakeSummary`.
- Service class: `ProjectMemoryCandidateIntakeService`.
- Service method: `intakeProjectInbox`.
