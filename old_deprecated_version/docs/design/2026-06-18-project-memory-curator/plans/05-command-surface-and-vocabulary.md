# Chunk 05: Command Surface And Vocabulary

**Plan Set:** `../plan.md`
**Spec:** `../spec.md`
**Status:** Ready For Implementation
**Depends on:** `04-curator-service-prewrite-flow.md`
**Enables:** `06-phase-0-runner-retirement.md`

## Goal

Wire `myelin project learn <key>` through `ProjectMemoryCuratorService`, remove `myelin project ingest <key>` from the Project command surface, and clean operator-facing vocabulary while preserving top-level `myelin ingest <key>` for Session Memory / Experience Log processing.

## Source Artifacts

- `../spec.md`: User-Facing Behavior, Relationship To Existing Pipeline Stages.
- `../agenda.md`: Question 7 removes separate Project Memory `project ingest`.
- `src/commands/project.ts`: current project command registration and parsing.
- `src/project/project-service.ts`: facade method from Chunk 04.
- `src/schema/compiler.ts`: generated schema context command vocabulary currently lists `project ingest`.
- `Makefile`: currently maps `make ingest` to `myelin project ingest`.
- `tests/commands/project.test.ts`: project CLI coverage.
- `tests/commands/ingest.test.ts`: top-level ingest coverage.

## Relationships

- **Depends on:** `ProjectService.runProjectLearn` from Chunk 04.
- **Enables:** `runner.ts` has no supported command owner after this chunk.
- **Shared contracts:** `project learn` command output uses `ProjectMemoryCuratorRunResult`; `project ingest` is no longer registered.
- **Integration points:** CLI registry, Makefile aliases, schema context vocabulary, command tests.

## File Responsibility Map

**Create:**
- None.

**Modify:**
- `src/commands/project.ts` - route `project learn` to curator service and remove `project ingest` route.
- `src/project/project-service.ts` - remove `PipelineKind` from command-facing type surface if no longer needed by project commands.
- `src/schema/compiler.ts` - remove `project ingest` from generated schema context command vocabulary.
- `Makefile` - retarget or remove `make ingest` so it does not call `myelin project ingest`.
- `tests/commands/project.test.ts` - add project learn curator command tests and project ingest removal test.
- `tests/commands/ingest.test.ts` - keep top-level ingest tests passing.

**Test:**
- `tests/commands/project.test.ts` - command cutover.
- `tests/commands/ingest.test.ts` - top-level ingest remains intact.

## Implementation Tasks

### Task 1: Add Command Tests First

**Files:**
- Modify: `tests/commands/project.test.ts`

- [ ] **Step 1: Add test imports**

Add these imports if absent:

```ts
import { readFile } from "node:fs/promises";
```

- [ ] **Step 2: Add `project learn` curator routing test**

```ts
test("project learn routes through curator service and writes curator artifacts", async () => {
  await seedProject("active", "active");
  await writeJson(join(root, "projects", "active", "state", "bootstrap-state.json"), {
    status: "uncurated",
    missing: ["curated_project_memory"],
  });
  await mkdir(join(root, "projects", "active", "wiki"), { recursive: true });
  await writeFile(join(root, "projects", "active", "wiki", "index.md"), "# Active\n", "utf8");
  await seedSchema(root);
  const cli = createCli("myelin");
  registerProjectCommands(cli, {
    now: () => new Date("2026-06-23T10:00:00.000Z"),
    runner: async () => ({
      exitCode: 0,
      stdout: JSON.stringify({
        schema_version: 1,
        project_key: "active",
        mode: "create",
        packet_ref: { run_dir: "projects/active/runs/project-learn/2026-06-23T10-00-00.000Z-run", artifact: "input-packet.json", packet_schema_version: 1 },
        summary: "Initial brain",
        brain_intent: { name: "Active", first_brain_summary: "Create first brain", untrusted_existing_markdown_policy: "adopt" },
        pages: [{ id: "index", target: { path: "index.md", path_kind: "new_wiki_page" }, title: "Active", purpose: "Index", content_intent: "Create index", required_sections: ["Overview"], evidence_refs: [{ kind: "project_state", ref: "bootstrap_state" }], repo_citations: [], notes_for_apply: [] }],
        state_intent: { mark_project_memory_curated: true, freshness_intent: "initialize" },
        evidence_refs: [{ kind: "project_state", ref: "bootstrap_state" }],
        repo_citations: [],
        risk: { level: "low", reasons: [], requires_quarantine: false },
      }),
      stderr: "",
    }),
  });

  const result = await cli.run(["project", "learn", "active", "--json"]);
  const response = JSON.parse(result.message);

  expect(result.exitCode).toBe(0);
  expect(response.project_key).toBe("active");
  expect(response.artifacts.curator_output).toBe("curator-creation-draft.json");
  expect(response.stopped_before_writes).toBe(true);
  expect(await readFile(join(root, response.run_dir, "summary.md"), "utf8")).toContain("stopped_before_writes: true");
});
```

