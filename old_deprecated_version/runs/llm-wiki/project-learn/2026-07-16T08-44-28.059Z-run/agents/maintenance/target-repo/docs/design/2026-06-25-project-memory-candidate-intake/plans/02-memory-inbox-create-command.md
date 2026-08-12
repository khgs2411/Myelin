# Chunk 02: Memory Inbox Create Command

**Plan Set:** `../plan.md`  
**Spec:** `../spec.md`  
**Status:** Ready For Implementation  
**Depends on:** `01-runtime-inbox-contract-and-writer.md`  
**Enables:** explicit operator/tool proposal creation and source fixtures for intake

## Goal

Expose `myelin memory inbox create <project-key> --layer project --body ...` as the write-only runtime durable-memory proposal surface. The command writes source material through the writer from Chunk 01, returns confidence and risk by default, and never creates `memory_candidates` rows.

## Source Artifacts

- `../spec.md`: User-Facing Behavior, Creation Boundary, Data / State, Testing Strategy.
- `../agenda.md`: Questions 1, 3, 6, 7, and 8.
- `../pseudocode/MemoryInboxCreateCommandShape.md`
- `../pseudocode/RuntimeDurableMemoryInboxContract.md`
- `../pseudocode/RuntimeInboxItemJsonFormat.md`
- `../plan.md`: accepted CLI tests and documentation reconciliations.
- Code context: `src/commands/memory.ts`, `src/commands/registry.ts`, `src/cli.ts`, `docs/CLI.md`.
- Test context: `tests/commands/memory.test.ts`.

## Relationships

- **Depends on:** `createRuntimeInboxItem` and related types from `src/inbox/runtime-inbox-items.ts`.
- **Enables:** manual creation of preserved inbox source records for later intake.
- **Shared contracts:** command grammar, `--layer project`, required `--body`, `--title`, `--rationale`, `--confidence`, `--risk`, repeatable `--evidence-ref`, optional `--target-hint`, optional `--json`.
- **Integration points:** CLI command registry in `src/commands/memory.ts`, CLI reference in `docs/CLI.md`.

## File Responsibility Map

**Create:**

- None.

**Modify:**

- `src/commands/memory.ts` - register and implement `memory inbox create`.
- `docs/CLI.md` - document the new command, options, output, and side effects.

**Test:**

- `tests/commands/memory.test.ts` - command-level behavior and no-candidate side effect.

## Implementation Tasks

### Task 1: Add Failing Command Tests

**Files:**

- Modify: `tests/commands/memory.test.ts`

- [ ] **Step 1: Add imports if missing**

```ts
import { readFile } from "node:fs/promises";
import { listMemoryCandidates } from "../../src/memory/candidates.ts";
```

If `readFile` or `listMemoryCandidates` is already imported after previous edits, reuse the existing import instead of duplicating it.

- [ ] **Step 2: Add command tests near the existing memory command tests**

