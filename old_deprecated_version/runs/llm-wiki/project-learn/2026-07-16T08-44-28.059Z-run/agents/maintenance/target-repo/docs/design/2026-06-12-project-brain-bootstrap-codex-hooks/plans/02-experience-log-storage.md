# Chunk 02: Experience Log Storage

**Plan Set:** `../plan.md`
**Spec:** `../spec.md`
**Status:** Ready For Implementation
**Depends on:** None
**Enables:** `04-capture-routing-and-errors.md`, `05-codex-capture-adapter.md`

## Goal

Add the root SQLite storage contract for raw provider-neutral Experience Log capture: event rows, hook errors, tombstones, dedupe identity, invalid-row support, and a gitignored JSONL fallback for hook errors when SQLite is unavailable.

## Source Artifacts

- `../spec.md`: Data / State, Error Handling, Permissions / Security.
- `../agenda.md`: Questions 4, 8, 9, 15, 16, 22, 23, 25, 26, 27, 29, 30, 31, 32.
- `../../../CONTEXT.md`: Experience Log, Experience Log Tombstone.
- Existing code: `src/memory/db.ts`, `src/memory/migrations.ts`, `src/memory/db.test.ts`, `src/memory/sessions.test.ts`, `.gitignore`.

## Relationships

- **Depends on:** no prior chunks.
- **Enables:** capture facade can persist raw events and hook errors; Codex adapter can write mapped events.
- **Shared contracts:** `experience_events`, `hook_errors`, `experience_event_tombstones`; `ExperienceEventInput`; `ExperienceEventRow`; `HookErrorInput`; `tombstoneExperienceEvent`.
- **Integration points:** Bun SQLite migration system, root `state/memory.db`, `.gitignore`.

## File Responsibility Map

**Create:**
- `src/memory/experience.ts` - typed insert/query helpers for Experience Log rows, hook errors, and tombstones.
- `src/memory/experience.test.ts` - storage behavior, invalid rows, dedupe, tombstones, hook error fallback.

**Modify:**
- `src/memory/migrations.ts` - add migration version 2 for raw capture tables and indexes.
- `src/memory/db.test.ts` - assert new tables and migration version.
- `.gitignore` - ignore `state/hook-errors.jsonl`.

**Test:**
- `src/memory/experience.test.ts`
- `src/memory/db.test.ts`

## Implementation Tasks

### Task 1: Add Migration Version 2

**Files:**
- Modify: `src/memory/migrations.ts`
- Modify: `src/memory/db.test.ts`

- [ ] **Step 1: Extend DB migration test**

In `src/memory/db.test.ts`, update the first test to include:

```ts
expect(names).toContain("experience_events");
expect(names).toContain("hook_errors");
expect(names).toContain("experience_event_tombstones");
```

Update expected migration versions:

```ts
expect(applied.map((r) => r.version)).toEqual([1, 2]);
```

Update the idempotency test count:

```ts
expect(count.n).toBe(2);
```

- [ ] **Step 2: Run DB tests**

Run: `bun test src/memory/db.test.ts`  
Expected: fails because migration version 2 does not exist.

- [ ] **Step 3: Add migration 2**

Append this migration after version 1 in `src/memory/migrations.ts`:

