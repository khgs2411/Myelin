# Chunk 03: Ingest Job Runtime

**Plan Set:** `../plan.md`
**Spec:** `../spec.md`
**Status:** Ready For Implementation
**Depends on:** `01-storage-schema-contracts.md`
**Enables:** `05-ingest-agent-orchestration.md`, `06-operator-cli-surfaces.md`

## Goal

Implement Myelin-owned ingest job lifecycle and detached runtime primitives: create/update/read `ingest_jobs`, resolve the target repository for a project, enforce the v1 `master` branch preflight before any row claim, and start a detached background process that can run the ingest worker without tying up the operator terminal.

## Source Artifacts

- `../spec.md`: User-Facing Behavior, Agent Runtime Context, Data / State, Trigger Modes, Error Handling
- `../agenda.md`: Questions 7, 18, 19
- `../../../adr/0056-use-detached-target-repo-agents-for-experience-log-ingest.md`
- `src/runtime/projects.ts`
- `src/runtime/llm-client.ts`
- `src/inbox/auto-update.ts`
- `src/runtime/process.ts`
- `src/memory/db.ts`
- `src/memory/ingest-types.ts` from Chunk 01

## Relationships

- **Depends on:** `ingest_jobs` schema and `IngestJobStatus`.
- **Enables:** orchestration can attach provider session ids and status transitions to a durable job.
- **Shared contracts:** `createIngestJob`, `getIngestJob`, `updateIngestJobStatus`, `resolveIngestTargetRepo`, `assertMasterBranch`, `spawnDetachedIngestWorker`.
- **Integration points:** use `findProject` and `repo_paths`; use `Bun.spawn` pattern from `src/inbox/auto-update.ts`; branch checks use `git` through the process runner.

## File Responsibility Map

**Create:**
- `src/ingest/jobs.ts` - repository functions for `ingest_jobs`.
- `src/ingest/runtime.ts` - target repo resolution, branch preflight, detached worker spawn.
- `src/ingest/runtime.test.ts` - fake-runner tests for branch and detached runtime behavior.
- `src/ingest/jobs.test.ts` - job repository lifecycle tests.

**Modify:**
- No existing source files in this chunk unless tests require exporting an existing helper.

**Test:**
- `src/ingest/jobs.test.ts`
- `src/ingest/runtime.test.ts`

## Implementation Tasks

### Task 1: Implement Ingest Job Repository

**Files:**
- Create: `src/ingest/jobs.ts`
- Test: `src/ingest/jobs.test.ts`

- [ ] **Step 1: Add job repository functions**

