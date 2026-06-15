# Chunk 04: Ingest Status Readback

**Plan Set:** `../plan.md`
**Spec:** `../spec.md`
**Status:** Ready For Implementation
**Depends on:** `01-tombstone-lease-storage-contracts.md`, `02-worker-commit-lifecycle.md`, `03-ingest-runtime-profile.md`
**Enables:** `05-docs-validation-and-retest.md`

## Goal

Expand ingest status/readback so operators can see layered completion, active unleased rows, tombstone-backed leases, running/failed jobs, terminal tombstones, output counts, and embedding backlog without manual SQLite inspection. Status must use numeric completion enum values in code and readable labels in CLI/JSON output.

## Source Artifacts

- `../spec.md`: User-Facing Behavior; Status Model; Acceptance Criteria.
- `../agenda.md`: Question 2.
- Chunk 01 count helpers.
- Chunk 03 config names.
- Code paths: `src/commands/ingest.ts`, `src/commands/ingest.test.ts`, `src/memory/experience.ts`, `src/memory/ingest-types.ts`, `src/memory/session-memory-embeddings.ts`.

## Relationships

- **Depends on:** lease-stub count helpers and final worker lifecycle behavior.
- **Enables:** docs/retest can record objective starting/terminal counts.
- **Shared contracts:** numeric completion enum; layered labels; JSON readback shape.
- **Integration points:** `myelin ingest status`, `ingest_jobs`, `experience_events`, `experience_event_tombstones`, output tables, embedding metadata.

## File Responsibility Map

**Create:**
- `src/ingest/status.ts` - status aggregation helpers and completion enum mapping.
- `src/ingest/status.test.ts` - aggregation and label tests.

**Modify:**
- `src/memory/ingest-types.ts` - export numeric completion enum constants/types.
- `src/commands/ingest.ts` - use project/job status aggregation in `ingest status`.
- `src/commands/ingest.test.ts` - update CLI/JSON status expectations.

## Implementation Tasks

### Task 1: Define numeric completion enum

**Files:**
- Modify: `src/memory/ingest-types.ts`
- Create: `src/ingest/status.test.ts`

- [ ] **Step 1: Add enum contract**

Use numeric values for code comparisons, but keep layer selection explicit. Every enum value must be reachable:

- `EXPERIENCE_LOG_DRAIN_PENDING`: unleased rows, leased rows, or running jobs still exist.
- `EXPERIENCE_LOG_DRAIN_COMPLETE`: no active drain work remains, but no Session Memory-family output exists yet.
- `SESSION_MEMORY_RETRIEVAL_PENDING`: Session Memory-family output exists and session-memory embeddings are pending or failed.
- `SESSION_MEMORY_WRITE_COMPLETE`: Session Memory-family output exists and no pending/failed session-memory embeddings remain.

Failed jobs are reported in `counts.failed_jobs`; they do not by themselves choose the completion layer. If failed jobs left raw rows present, the active row counts keep the layer at `EXPERIENCE_LOG_DRAIN_PENDING`.

```ts
export const INGEST_COMPLETION_LAYERS = {
  EXPERIENCE_LOG_DRAIN_PENDING: 10,
  EXPERIENCE_LOG_DRAIN_COMPLETE: 20,
  SESSION_MEMORY_WRITE_COMPLETE: 30,
  SESSION_MEMORY_RETRIEVAL_PENDING: 40,
} as const;

export type IngestCompletionLayer = (typeof INGEST_COMPLETION_LAYERS)[keyof typeof INGEST_COMPLETION_LAYERS];
```

- [ ] **Step 2: Add label mapping test**

```ts
import { expect, test } from "bun:test";
import { INGEST_COMPLETION_LAYERS } from "../memory/ingest-types.ts";
import { ingestCompletionLabel } from "./status.ts";

test("ingest completion labels are mapped from numeric enum values", () => {
  expect(ingestCompletionLabel(INGEST_COMPLETION_LAYERS.EXPERIENCE_LOG_DRAIN_COMPLETE)).toBe("Experience Log drain complete");
  expect(ingestCompletionLabel(INGEST_COMPLETION_LAYERS.SESSION_MEMORY_RETRIEVAL_PENDING)).toBe("Session Memory retrieval pending");
});
```

Run: `bun test src/ingest/status.test.ts`
Expected: fails until `src/ingest/status.ts` exists.

### Task 2: Add status aggregation helper

**Files:**
- Create: `src/ingest/status.ts`
- Test: `src/ingest/status.test.ts`

