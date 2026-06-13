# Chunk 06: Operator CLI Surfaces

**Plan Set:** `../plan.md`
**Spec:** `../spec.md`
**Status:** Ready For Implementation
**Depends on:** `03-ingest-job-runtime.md`, `04-memory-output-repositories.md`, `05-ingest-agent-orchestration.md`
**Enables:** `07-docs-validation-and-source-set.md`

## Goal

Add operator-facing CLI commands for the approved public surface: top-level `myelin ingest <project-key>`, `myelin ingest status <ingest-job-id>`, `myelin memory candidates`, and `myelin memory candidate show`. This chunk must keep top-level `ingest` separate from existing `myelin project ingest <key>`.

## Source Artifacts

- `../spec.md`: User-Facing Behavior, Candidate Queue, Trigger Modes, Integrations
- `../agenda.md`: Questions 1, 7, 8, 18
- `src/cli.ts`
- `src/commands/registry.ts`
- `src/commands/project.ts`
- `src/commands/memory.ts`
- `src/ingest/jobs.ts`, `src/ingest/runtime.ts`, `src/ingest/worker.ts`
- `src/memory/candidates.ts`

## Relationships

- **Depends on:** job runtime, worker orchestration, candidate repository.
- **Enables:** operators can start detached ingest jobs and inspect candidate outputs.
- **Shared contracts:** command names and JSON output shapes.
- **Integration points:** command registry longest-prefix matching; `memory query` must keep working.

## File Responsibility Map

**Create:**
- `src/commands/ingest.ts` - top-level ingest commands and worker subcommand.
- `src/commands/ingest.test.ts` - CLI tests for start/status/worker branch failure.

**Modify:**
- `src/cli.ts` - register ingest commands.
- `src/commands/memory.ts` - add candidate list/show command handlers while preserving `memory query`.
- `src/commands/memory.test.ts` - candidate command tests.

**Test:**
- `src/commands/ingest.test.ts`
- `src/commands/memory.test.ts`
- `src/pipeline/runner.test.ts` - run existing pipeline tests to prove `project ingest` still routes to the queued-source pipeline.

## Implementation Tasks

### Task 1: Register Top-Level Ingest Commands

**Files:**
- Create: `src/commands/ingest.ts`
- Modify: `src/cli.ts`
- Test: `src/commands/ingest.test.ts`

- [ ] **Step 1: Add command registration**

```ts
import type { Cli } from "./registry.ts";
import { fail, ok } from "./registry.ts";
import { openMemoryDb } from "../memory/db.ts";
import { repoRoot } from "../runtime/fs.ts";
import { createIngestJob, getIngestJob, updateIngestJobStatus } from "../ingest/jobs.ts";
import { assertMasterBranch, resolveIngestTargetRepo, spawnDetachedIngestWorker } from "../ingest/runtime.ts";
import { runIngestWorker } from "../ingest/worker.ts";
import { createId } from "../runtime/ids.ts";

export function registerIngestCommands(cli: Cli): void {
  cli.command(["ingest", "status"], (args) => status(args));
  cli.command(["ingest", "worker"], (args) => worker(args));
  cli.command(["ingest"], (args) => start(args));
}
```

- [ ] **Step 2: Register commands in `src/cli.ts`**

```ts
import { registerIngestCommands } from "./commands/ingest.ts";
```

Add this before project/session/schema registration:

```ts
registerIngestCommands(cli);
```

### Task 2: Implement `myelin ingest <project-key>`

**Files:**
- Create: `src/commands/ingest.ts`
- Test: `src/commands/ingest.test.ts`

- [ ] **Step 1: Add start parser and handler**