```ts
test("memory inbox create writes a runtime inbox source item and no candidate rows", async () => {
  const cli = createCli("myelin");
  registerMemoryCommands(cli, {
    now: () => new Date("2026-06-25T10:00:00.000Z"),
    creator: "operator:test",
  });

  const result = await cli.run([
    "memory",
    "inbox",
    "create",
    "demo",
    "--layer",
    "project",
    "--title",
    "Runtime inbox source material",
    "--body",
    "Runtime inbox files are explicit durable-memory proposals.",
    "--rationale",
    "Project Memory curator must verify proposals before durable writes.",
    "--evidence-ref",
    "docs/design/spec.md",
    "--confidence",
    "high",
    "--risk",
    "medium",
    "--target-hint",
    "wiki/architecture/index.md",
    "--json",
  ]);

  expect(result.exitCode).toBe(0);
  const response = JSON.parse(result.message);
  expect(response.status).toBe("created");
  expect(response.item).toMatchObject({
    project_key: "demo",
    target_layer: "project",
    confidence: "high",
    risk: "medium",
    creator: "operator:test",
  });
  expect(response.source_ref).toBe(`inbox:${response.item.id}`);

  const saved = JSON.parse(await readFile(response.path, "utf8"));
  expect(saved.body).toBe("Runtime inbox files are explicit durable-memory proposals.");
  expect(saved.evidence_refs).toEqual(["docs/design/spec.md"]);

  const db = openMemoryDb(root);
  try {
    expect(listMemoryCandidates(db, { project_key: "demo", scope: "project" })).toEqual([]);
  } finally {
    db.close();
  }
});

test("memory inbox create default output includes confidence and risk", async () => {
  const cli = createCli("myelin");
  registerMemoryCommands(cli, {
    now: () => new Date("2026-06-25T10:00:00.000Z"),
    creator: "operator:test",
  });

  const result = await cli.run([
    "memory",
    "inbox",
    "create",
    "demo",
    "--layer",
    "project",
    "--title",
    "Runtime inbox source material",
    "--body",
    "Proposal body.",
    "--rationale",
    "Proposal rationale.",
    "--confidence",
    "medium",
    "--risk",
    "low",
  ]);

  expect(result.exitCode).toBe(0);
  expect(result.message).toContain("Runtime inbox item created for demo.");
  expect(result.message).toContain("confidence: medium");
  expect(result.message).toContain("risk: low");
  expect(result.message).toContain("source ref: inbox:");
});

test("memory inbox create rejects unsupported layers, unknown projects, and invalid options before writing", async () => {
  const cli = createCli("myelin");
  registerMemoryCommands(cli, {
    now: () => new Date("2026-06-25T10:00:00.000Z"),
    creator: "operator:test",
  });

  const unsupported = await cli.run([
    "memory",
    "inbox",
    "create",
    "demo",
    "--layer",
    "personal",
    "--title",
    "Personal",
    "--body",
    "Body",
    "--rationale",
    "Rationale",
    "--confidence",
    "medium",
    "--risk",
    "low",
  ]);
  const unknownProject = await cli.run([
    "memory",
    "inbox",
    "create",
    "missing",
    "--layer",
    "project",
    "--title",
    "Unknown project",
    "--body",
    "Body",
    "--rationale",
    "Rationale",
    "--confidence",
    "medium",
    "--risk",
    "low",
  ]);
  const missingRisk = await cli.run([
    "memory",
    "inbox",
    "create",
    "demo",
    "--layer",
    "project",
    "--title",
    "Missing risk",
    "--body",
    "Body",
    "--rationale",
    "Rationale",
    "--confidence",
    "medium",
  ]);

  expect(unsupported.exitCode).toBe(1);
  expect(unsupported.message).toContain("Runtime inbox only supports project proposals in this slice");
  expect(unknownProject.exitCode).toBe(1);
  expect(unknownProject.message).toContain("Unknown project: missing");
  expect(missingRisk.exitCode).toBe(1);
  expect(missingRisk.message).toContain("--risk must be one of: low, medium, high");
  expect(await Bun.file(join(root, "projects", "demo", "sources", "inbox")).exists()).toBe(false);
  expect(await Bun.file(join(root, "projects", "missing")).exists()).toBe(false);
});
```

- [ ] **Step 3: Run the focused command test**

Run: `bun test tests/commands/memory.test.ts`  
Expected: fails because `registerMemoryCommands` does not yet accept dependency injection and `memory inbox create` is unknown.

### Task 2: Register And Implement `memory inbox create`

**Files:**

- Modify: `src/commands/memory.ts`

- [ ] **Step 1: Add imports**

```ts
import {
  createRuntimeInboxItem,
  runtimeInboxRatings,
  type RuntimeInboxRating,
} from "../inbox/runtime-inbox-items.ts";
import { stableJson } from "../runtime/json.ts";
```

- [ ] **Step 2: Add command dependencies and registration**

```ts
export type MemoryCommandDeps = {
  now?: () => Date;
  creator?: string;
};

export function registerMemoryCommands(cli: Cli, deps: MemoryCommandDeps = {}): void {
  cli.command(["memory", "inbox", "create"], (args) => memoryInboxCreate(args, deps));
  cli.command(["memory", "candidates"], (args) => candidates(args));
  cli.command(["memory", "candidate", "show"], (args) => candidateShow(args));
  cli.command(["memory", "session", "list"], (args) => sessionList(args));
  cli.command(["memory", "session", "show"], (args) => sessionShow(args));
  cli.command(["memory", "session", "links"], (args) => sessionLinks(args));
  cli.command(["memory", "index", "session"], (args) => indexSession(args));
  cli.command(["memory", "query"], async (args) => {
    // keep existing memory query body unchanged
  });
}
```

When applying this change, preserve the existing `memory query` handler body exactly; only add the new command and optional dependency parameter.