```ts
{
  version: 2,
  sql: `
    CREATE TABLE experience_events (
      id                  TEXT PRIMARY KEY,
      project_key         TEXT NOT NULL,
      occurred_at         TEXT NOT NULL,
      hook_event_name     TEXT,
      event_kind          TEXT,
      cwd                 TEXT,
      provider            TEXT NOT NULL,
      provider_session_id TEXT,
      turn_id             TEXT,
      raw_text            TEXT,
      raw_payload_json    TEXT NOT NULL,
      source              TEXT NOT NULL,
      status              TEXT NOT NULL CHECK (status IN ('valid', 'invalid')),
      dedupe_key          TEXT,
      inserted_at         TEXT NOT NULL
    );
    CREATE INDEX experience_events_project_time ON experience_events(project_key, occurred_at);
    CREATE INDEX experience_events_project_kind_time ON experience_events(project_key, event_kind, occurred_at);
    CREATE INDEX experience_events_provider_turn ON experience_events(provider, provider_session_id, turn_id);
    CREATE UNIQUE INDEX experience_events_dedupe_key ON experience_events(dedupe_key) WHERE dedupe_key IS NOT NULL;

    CREATE TABLE hook_errors (
      id               INTEGER PRIMARY KEY AUTOINCREMENT,
      occurred_at      TEXT NOT NULL,
      provider         TEXT,
      source           TEXT NOT NULL,
      project_key      TEXT,
      cwd              TEXT,
      hook_event_name  TEXT,
      error_message    TEXT NOT NULL,
      raw_payload_json TEXT
    );
    CREATE INDEX hook_errors_time ON hook_errors(occurred_at);
    CREATE INDEX hook_errors_project_time ON hook_errors(project_key, occurred_at);

    CREATE TABLE experience_event_tombstones (
      id                    TEXT PRIMARY KEY,
      original_event_id      TEXT NOT NULL,
      dedupe_key             TEXT,
      project_key            TEXT NOT NULL,
      processed_at           TEXT NOT NULL,
      terminal_decision      TEXT NOT NULL,
      output_references_json TEXT NOT NULL
    );
    CREATE INDEX experience_event_tombstones_project_time ON experience_event_tombstones(project_key, processed_at);
    CREATE UNIQUE INDEX experience_event_tombstones_original_event ON experience_event_tombstones(original_event_id);
  `,
}
```

- [ ] **Step 4: Run DB tests**

Run: `bun test src/memory/db.test.ts`  
Expected: passes.

### Task 2: Add Experience Storage Helpers

**Files:**
- Create: `src/memory/experience.ts`
- Create: `src/memory/experience.test.ts`

- [ ] **Step 1: Add storage tests**

```ts
import { afterEach, beforeEach, expect, test } from "bun:test";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { openMemoryDbAt, type MemoryDb } from "./db.ts";
import {
  listExperienceEvents,
  recordExperienceEvent,
  recordHookError,
  tombstoneExperienceEvent,
} from "./experience.ts";

let dir: string;
let db: MemoryDb;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "myelin-experience-"));
  db = openMemoryDbAt(join(dir, "memory.db"));
});

afterEach(async () => {
  db.close();
  await rm(dir, { recursive: true, force: true });
});

test("records valid provider-neutral experience events", () => {
  const row = recordExperienceEvent(db, {
    id: "evt_1",
    project_key: "class-kit",
    occurred_at: "2026-06-12T10:00:00.000Z",
    hook_event_name: "UserPromptSubmit",
    event_kind: "user.prompt",
    cwd: "/repo",
    provider: "codex",
    provider_session_id: "sess_1",
    turn_id: "turn_1",
    raw_text: "How do we auth with Supabase?",
    raw_payload_json: JSON.stringify({ hook_event_name: "UserPromptSubmit" }),
    source: "codex-hook",
    status: "valid",
  });

  expect(row.id).toBe("evt_1");
  expect(listExperienceEvents(db, "class-kit").map((event) => event.event_kind)).toEqual(["user.prompt"]);
});

test("records invalid rows with minimum required fields", () => {
  const row = recordExperienceEvent(db, {
    id: "evt_invalid",
    project_key: "class-kit",
    occurred_at: "2026-06-12T10:00:00.000Z",
    provider: "codex",
    raw_payload_json: JSON.stringify({ malformed: true }),
    source: "codex-hook",
    status: "invalid",
  });

  expect(row.status).toBe("invalid");
  expect(row.hook_event_name).toBeNull();
  expect(row.cwd).toBeNull();
});

test("deduplicates provider identity when available and keeps uncertain duplicates", () => {
  const input = {
    project_key: "class-kit",
    occurred_at: "2026-06-12T10:00:00.000Z",
    hook_event_name: "UserPromptSubmit",
    event_kind: "user.prompt",
    cwd: "/repo",
    provider: "codex",
    provider_session_id: "sess_1",
    turn_id: "turn_1",
    raw_text: "same",
    raw_payload_json: "{}",
    source: "codex-hook",
    status: "valid" as const,
  };

  recordExperienceEvent(db, { ...input, id: "evt_1" });
  recordExperienceEvent(db, { ...input, id: "evt_2" });
  recordExperienceEvent(db, { ...input, id: "evt_3", provider_session_id: undefined, turn_id: undefined });

  expect(listExperienceEvents(db, "class-kit").map((event) => event.id)).toEqual(["evt_1", "evt_3"]);
});

test("tombstones delete raw rows only with terminal output references", () => {
  recordExperienceEvent(db, {
    id: "evt_1",
    project_key: "class-kit",
    occurred_at: "2026-06-12T10:00:00.000Z",
    provider: "codex",
    raw_payload_json: "{}",
    source: "codex-hook",
    status: "invalid",
  });

  tombstoneExperienceEvent(db, {
    id: "tomb_1",
    original_event_id: "evt_1",
    project_key: "class-kit",
    processed_at: "2026-06-12T10:05:00.000Z",
    terminal_decision: "rejected.no-action",
    output_references: ["projects/class-kit/state/rejections.json"],
  });

  expect(listExperienceEvents(db, "class-kit")).toEqual([]);
});

test("hook errors fall back to jsonl when sqlite is unavailable", async () => {
  db.close();
  recordHookError(null, join(dir, "state", "hook-errors.jsonl"), {
    occurred_at: "2026-06-12T10:00:00.000Z",
    provider: "codex",
    source: "codex-hook",
    error_message: "db unavailable",
  });

  const lines = (await readFile(join(dir, "state", "hook-errors.jsonl"), "utf8")).trim().split("\n");
  expect(JSON.parse(lines[0]).error_message).toBe("db unavailable");
});
```