```ts
async function start(args: string[]) {
  const parsed = parseStartArgs(args);
  if (parsed.error) return fail(parsed.error);
  const root = repoRoot().root;
  const db = openMemoryDb(root);
  const now = new Date().toISOString();
  try {
    const targetRepo = await resolveIngestTargetRepo(root, parsed.projectKey);
    const job = createIngestJob(db, {
      id: `ingest_${createId()}`,
      project_key: parsed.projectKey,
      provider: parsed.provider,
      input: { limit: parsed.limit, target_repo: targetRepo },
      now,
    });

    const branch = await assertMasterBranch(targetRepo);
    if (!branch.ok) {
      const failed = updateIngestJobStatus(db, {
        id: job.id,
        status: "failed",
        finished_at: now,
        updated_at: now,
        error: { code: "branch_mismatch", expected: "master", actual: branch.branch },
      });
      return parsed.json ? ok(JSON.stringify({ job: failed }, null, 2)) : fail(`Ingest job ${failed.id} failed: target repo is on ${branch.branch}, expected master.`);
    }

    const logPath = `${root}/projects/${parsed.projectKey}/logs/ingest-${job.id}.log`;
    const spawned = await spawnDetachedIngestWorker({
      root,
      projectKey: parsed.projectKey,
      jobId: job.id,
      targetRepo,
      logPath,
    });
    const running = updateIngestJobStatus(db, {
      id: job.id,
      status: "running",
      updated_at: now,
      started_at: now,
      followup_state: { log_path: spawned.logPath, pid: spawned.pid },
    });
    return parsed.json
      ? ok(JSON.stringify({ job: running, log_path: spawned.logPath }, null, 2))
      : ok(`Started ingest job ${running.id} for ${running.project_key}.\nlog: ${spawned.logPath}`);
  } catch (error) {
    return fail(error instanceof Error ? error.message : String(error));
  } finally {
    db.close();
  }
}
```

- [ ] **Step 2: Add parser**

```ts
function parseStartArgs(args: string[]): {
  projectKey: string;
  limit?: number;
  json: boolean;
  provider: "codex" | "claude";
  error?: string;
} {
  let projectKey = "";
  let limit: number | undefined;
  let json = false;
  let provider: "codex" | "claude" = "codex";
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === "--json") json = true;
    else if (arg === "--limit") {
      const value = Number(args[++index]);
      if (!Number.isInteger(value) || value <= 0) return { projectKey, json, provider, error: "--limit must be a positive integer" };
      limit = value;
    } else if (arg === "--provider") {
      const value = args[++index];
      if (value !== "codex" && value !== "claude") return { projectKey, json, provider, error: "--provider must be codex or claude" };
      provider = value;
    } else if (arg.startsWith("-")) return { projectKey, json, provider, error: `Unknown ingest option: ${arg}` };
    else if (!projectKey) projectKey = arg;
    else return { projectKey, json, provider, error: `Unexpected ingest argument: ${arg}` };
  }
  if (!projectKey) return { projectKey, json, provider, error: "Usage: myelin ingest <project-key> [--limit N] [--json]" };
  return { projectKey, limit, json, provider };
}
```

### Task 3: Implement Status And Worker Commands

**Files:**
- Create: `src/commands/ingest.ts`

- [ ] **Step 1: Add status handler**

```ts
function status(args: string[]) {
  const jobId = args.find((arg) => !arg.startsWith("-")) ?? "";
  const json = args.includes("--json");
  if (!jobId) return fail("Usage: myelin ingest status <ingest-job-id> [--json]");
  const db = openMemoryDb(repoRoot().root);
  try {
    const job = getIngestJob(db, jobId);
    if (!job) return fail(`Unknown ingest job: ${jobId}`);
    return json
      ? ok(JSON.stringify({ job }, null, 2))
      : ok(`Ingest job ${job.id} [${job.status}] project=${job.project_key} provider=${job.provider}`);
  } finally {
    db.close();
  }
}
```

- [ ] **Step 2: Add worker handler**

```ts
async function worker(args: string[]) {
  const jobId = args[0];
  if (!jobId || args.length > 1) return fail("Usage: myelin ingest worker <ingest-job-id>");
  const root = process.env.MYELIN_ROOT ?? repoRoot().root;
  const db = openMemoryDb(root);
  try {
    const job = getIngestJob(db, jobId);
    if (!job) return fail(`Unknown ingest job: ${jobId}`);
    const input = JSON.parse(job.input_json) as { target_repo?: string; limit?: number };
    if (!input.target_repo) return fail(`Ingest job ${jobId} missing target_repo`);
    await runIngestWorker({
      root,
      projectKey: job.project_key,
      jobId: job.id,
      targetRepo: input.target_repo,
      provider: job.provider === "claude" ? "claude" : "codex",
      providerSessionId: job.provider_session_id,
      limit: input.limit,
    });
    return ok(`Completed ingest worker ${jobId}.`);
  } catch (error) {
    return fail(error instanceof Error ? error.message : String(error));
  } finally {
    db.close();
  }
}
```

### Task 4: Add Candidate Commands

**Files:**
- Modify: `src/commands/memory.ts`
- Test: `src/commands/memory.test.ts`

- [ ] **Step 1: Register candidate commands before `memory query` or rely on longest-prefix matching**