- [ ] **Step 3: Add parser and formatter helpers**

```ts
type ParsedMemoryInboxCreateArgs = {
  projectKey: string;
  layer: string;
  title: string;
  body: string;
  rationale: string;
  evidenceRefs: string[];
  targetHint: string | null;
  confidence: RuntimeInboxRating;
  risk: RuntimeInboxRating;
  json: boolean;
  error?: string;
};

async function memoryInboxCreate(args: string[], deps: MemoryCommandDeps): Promise<CommandResult> {
  const parsed = parseMemoryInboxCreateArgs(args);
  if (parsed.error) return fail(parsed.error);

  const result = await createRuntimeInboxItem(repoRoot().root, {
    projectKey: parsed.projectKey,
    targetLayer: parsed.layer,
    title: parsed.title,
    body: parsed.body,
    rationale: parsed.rationale,
    evidenceRefs: parsed.evidenceRefs,
    targetHint: parsed.targetHint,
    confidence: parsed.confidence,
    risk: parsed.risk,
    creator: deps.creator ?? "operator",
    now: deps.now?.(),
  });

  if (parsed.json) return result.status === "created" ? ok(stableJson(result)) : fail(stableJson(result));
  if (result.status !== "created") {
    return fail("reason" in result ? result.reason : `Runtime inbox create failed: ${result.status}`);
  }
  return ok(
    [
      `Runtime inbox item created for ${result.item.project_key}.`,
      `id: ${result.item.id}`,
      `source ref: ${result.source_ref}`,
      `path: ${result.path}`,
      `confidence: ${result.item.confidence}`,
      `risk: ${result.item.risk}`,
    ].join("\n"),
  );
}

function parseMemoryInboxCreateArgs(args: string[]): ParsedMemoryInboxCreateArgs {
  let projectKey = "";
  let layer = "";
  let title = "";
  let body = "";
  let rationale = "";
  const evidenceRefs: string[] = [];
  let targetHint: string | null = null;
  let confidence: RuntimeInboxRating | undefined;
  let risk: RuntimeInboxRating | undefined;
  let json = false;

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === "--json") json = true;
    else if (arg === "--layer") layer = args[++index] ?? "";
    else if (arg === "--title") title = args[++index] ?? "";
    else if (arg === "--body") body = args[++index] ?? "";
    else if (arg === "--rationale") rationale = args[++index] ?? "";
    else if (arg === "--evidence-ref") evidenceRefs.push(args[++index] ?? "");
    else if (arg === "--target-hint") targetHint = args[++index] ?? "";
    else if (arg === "--confidence") {
      const value = args[++index];
      if (!isRuntimeInboxRating(value)) return createArgsError(projectKey, layer, title, body, rationale, evidenceRefs, targetHint, confidence, risk, json, "--confidence must be one of: low, medium, high");
      confidence = value;
    } else if (arg === "--risk") {
      const value = args[++index];
      if (!isRuntimeInboxRating(value)) return createArgsError(projectKey, layer, title, body, rationale, evidenceRefs, targetHint, confidence, risk, json, "--risk must be one of: low, medium, high");
      risk = value;
    } else if (arg.startsWith("-")) {
      return createArgsError(projectKey, layer, title, body, rationale, evidenceRefs, targetHint, confidence, risk, json, `Unknown memory inbox create option: ${arg}`);
    } else if (!projectKey) {
      projectKey = arg;
    } else {
      return createArgsError(projectKey, layer, title, body, rationale, evidenceRefs, targetHint, confidence, risk, json, `Unexpected memory inbox create argument: ${arg}`);
    }
  }

  if (!projectKey || !layer || !title || !body || !rationale || !confidence || !risk) {
    return createArgsError(
      projectKey,
      layer,
      title,
      body,
      rationale,
      evidenceRefs,
      targetHint,
      confidence,
      risk,
      json,
      "Usage: myelin memory inbox create <project-key> --layer project --title <title> --body <text> --rationale <text> --confidence low|medium|high --risk low|medium|high [--evidence-ref <ref>] [--target-hint <hint>] [--json]",
    );
  }
  if (evidenceRefs.some((ref) => ref.trim().length === 0)) {
    return createArgsError(projectKey, layer, title, body, rationale, evidenceRefs, targetHint, confidence, risk, json, "--evidence-ref requires a non-empty value");
  }
  return { projectKey, layer, title, body, rationale, evidenceRefs, targetHint, confidence, risk, json };
}

function createArgsError(
  projectKey: string,
  layer: string,
  title: string,
  body: string,
  rationale: string,
  evidenceRefs: string[],
  targetHint: string | null,
  confidence: RuntimeInboxRating | undefined,
  risk: RuntimeInboxRating | undefined,
  json: boolean,
  error: string,
): ParsedMemoryInboxCreateArgs {
  return {
    projectKey,
    layer,
    title,
    body,
    rationale,
    evidenceRefs,
    targetHint,
    confidence: confidence ?? "low",
    risk: risk ?? "low",
    json,
    error,
  };
}

function isRuntimeInboxRating(value: string | undefined): value is RuntimeInboxRating {
  return (runtimeInboxRatings as readonly string[]).includes(value ?? "");
}
```