- [ ] **Step 1: Implement aggregation types and label mapping**

```ts
import type { Database } from "bun:sqlite";
import {
  INGEST_COMPLETION_LAYERS,
  type IngestCompletionLayer,
} from "../memory/ingest-types.ts";
import {
  countExperienceEvents,
  countLeasedExperienceEvents,
  countUnleasedExperienceEvents,
} from "../memory/experience.ts";

export type IngestProjectStatus = {
  project_key: string;
  completion_layer: IngestCompletionLayer;
  completion_label: string;
  counts: {
    active_events: number;
    unleased_events: number;
    leased_events: number;
    running_jobs: number;
    failed_jobs: number;
    terminal_tombstones: number;
    session_memories: number;
    memory_candidates: number;
    handoff_instructions: number;
    pending_session_memory_embeddings: number;
  };
};

export function ingestCompletionLabel(layer: IngestCompletionLayer): string {
  switch (layer) {
    case INGEST_COMPLETION_LAYERS.EXPERIENCE_LOG_DRAIN_PENDING:
      return "Experience Log drain pending";
    case INGEST_COMPLETION_LAYERS.EXPERIENCE_LOG_DRAIN_COMPLETE:
      return "Experience Log drain complete";
    case INGEST_COMPLETION_LAYERS.SESSION_MEMORY_WRITE_COMPLETE:
      return "Session Memory write complete";
    case INGEST_COMPLETION_LAYERS.SESSION_MEMORY_RETRIEVAL_PENDING:
      return "Session Memory retrieval pending";
  }
}
```

- [ ] **Step 2: Implement project status read**

```ts
export function readIngestProjectStatus(db: Database, projectKey: string): IngestProjectStatus {
  const activeEvents = countExperienceEvents(db, projectKey);
  const unleasedEvents = countUnleasedExperienceEvents(db, projectKey);
  const leasedEvents = countLeasedExperienceEvents(db, projectKey);
  const runningJobs = scalarCount(db, "SELECT count(*) AS count FROM ingest_jobs WHERE project_key = ? AND status = 'running'", projectKey);
  const failedJobs = scalarCount(db, "SELECT count(*) AS count FROM ingest_jobs WHERE project_key = ? AND status = 'failed'", projectKey);
  const terminalTombstones = scalarCount(
    db,
    "SELECT count(*) AS count FROM experience_event_tombstones WHERE project_key = ? AND state IN ('output', 'no_output', 'failed', 'unfinished')",
    projectKey,
  );
  const sessionMemories = scalarCount(db, "SELECT count(*) AS count FROM session_memories WHERE project_key = ?", projectKey);
  const memoryCandidates = scalarCount(db, "SELECT count(*) AS count FROM memory_candidates WHERE project_key = ?", projectKey);
  const projectHandoffs = scalarCount(db, "SELECT count(*) AS count FROM project_handoff_instructions WHERE project_key = ?", projectKey);
  const practiceHandoffs = scalarCount(db, "SELECT count(*) AS count FROM practice_handoff_instructions WHERE project_key = ?", projectKey);
  const personalHandoffs = scalarCount(db, "SELECT count(*) AS count FROM personal_handoff_instructions WHERE project_key = ?", projectKey);
  const pendingEmbeddings = scalarCount(
    db,
    "SELECT count(*) AS count FROM session_memory_embeddings WHERE project_key = ? AND status IN ('pending', 'failed')",
    projectKey,
  );

  const outputCount = sessionMemories + memoryCandidates + projectHandoffs + practiceHandoffs + personalHandoffs;
  const completionLayer =
    activeEvents > 0 || leasedEvents > 0 || runningJobs > 0
      ? INGEST_COMPLETION_LAYERS.EXPERIENCE_LOG_DRAIN_PENDING
      : outputCount === 0
        ? INGEST_COMPLETION_LAYERS.EXPERIENCE_LOG_DRAIN_COMPLETE
        : pendingEmbeddings > 0
          ? INGEST_COMPLETION_LAYERS.SESSION_MEMORY_RETRIEVAL_PENDING
          : INGEST_COMPLETION_LAYERS.SESSION_MEMORY_WRITE_COMPLETE;

  return {
    project_key: projectKey,
    completion_layer: completionLayer,
    completion_label: ingestCompletionLabel(completionLayer),
    counts: {
      active_events: activeEvents,
      unleased_events: unleasedEvents,
      leased_events: leasedEvents,
      running_jobs: runningJobs,
      failed_jobs: failedJobs,
      terminal_tombstones: terminalTombstones,
      session_memories: sessionMemories,
      memory_candidates: memoryCandidates,
      handoff_instructions: projectHandoffs + practiceHandoffs + personalHandoffs,
      pending_session_memory_embeddings: pendingEmbeddings,
    },
  };
}

function scalarCount(db: Database, sql: string, value: string): number {
  const row = db.query(sql).get(value) as { count: number };
  return row.count;
}
```