```ts
import type { CommandResult } from "./registry.ts";
import { getMemoryCandidate, listMemoryCandidates, normalizeCandidateStatus } from "../memory/candidates.ts";
import { openMemoryDb, type MemoryDb } from "../memory/db.ts";
```

Add to `registerMemoryCommands`:

```ts
cli.command(["memory", "candidates"], (args) => withMemoryDb((db) => candidates(db, args)));
cli.command(["memory", "candidate", "show"], (args) => withMemoryDb((db) => candidateShow(db, args)));
```

Add helper:

```ts
function withMemoryDb(fn: (db: MemoryDb) => CommandResult): CommandResult {
  const db = openMemoryDb(repoRoot().root);
  try {
    return fn(db);
  } finally {
    db.close();
  }
}
```

- [ ] **Step 2: Add list/show handlers**

```ts
function candidates(db: MemoryDb, args: string[]): CommandResult {
  let projectKey = "";
  let status: string | undefined;
  let scope: "session" | "project" | "practice" | "personal" | undefined;
  let json = false;
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === "--json") json = true;
    else if (arg === "--status") status = normalizeCandidateStatus(args[++index] ?? "");
    else if (arg === "--scope") {
      const value = args[++index];
      if (value !== "session" && value !== "project" && value !== "practice" && value !== "personal") {
        return fail("--scope must be one of: session, project, practice, personal");
      }
      scope = value;
    }
    else if (arg.startsWith("-")) return fail(`Unknown memory candidates option: ${arg}`);
    else if (!projectKey) projectKey = arg;
    else return fail(`Unexpected memory candidates argument: ${arg}`);
  }
  if (!projectKey) return fail("Usage: myelin memory candidates <project-key> [--status pending|needs-review|processed|rejected] [--scope session|project|practice|personal] [--json]");
  const rows = listMemoryCandidates(db, { project_key: projectKey, status, scope });
  if (json) return ok(JSON.stringify({ project_key: projectKey, candidates: rows }, null, 2));
  if (rows.length === 0) return ok(`No memory candidates for ${projectKey}.`);
  return ok(rows.map((row) => `${row.id} [${row.status}] ${row.scope}: ${row.summary}`).join("\n"));
}

function candidateShow(db: MemoryDb, args: string[]): CommandResult {
  const id = args.find((arg) => !arg.startsWith("-")) ?? "";
  const json = args.includes("--json");
  if (!id) return fail("Usage: myelin memory candidate show <candidate-id> [--json]");
  const row = getMemoryCandidate(db, id);
  if (!row) return fail(`Unknown memory candidate: ${id}`);
  return json ? ok(JSON.stringify({ candidate: row }, null, 2)) : ok(`${row.id} [${row.status}] ${row.scope}\n${row.summary}`);
}
```

## Verification

- Run: `bun test src/commands/ingest.test.ts`
  - Expected: start/status/worker parser behavior passes with faked runtime dependencies.
- Run: `bun test src/commands/memory.test.ts`
  - Expected: existing query tests pass and new candidate list/show tests pass.
- Run: `bun test src/pipeline/runner.test.ts`
  - Expected: existing `project ingest` pipeline behavior still passes.
- Run: `bun run typecheck`
  - Expected: passes.
- Run: `git diff --check`
  - Expected: no whitespace errors.

## Acceptance Criteria Covered

- `myelin ingest <project-key>` starts a detached job and returns a handle.
- `myelin ingest status <ingest-job-id>` reads durable job state.
- `myelin project ingest <key>` remains the existing source/inbox pipeline.
- Candidate list/show commands exist.
- CLI accepts `needs-review` alias and returns stored `needs_review` in JSON.

## Risks And Rollback

- Risk: tests need dependency injection to avoid real detached spawn. Add an internal command factory if direct imports make faking hard.
- Risk: top-level `ingest worker` becomes visible in help. This is acceptable as an internal command if documented as worker-only; hide only if the registry gains hidden command support.
- Rollback: unregister `registerIngestCommands`, remove `src/commands/ingest.ts`, and revert memory candidate command additions.

## Non-Goals

- No implementation of Project/Practice/Personal layer agents.
- No candidate approval/reject mutation unless required by repository lifecycle tests.
- No status/current-briefing redesign.
- No scheduler, cancellation, or retry daemon.

## Type And Name Consistency

Verify usage strings, command paths, JSON keys, and helper imports match `../spec.md`, `src/cli.ts`, and prior chunks.