```ts
import type { Database } from "bun:sqlite";
import type { IngestJobRow, IngestJobStatus } from "../memory/ingest-types.ts";

export type CreateIngestJobInput = {
  id: string;
  project_key: string;
  provider: string;
  requested_by?: string | null;
  input: Record<string, unknown>;
  now: string;
};

export function createIngestJob(db: Database, input: CreateIngestJobInput): IngestJobRow {
  db.query(
    `INSERT INTO ingest_jobs
      (id, project_key, status, provider, provider_session_id, requested_by, input_json,
       output_counts_json, terminal_summary, error_json, followup_state_json, started_at,
       finished_at, created_at, updated_at)
     VALUES (?, ?, 'starting', ?, NULL, ?, ?, ?, NULL, NULL, NULL, NULL, NULL, ?, ?)`,
  ).run(
    input.id,
    input.project_key,
    input.provider,
    input.requested_by ?? null,
    JSON.stringify(input.input),
    JSON.stringify({}),
    input.now,
    input.now,
  );
  return getIngestJob(db, input.id) as IngestJobRow;
}

export function getIngestJob(db: Database, id: string): IngestJobRow | null {
  return (db.query("SELECT * FROM ingest_jobs WHERE id = ?").get(id) as IngestJobRow | null) ?? null;
}

export function updateIngestJobStatus(
  db: Database,
  input: {
    id: string;
    status: IngestJobStatus;
    updated_at: string;
    provider_session_id?: string | null;
    started_at?: string | null;
    finished_at?: string | null;
    output_counts?: Record<string, unknown>;
    terminal_summary?: string | null;
    error?: Record<string, unknown> | null;
    followup_state?: Record<string, unknown> | null;
  },
): IngestJobRow {
  const existing = getIngestJob(db, input.id);
  if (!existing) throw new Error(`Unknown ingest job: ${input.id}`);
  db.query(
    `UPDATE ingest_jobs
     SET status = ?,
         provider_session_id = COALESCE(?, provider_session_id),
         started_at = COALESCE(?, started_at),
         finished_at = COALESCE(?, finished_at),
         output_counts_json = ?,
         terminal_summary = ?,
         error_json = ?,
         followup_state_json = ?,
         updated_at = ?
     WHERE id = ?`,
  ).run(
    input.status,
    input.provider_session_id ?? null,
    input.started_at ?? null,
    input.finished_at ?? null,
    JSON.stringify(input.output_counts ?? JSON.parse(existing.output_counts_json)),
    input.terminal_summary ?? existing.terminal_summary,
    input.error === undefined ? existing.error_json : JSON.stringify(input.error),
    input.followup_state === undefined ? existing.followup_state_json : JSON.stringify(input.followup_state),
    input.updated_at,
    input.id,
  );
  return getIngestJob(db, input.id) as IngestJobRow;
}
```

- [ ] **Step 2: Add repository lifecycle tests**

```ts
import { afterEach, beforeEach, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openMemoryDbAt, type MemoryDb } from "../memory/db.ts";
import { createIngestJob, getIngestJob, updateIngestJobStatus } from "./jobs.ts";

let dir: string;
let db: MemoryDb;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "myelin-ingest-jobs-"));
  db = openMemoryDbAt(join(dir, "memory.db"));
});

afterEach(async () => {
  db.close();
  await rm(dir, { recursive: true, force: true });
});

test("creates and updates an ingest job lifecycle row", () => {
  const job = createIngestJob(db, {
    id: "job_1",
    project_key: "class-kit",
    provider: "codex",
    input: { limit: 10 },
    now: "2026-06-13T10:00:00.000Z",
  });
  expect(job.status).toBe("starting");

  const running = updateIngestJobStatus(db, {
    id: "job_1",
    status: "running",
    provider_session_id: "sess_1",
    started_at: "2026-06-13T10:01:00.000Z",
    updated_at: "2026-06-13T10:01:00.000Z",
  });
  expect(running.provider_session_id).toBe("sess_1");
  expect(getIngestJob(db, "job_1")?.status).toBe("running");
});
```

### Task 2: Implement Target Repo And Branch Preflight

**Files:**
- Create: `src/ingest/runtime.ts`
- Test: `src/ingest/runtime.test.ts`

- [ ] **Step 1: Add target resolution and branch check**

```ts
import { join } from "node:path";
import { findProject } from "../runtime/projects.ts";
import { runProcess, type RunProcessResult } from "../runtime/process.ts";

export type RuntimeProcessRunner = (command: string[], options?: { cwd?: string }) => Promise<RunProcessResult>;

export async function resolveIngestTargetRepo(root: string, projectKey: string): Promise<string> {
  const project = await findProject(root, projectKey);
  const repoPath = project.config.repo_paths?.[0];
  if (!repoPath) throw new Error(`Project ${projectKey} has no repo_paths entry`);
  return repoPath;
}

export async function currentGitBranch(
  cwd: string,
  runner: RuntimeProcessRunner = (command, options) => runProcess(command, options),
): Promise<string> {
  const result = await runner(["git", "branch", "--show-current"], { cwd });
  if (result.exitCode !== 0) throw new Error(`Unable to read git branch in ${cwd}: ${result.stderr.trim()}`);
  return result.stdout.trim();
}

export async function assertMasterBranch(
  cwd: string,
  runner?: RuntimeProcessRunner,
): Promise<{ ok: true; branch: "master" } | { ok: false; branch: string }> {
  const branch = await currentGitBranch(cwd, runner);
  return branch === "master" ? { ok: true, branch: "master" } : { ok: false, branch };
}
```