- [ ] **Step 3: Add aggregation tests**

Add separate tests for all reachable layers:

- seed one unleased event, one claimed stub, one running job, and one pending embedding; assert counts and `Experience Log drain pending`;
- remove active rows and outputs, with no pending embeddings; assert `Experience Log drain complete`;
- seed a Session Memory output plus one pending embedding; assert `Session Memory retrieval pending`;
- mark embeddings indexed or remove pending embedding rows while output remains; assert `Session Memory write complete`.

### Task 3: Wire CLI status output

**Files:**
- Modify: `src/commands/ingest.ts`
- Modify: `src/commands/ingest.test.ts`

- [ ] **Step 1: Extend parser to allow project status**

Preserve existing `myelin ingest status <job-id>`. Add `--project <key>`:

```ts
function parseStatusArgs(args: string[]): { jobId?: string; projectKey?: string; json: boolean; error?: string } {
  let jobId = "";
  let projectKey = "";
  let json = false;
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === "--json") json = true;
    else if (arg === "--project") projectKey = args[++index] ?? "";
    else if (arg.startsWith("-")) return { jobId, projectKey, json, error: `Unknown ingest status option: ${arg}` };
    else if (!jobId) jobId = arg;
    else return { jobId, projectKey, json, error: `Unexpected ingest status argument: ${arg}` };
  }
  if (!jobId && !projectKey) return { jobId, projectKey, json, error: "Usage: myelin ingest status <ingest-job-id> [--json] OR myelin ingest status --project <project-key> [--json]" };
  return { jobId: jobId || undefined, projectKey: projectKey || undefined, json };
}
```

- [ ] **Step 2: Read project status**

In `status`:

```ts
if (parsed.projectKey) {
  const projectStatus = readIngestProjectStatus(db, parsed.projectKey);
  return parsed.json
    ? ok(JSON.stringify({ status: projectStatus }, null, 2))
    : ok(`${projectStatus.project_key}: ${projectStatus.completion_label}`);
}
```

Keep existing job-id behavior.

- [ ] **Step 3: Add CLI test**

```ts
test("ingest status --project reports layered counts", async () => {
  await seedExperienceEvents(2);
  const cli = createCli("myelin");
  registerIngestCommands(cli, { now: () => new Date("2026-06-15T10:00:00.000Z") });

  const result = await cli.run(["ingest", "status", "--project", "demo", "--json"]);
  const response = JSON.parse(result.message);

  expect(result.exitCode).toBe(0);
  expect(response.status.project_key).toBe("demo");
  expect(response.status.counts.active_events).toBe(2);
  expect(response.status.completion_label).toBe("Experience Log drain pending");
});
```

### Verification

Run: `bun test src/ingest/status.test.ts src/commands/ingest.test.ts`
Expected: passes.

Run: `bun test src/memory/experience.test.ts src/ingest/worker.test.ts`
Expected: still passes after status aggregation uses lease helpers.

Run: `bun run typecheck`
Expected: exits 0.

Run: `git diff --check`
Expected: no output.

## Acceptance Criteria Covered

- Status distinguishes unleased active rows, in-progress lease stubs, running jobs, terminal tombstones, outputs, and embedding backlog.
- Status uses numeric completion enum values and layered human labels.
- Operators can inspect project-level ingest state without raw SQLite.

## Risks And Rollback

- Risk: querying embedding metadata before migration availability. The table exists in current migrations; if tests expose older DB compatibility issues, guard the query behind table existence in this chunk.
- Risk: project status and job status sharing one subcommand can confuse parsing. Preserve existing job-id behavior and add tests for both forms.
- Rollback: remove `--project` status branch and keep `src/ingest/status.ts` helpers for internal use until CLI shape is revisited.

## Non-Goals

- No worker lifecycle changes.
- No embedding index execution.
- No recovery command.

## Type And Name Consistency

Use `INGEST_COMPLETION_LAYERS`, `IngestCompletionLayer`, `ingestCompletionLabel`, and `readIngestProjectStatus` consistently.