- [ ] **Step 2: Run storage tests**

Run: `bun test src/memory/experience.test.ts`  
Expected: fails because `src/memory/experience.ts` does not exist.

- [ ] **Step 3: Implement helper module**

```ts
import type { Database } from "bun:sqlite";
import { mkdirSync, appendFileSync } from "node:fs";
import { dirname } from "node:path";

export type ExperienceStatus = "valid" | "invalid";

export type ExperienceEventInput = {
  id: string;
  project_key: string;
  occurred_at: string;
  hook_event_name?: string | null;
  event_kind?: string | null;
  cwd?: string | null;
  provider: string;
  provider_session_id?: string | null;
  turn_id?: string | null;
  raw_text?: string | null;
  raw_payload_json: string;
  source: string;
  status: ExperienceStatus;
};

export type ExperienceEventRow = Required<Omit<ExperienceEventInput, "hook_event_name" | "event_kind" | "cwd" | "provider_session_id" | "turn_id" | "raw_text">> & {
  hook_event_name: string | null;
  event_kind: string | null;
  cwd: string | null;
  provider_session_id: string | null;
  turn_id: string | null;
  raw_text: string | null;
  dedupe_key: string | null;
  inserted_at: string;
};

export type HookErrorInput = {
  occurred_at: string;
  provider?: string | null;
  source: string;
  project_key?: string | null;
  cwd?: string | null;
  hook_event_name?: string | null;
  error_message: string;
  raw_payload_json?: string | null;
};

export function recordExperienceEvent(db: Database, input: ExperienceEventInput, insertedAt = new Date()): ExperienceEventRow {
  const dedupeKey = providerDedupeKey(input);
  const row = {
    ...input,
    hook_event_name: input.hook_event_name ?? null,
    event_kind: input.event_kind ?? null,
    cwd: input.cwd ?? null,
    provider_session_id: input.provider_session_id ?? null,
    turn_id: input.turn_id ?? null,
    raw_text: input.raw_text ?? null,
    dedupe_key: dedupeKey,
    inserted_at: insertedAt.toISOString(),
  };

  db.query(
    `INSERT OR IGNORE INTO experience_events
      (id, project_key, occurred_at, hook_event_name, event_kind, cwd, provider, provider_session_id, turn_id,
       raw_text, raw_payload_json, source, status, dedupe_key, inserted_at)
     VALUES
      ($id, $project_key, $occurred_at, $hook_event_name, $event_kind, $cwd, $provider, $provider_session_id, $turn_id,
       $raw_text, $raw_payload_json, $source, $status, $dedupe_key, $inserted_at)`,
  ).run(row);

  return (db.query("SELECT * FROM experience_events WHERE id = ? OR dedupe_key = ? ORDER BY inserted_at LIMIT 1").get(
    input.id,
    dedupeKey,
  ) ?? row) as ExperienceEventRow;
}

export function listExperienceEvents(db: Database, projectKey: string): ExperienceEventRow[] {
  return db.query("SELECT * FROM experience_events WHERE project_key = ? ORDER BY occurred_at, id").all(projectKey) as ExperienceEventRow[];
}

export function recordHookError(db: Database | null, fallbackPath: string, input: HookErrorInput): void {
  if (db) {
    db.query(
      `INSERT INTO hook_errors
        (occurred_at, provider, source, project_key, cwd, hook_event_name, error_message, raw_payload_json)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      input.occurred_at,
      input.provider ?? null,
      input.source,
      input.project_key ?? null,
      input.cwd ?? null,
      input.hook_event_name ?? null,
      input.error_message,
      input.raw_payload_json ?? null,
    );
    return;
  }

  mkdirSync(dirname(fallbackPath), { recursive: true });
  appendFileSync(fallbackPath, `${JSON.stringify(input)}\n`, "utf8");
}