- [ ] **Step 2: Add tests for branch behavior**

```ts
import { expect, test } from "bun:test";
import { assertMasterBranch } from "./runtime.ts";

test("branch preflight accepts master", async () => {
  const result = await assertMasterBranch("/repo", async () => ({ exitCode: 0, stdout: "master\n", stderr: "" }));
  expect(result).toEqual({ ok: true, branch: "master" });
});

test("branch preflight rejects non-master", async () => {
  const result = await assertMasterBranch("/repo", async () => ({ exitCode: 0, stdout: "feature/auth\n", stderr: "" }));
  expect(result).toEqual({ ok: false, branch: "feature/auth" });
});
```

### Task 3: Implement Detached Worker Spawn

**Files:**
- Create: `src/ingest/runtime.ts`
- Test: `src/ingest/runtime.test.ts`

- [ ] **Step 1: Add spawn helper**

```ts
export type DetachedIngestSpawnResult = {
  pid: number | null;
  logPath: string;
};

export async function spawnDetachedIngestWorker(input: {
  root: string;
  projectKey: string;
  jobId: string;
  targetRepo: string;
  logPath: string;
  env?: NodeJS.ProcessEnv;
  spawn?: typeof Bun.spawn;
}): Promise<DetachedIngestSpawnResult> {
  const spawn = input.spawn ?? Bun.spawn;
  const proc = spawn({
    cmd: ["bun", join(input.root, "src", "cli.ts"), "ingest", "worker", input.jobId],
    cwd: input.targetRepo,
    stdout: Bun.file(input.logPath),
    stderr: Bun.file(input.logPath),
    stdin: "ignore",
    env: {
      ...(input.env ?? process.env),
      MYELIN_ROOT: input.root,
      MYELIN_INGEST_JOB_ID: input.jobId,
      MYELIN_INGEST_PROJECT: input.projectKey,
    },
  });
  proc.unref();
  return { pid: proc.pid ?? null, logPath: input.logPath };
}
```

If Bun's `spawn` type cannot be injected cleanly in tests, wrap it in a local `DetachedSpawner` type with only the fields used by this helper.

## Verification

- Run: `bun test src/ingest/jobs.test.ts src/ingest/runtime.test.ts`
  - Expected: job repository and branch preflight tests pass.
- Run: `bun run typecheck`
  - Expected: passes with new `src/ingest/*` modules.
- Run: `git diff --check`
  - Expected: no whitespace errors.

## Acceptance Criteria Covered

- Ingest job lifecycle is durable in SQLite.
- Target repo is resolved from project metadata.
- Non-`master` repos fail before provider launch or row claim.
- Detached runtime primitive exists without implementing the agent loop.

## Risks And Rollback

- Risk: `Bun.spawn` injection shape differs from the simple test wrapper. Use a local adapter type and keep production call unchanged.
- Risk: branch preflight must not write tombstones. This chunk should only update the job row on failure; row claiming belongs to Chunk 02 and orchestration belongs to Chunk 05.
- Rollback: remove `src/ingest/jobs.ts`, `src/ingest/runtime.ts`, and their tests.

## Non-Goals

- No top-level CLI registration.
- No row claiming.
- No Session Memory, candidate, or handoff writes.
- No prompt/tool contract.
- No retry daemon, scheduler, cancellation manager, or worker pool.

## Type And Name Consistency

Verify job status strings match `src/memory/ingest-types.ts` and `../spec.md`, and worker command names match Chunk 06 before implementation is merged.