- [ ] **Step 3: Add `project ingest` removal test**

```ts
test("project ingest is not a Project Memory command", async () => {
  const cli = createCli("myelin");
  registerProjectCommands(cli);

  const result = await cli.run(["project", "ingest", "active"]);

  expect(result.exitCode).toBe(1);
  expect(result.message).toContain("Unknown command");
});
```

- [ ] **Step 4: Add human-readable validation failure output test**

```ts
test("project learn reports validation failures in human-readable output", async () => {
  await seedProject("active", "active");
  await writeJson(join(root, "projects", "active", "state", "bootstrap-state.json"), { status: "curated" });
  await writeJson(join(root, "projects", "active", "state", "project-memory.json"), { status: "curated" });
  await mkdir(join(root, "projects", "active", "wiki"), { recursive: true });
  await writeFile(join(root, "projects", "active", "wiki", "index.md"), "# Active\n", "utf8");
  await seedSchema(root);
  const cli = createCli("myelin");
  registerProjectCommands(cli, {
    now: () => new Date("2026-06-23T10:30:00.000Z"),
    runner: async () => ({
      exitCode: 0,
      stdout: JSON.stringify({
        schema_version: 1,
        project_key: "active",
        mode: "maintain",
        packet_ref: { run_dir: "projects/active/runs/project-learn/2026-06-23T10-30-00.000Z-run", artifact: "input-packet.json", packet_schema_version: 1 },
        summary: "bad",
        items: [],
        noop_inputs: [],
        risk: { level: "low", reasons: [], requires_quarantine: false },
      }),
      stderr: "",
    }),
  });

  const result = await cli.run(["project", "learn", "active"]);

  expect(result.exitCode).toBe(0);
  expect(result.message).toContain("Project learn needs_review for active.");
  expect(result.message).toContain("validation: failed");
  expect(result.message).toContain("stopped_before_writes: true");
  expect(result.message).toContain("stopped: curator validation did not produce eligible output");
});
```

- [ ] **Step 5: Add schema helper used by the new tests**

```ts
async function seedSchema(testRoot: string): Promise<void> {
  await mkdir(join(testRoot, "schema", "rules"), { recursive: true });
  await writeFile(join(testRoot, "schema", "global.md"), "Project schema\n", "utf8");
  await writeJson(join(testRoot, "schema", "rules", "source-classification.json"), {
    source_kind: ["handoff"],
    ownership: ["project"],
    action: ["update-existing-pages"],
    required_fields: ["source_kind"],
  });
  await writeJson(join(testRoot, "schema", "rules", "memory-scopes.json"), {
    phase_0_active: ["project"],
    phase_0_deferred: [],
    scopes: [{ key: "project", description: "Project" }],
  });
  await writeJson(join(testRoot, "schema", "rules", "page-taxonomy.json"), {
    categories: [{ key: "setup", description: "Setup" }],
  });
}
```

- [ ] **Step 6: Run focused command test**

Run: `bun test tests/commands/project.test.ts`
Expected: fails until `registerProjectCommands` accepts test dependencies and routes `project learn` to the curator service.

### Task 2: Route Project Learn To Curator Service

**Files:**
- Modify: `src/commands/project.ts`

- [ ] **Step 1: Change registration signature**

```ts
import type { ProcessRunner } from "../runtime/llm-client.ts";

export type ProjectCommandDeps = {
  now?: () => Date;
  runner?: ProcessRunner;
  env?: NodeJS.ProcessEnv;
};

export function registerProjectCommands(cli: Cli, deps: ProjectCommandDeps = {}): void {
  cli.command(["project", "list"], async (args) => listProjectsCommand(args));
  cli.command(["project", "packet"], async (args) => projectPacketCommand(args));
  cli.command(["project", "learn"], async (args) => projectLearnCommand(args, deps));
  cli.command(["project", "migrate-layout"], async (args) => {
    // keep existing migrate-layout body unchanged
  });
}
```

- [ ] **Step 2: Replace `runPipelineCommand` with `projectLearnCommand`**

```ts
async function projectLearnCommand(args: string[], deps: ProjectCommandDeps) {
  const parsed = parseProjectLearnArgs(args);
  if (parsed.error) return fail(parsed.error);

  try {
    const result = await new ProjectService(repoRoot().root).runProjectLearn({
      projectKey: parsed.projectKey,
      dryRun: parsed.dryRun,
      review: parsed.review,
      provider: parsed.provider,
      modelOverride: parsed.modelOverride,
      env: deps.env,
      runner: deps.runner,
      now: deps.now?.(),
    });
    if (parsed.json) return ok(stableJson(result));

    const lines = [
      `Project learn ${result.status} for ${result.project_key}.`,
      `mode: ${result.mode}`,
      `run: ${result.run_dir}`,
      `validation: ${result.validation_ok ? "passed" : "failed"}`,
      `stopped_before_writes: ${result.stopped_before_writes}`,
    ];
    if (result.stopped_reason) lines.push(`stopped: ${result.stopped_reason}`);
    return result.status === "failed" ? fail(lines.join("\n")) : ok(lines.join("\n"));
  } catch (error) {
    return fail(error instanceof Error ? error.message : String(error));
  }
}
```