export function tombstoneExperienceEvent(
  db: Database,
  input: {
    id: string;
    original_event_id: string;
    project_key: string;
    processed_at: string;
    terminal_decision: string;
    output_references: string[];
  },
): void {
  const existing = db.query("SELECT dedupe_key FROM experience_events WHERE id = ?").get(input.original_event_id) as
    | { dedupe_key: string | null }
    | null;
  if (!existing) throw new Error(`Unknown experience event: ${input.original_event_id}`);
  if (input.output_references.length === 0) throw new Error("Tombstone requires at least one output reference");

  const apply = db.transaction(() => {
    db.query(
      `INSERT INTO experience_event_tombstones
        (id, original_event_id, dedupe_key, project_key, processed_at, terminal_decision, output_references_json)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      input.id,
      input.original_event_id,
      existing.dedupe_key,
      input.project_key,
      input.processed_at,
      input.terminal_decision,
      JSON.stringify(input.output_references),
    );
    db.query("DELETE FROM experience_events WHERE id = ?").run(input.original_event_id);
  });
  apply();
}

function providerDedupeKey(input: ExperienceEventInput): string | null {
  if (input.provider_session_id && input.turn_id && input.hook_event_name) {
    return [input.provider, input.provider_session_id, input.turn_id, input.hook_event_name].join(":");
  }
  return null;
}
```

- [ ] **Step 4: Run storage tests**

Run: `bun test src/memory/experience.test.ts src/memory/db.test.ts`  
Expected: passes.

### Task 3: Add JSONL Fallback Ignore Coverage

**Files:**
- Modify: `.gitignore`

- [ ] **Step 1: Add ignore line**

Add under existing SQLite ignores:

```gitignore
state/hook-errors.jsonl
```

- [ ] **Step 2: Verify ignore behavior**

Run: `git check-ignore state/hook-errors.jsonl`  
Expected output: `state/hook-errors.jsonl`

## Verification

Run: `bun test src/memory/db.test.ts src/memory/experience.test.ts src/memory/sessions.test.ts`  
Expected: all tests pass; existing session migration behavior remains intact.

Run: `bun run typecheck`  
Expected: TypeScript completes without errors.

Run: `git check-ignore state/memory.db state/memory.db-wal state/memory.db-shm state/hook-errors.jsonl`  
Expected: all four paths are printed.

## Acceptance Criteria Covered

- Raw capture uses root `state/memory.db`.
- Experience events are project-keyed shared rows, not per-project tables.
- Invalid bootstrapped-project events can preserve raw payload with partial structure.
- Hook errors have SQLite storage and JSONL fallback.
- Provider identity dedupe exists when available.
- Tombstones can remove raw rows after terminal output references exist.
- Raw storage remains gitignored/local-only.

## Risks And Rollback

- Risk: migration version 2 is hard to alter after applied. Keep this chunk isolated and verify DDL before dependent chunks write events.
- Rollback during development: delete temp DB files created by tests. Do not mutate committed DB artifacts.
- Risk: `INSERT OR IGNORE` can hide dedupe collisions. Tests must assert the retained row is the first row and uncertain duplicates are kept.

## Non-Goals

- Do not implement provider adapters.
- Do not route hook payloads.
- Do not ingest/tombstone rows automatically beyond helper behavior.
- Do not create Session Memory rows from `SessionStart`.

## Type And Name Consistency

- Tables: `experience_events`, `hook_errors`, `experience_event_tombstones`.
- Helper file: `src/memory/experience.ts`.
- Status values: `valid`, `invalid`.
- Provider value for first adapter: `codex`.
- Source value for first adapter: `codex-hook`.