- [ ] **Step 4: Run the focused tests**

Run: `bun test tests/commands/memory.test.ts`  
Expected: passes.

### Task 3: Document The Command

**Files:**

- Modify: `docs/CLI.md`

- [ ] **Step 1: Add a `memory inbox create` subsection under the memory commands area**

```md
### `myelin memory inbox create <project-key> --layer project --body <text> --title <title> --rationale <text> --confidence low|medium|high --risk low|medium|high [--evidence-ref <ref>] [--target-hint <hint>] [--json]`

Creates an explicit runtime durable-memory inbox source proposal for Project Memory.

Arguments:

- `project-key`: project that owns the proposal.

Options:

- `--layer project`: required. Practice and Personal layers are not accepted until their consumers exist.
- `--body <text>`: required source/proposal text.
- `--title <title>`: required short summary.
- `--rationale <text>`: required explanation for why this should become durable memory.
- `--confidence low|medium|high`: required proposal confidence signal.
- `--risk low|medium|high`: required proposal risk signal.
- `--evidence-ref <ref>`: optional repeatable source reference.
- `--target-hint <hint>`: optional curator routing hint.
- `--json`: emit the structured creation result.

Output:

- Human-readable created item id, source ref, path, confidence, and risk by default.
- Structured creation result with `--json`.

Side effects:

- Writes immutable preserved source JSON under `projects/<project-key>/sources/inbox/<id>.json`.
- Creates `projects/<project-key>/sources/index.md` and `projects/<project-key>/sources/inbox/index.md` when needed.
- Does not create memory candidate rows. Use `myelin memory inbox intake <project-key>` or `myelin project learn <project-key>` after this command.
```

- [ ] **Step 2: Run documentation-neutral checks**

Run: `bun run typecheck`  
Expected: passes.

## Verification

- Run: `bun test tests/inbox/runtime-inbox-items.test.ts`  
  Expected: pass, proving the dependency contract still works.
- Run: `bun test tests/commands/memory.test.ts`  
  Expected: pass, including new `memory inbox create` tests.
- Run: `bun run typecheck`  
  Expected: pass with no TypeScript errors.
- Run: `rtk git diff --check`  
  Expected: no whitespace errors.

## Acceptance Criteria Covered

- A project-scoped runtime inbox proposal can be created explicitly.
- The command is exposed as `memory inbox create`, not direct candidate creation.
- Creation output includes confidence and risk by default.
- Invalid CLI input fails before writing source material.
- Unknown projects fail before writing source material.
- File-backed body input is not accepted in this slice.
- The command exposes no lifecycle status option.

## Risks And Rollback

- Risk: command parsing could drift from the writer validation. Mitigation: parse only CLI grammar here and delegate source validation to `createRuntimeInboxItem`.
- Risk: command accidentally creates candidates. Mitigation: tests assert `memory_candidates` remains empty.
- Rollback: remove the new command registration/parser/tests/docs; Chunk 01 remains a safe unused writer.

## Non-Goals

- No candidate intake.
- No `memory inbox intake` command.
- No `project learn` integration.
- No `--file` body input.
- No Practice/Personal accepted writes.
- No gap/stale producer routing.

## Type And Name Consistency

- Command path: `memory inbox create`.
- Parser helper: `parseMemoryInboxCreateArgs`.
- Command handler: `memoryInboxCreate`.
- Dependency type: `MemoryCommandDeps`.
- Writer import: `createRuntimeInboxItem`.
- Default creator: `operator` unless tests inject another value.