- [ ] **Step 3: Replace parser type and usage**

```ts
function parseProjectLearnArgs(args: string[]): {
  projectKey: string;
  dryRun: boolean;
  review: boolean;
  json: boolean;
  provider?: "codex" | "claude";
  modelOverride?: string;
  error?: string;
} {
  let projectKey = "";
  let dryRun = false;
  let review = false;
  let json = false;
  let provider: "codex" | "claude" | undefined;
  let modelOverride: string | undefined;

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === "--dry-run") dryRun = true;
    else if (arg === "--review") review = true;
    else if (arg === "--json") json = true;
    else if (arg === "--provider") {
      const value = args[++index];
      if (value !== "codex" && value !== "claude") return { projectKey, dryRun, review, json, error: "--provider must be codex or claude" };
      provider = value;
    } else if (arg === "--model") {
      modelOverride = args[++index];
      if (!modelOverride) return { projectKey, dryRun, review, json, error: "--model requires a value" };
    } else if (arg.startsWith("-")) {
      return { projectKey, dryRun, review, json, error: `Unknown project learn option: ${arg}` };
    } else if (!projectKey) {
      projectKey = arg;
    } else {
      return { projectKey, dryRun, review, json, error: `Unexpected project learn argument: ${arg}` };
    }
  }

  if (!projectKey) return { projectKey, dryRun, review, json, error: "Usage: myelin project learn <project-key> [--dry-run] [--review] [--json]" };
  return { projectKey, dryRun, review, json, provider, modelOverride };
}
```

Remove the `project ingest` command registration and remove `PipelineKind` imports from this file.

### Task 3: Clean Schema And Makefile Vocabulary

**Files:**
- Modify: `src/schema/compiler.ts`
- Modify: `Makefile`

- [ ] **Step 1: Remove `project ingest` from schema context commands**

Change `REQUIRED_CONTEXT_COMMANDS` to omit `"project ingest"`:

```ts
const REQUIRED_CONTEXT_COMMANDS = [
  "bootstrap",
  "project learn",
  "ingest",
  "ingest status",
  "memory query",
  "status",
  "schema check",
  "schema build",
  "session close",
];
```

- [ ] **Step 2: Retarget Makefile ingest alias to top-level ingest**

Change:

```make
ingest:
	$(MYELIN) ingest $(PROJECT)
```

Keep `learn` mapped to `$(MYELIN) project learn $(PROJECT)`.

### Task 4: Verify Top-Level Ingest Remains Intact

**Files:**
- Test: `tests/commands/ingest.test.ts`

- [ ] **Step 1: Run ingest command tests**

Run: `bun test tests/commands/ingest.test.ts`
Expected: passes, proving top-level `ingest <key>` is still registered and unchanged.

## Verification

- `bun test tests/commands/project.test.ts`
  - Expected: project learn routes through curator service; project ingest returns unknown command.
- `bun test tests/commands/ingest.test.ts`
  - Expected: top-level ingest behavior still passes.
- `bun run typecheck`
  - Expected: no project command imports from `../pipeline/runner.ts`.
- `rg -n "project ingest" src Makefile tests/commands`
  - Expected: no active command vocabulary references except intentional assertions that it is absent.

## Acceptance Criteria Covered

- `project learn` routes through the Project Memory Curator service.
- `project ingest` is removed from the Project Memory command surface.
- Top-level `ingest <key>` remains Session Memory / Experience Log ingest.
- Schema and Makefile vocabulary stop advertising obsolete Project Memory ingest.

## Risks And Rollback

- Risk: CLI tests need injected runner dependencies to avoid launching a real provider. Keep dependency injection only in command registration options.
- Risk: removing `project ingest` can expose stale docs. This chunk owns `src`, Makefile, and command tests only; broader docs cleanup belongs to separate documentation work.
- Rollback: restore `project ingest` registration and Makefile mapping, then revert schema command vocabulary. Do not roll back top-level ingest.

## Non-Goals

- No `runner.ts` deletion.
- No markdown apply.
- No derived vector indexing.
- No changes to top-level `src/commands/ingest.ts`.

## Type And Name Consistency

Before marking this chunk done, verify `src/commands/project.ts` has no `PipelineKind`, `runPipelineCommand`, or `project ingest` registration.
