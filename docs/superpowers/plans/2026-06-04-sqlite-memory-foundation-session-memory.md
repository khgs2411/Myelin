# SQLite Memory Foundation — Session Memory (capture + recall) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stand up a repo-root `state/memory.db` SQLite substrate and its first consumer — agent-driven session memory (`myelin session start/log/close/recent/show`) for cross-session continuity.

**Architecture:** A new `src/memory/` module owns the `bun:sqlite` handle, pragmas, and migrations; a pure `sessions` repository does data access; `src/commands/session.ts` is a thin CLI over it (replacing today's stub). One repo-root DB partitioned by `project_key` (ADR 0001); SQLite is serving state, never curated truth (ADR 0021/0022); the DB is git-ignored.

**Tech Stack:** Bun, TypeScript, `bun:sqlite` (built-in, no dependency), `bun test`, `tsc --noEmit`.

**Spec:** `docs/superpowers/specs/2026-06-04-sqlite-memory-foundation-design.md`

## Conventions (read once)

- Run all `bun` commands from the repo root (`/Users/liadgoren/Repositories/llm-wiki`). `repoRoot().root` is `process.cwd()` — there is no repo-root discovery.
- Tests use `bun:test` (`import { test, expect, beforeEach, afterEach } from "bun:test"`). The command-level test harness mirrors `src/commands/schema.test.ts`: `mkdtemp` a temp root, `process.chdir(root)`, seed `projects/<key>/state/project.json`, build a `Cli`, run it, `rm` the temp root in `afterEach`.
- Existing helpers (verified): `createCli/ok/fail/Cli` (`src/commands/registry.ts`), `repoRoot/resolveInside` (`src/runtime/fs.ts`), `findProject` → throws `Unknown project: <key>` (`src/runtime/projects.ts`), `readJsonIfExists/writeJson` (`src/runtime/json.ts`).
- `src/cli.ts` already imports and calls `registerSessionCommands(cli)`, so **no `cli.ts` change is needed** — Task 5 only expands `registerSessionCommands`.
- Verification gate after every task: `bun run typecheck` clean and the task's tests green.
- Note: `withDb` (Task 5) opens and migrates `state/memory.db` before per-command project validation, so a failing `session <cmd> <unknown-key>` still creates the git-ignored DB. Harmless (ignored, reversible) and cleaned by Task 6 Step 5.

## File Structure

- Create `src/runtime/ids.ts` — shared id helpers (`createId`, `timestampForFilename`), extracted from inbox.
- Modify `src/inbox/items.ts` — re-point to `ids.ts`, keep a `createInboxItemId` re-export.
- Create `src/memory/db.ts` — open `state/memory.db`, set pragmas, run migrations; test-friendly `openMemoryDbAt`.
- Create `src/memory/migrations.ts` — ordered, transactional, resumable migrations + the session schema.
- Create `src/memory/sessions.ts` — pure session repository (no LLM, no CLI).
- Modify `src/commands/session.ts` — `start/log/close/recent/show` CLI + targeting + `--json`.
- Tests: `src/runtime/ids.test.ts`, `src/memory/db.test.ts`, `src/memory/sessions.test.ts`, `src/commands/session.test.ts`.
- Modify `.gitignore` — ignore `state/memory.db*`.

---

### Task 1: `.gitignore` the generated database

**Files:**
- Modify: `.gitignore`

- [ ] **Step 1: Confirm the DB path is NOT ignored today**

Run: `git check-ignore -v state/memory.db; echo "exit=$?"`
Expected: no output, `exit=1` (not ignored).

- [ ] **Step 2: Append the ignore rule**

Add these lines to the end of `.gitignore`:

```gitignore
# Generated SQLite memory substrate (ADR 0001/0021) — never curated truth, never committed
state/memory.db
state/memory.db-wal
state/memory.db-shm
```

- [ ] **Step 3: Verify base file AND a WAL sidecar are ignored**

Run: `git check-ignore state/memory.db state/memory.db-wal state/memory.db-shm`
Expected: all three paths printed (each is ignored).

- [ ] **Step 4: Commit**

```bash
git add .gitignore
git commit -m "chore: git-ignore generated state/memory.db (SQLite memory substrate)"
```

---

### Task 2: Extract the shared id utility and re-point inbox

**Files:**
- Create: `src/runtime/ids.ts`
- Create: `src/runtime/ids.test.ts`
- Modify: `src/inbox/items.ts`

- [ ] **Step 1: Write the failing test**

Create `src/runtime/ids.test.ts`:

```ts
import { test, expect } from "bun:test";
import { createId, timestampForFilename } from "./ids.ts";

test("timestampForFilename makes an ISO timestamp filesystem-safe and trims .000", () => {
  expect(timestampForFilename(new Date("2026-04-19T19:22:14Z"))).toBe("2026-04-19T19-22-14Z");
  expect(timestampForFilename(new Date("2026-04-19T19:22:14.123Z"))).toBe("2026-04-19T19-22-14.123Z");
});

test("createId is a timestamp plus a 6-char hex suffix", () => {
  const id = createId(new Date("2026-04-19T19:22:14Z"));
  expect(id).toMatch(/^2026-04-19T19-22-14Z_[0-9a-f]{6}$/);
  expect(createId()).not.toBe(createId());
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test src/runtime/ids.test.ts`
Expected: FAIL — cannot resolve `./ids.ts`.

- [ ] **Step 3: Create the shared util**

Create `src/runtime/ids.ts`:

```ts
import { randomBytes } from "node:crypto";

export function timestampForFilename(now: Date): string {
  return now.toISOString().replace(/:/g, "-").replace(".000Z", "Z");
}

export function createId(now: Date = new Date()): string {
  return `${timestampForFilename(now)}_${randomBytes(3).toString("hex")}`;
}
```

- [ ] **Step 4: Re-point `src/inbox/items.ts` to the shared util (keep the re-export)**

In `src/inbox/items.ts`, remove the local definitions of `createInboxItemId` and `timestampForFilename` (currently near the top of the file) and replace them with imports + a compatibility re-export. The `randomBytes` import and `import` of these names are the only lines affected; everything else in `items.ts` stays.

Replace:
```ts
import { randomBytes } from "node:crypto";
```
with:
```ts
import { createId, timestampForFilename } from "../runtime/ids.ts";
```

Replace the two local function definitions:
```ts
export function createInboxItemId(now: Date = new Date()): string {
  return `${timestampForFilename(now)}_${randomBytes(3).toString("hex")}`;
}

export function timestampForFilename(now: Date): string {
  return now.toISOString().replace(/:/g, "-").replace(".000Z", "Z");
}
```
with:
```ts
export { timestampForFilename };
export const createInboxItemId = createId;
```

- [ ] **Step 5: Run the new test and the inbox tests**

Run: `bun test src/runtime/ids.test.ts src/inbox/`
Expected: PASS — `ids` tests pass and all inbox tests stay green (early checkpoint).

- [ ] **Step 6: Typecheck and commit**

Run: `bun run typecheck`
Expected: clean.

```bash
git add src/runtime/ids.ts src/runtime/ids.test.ts src/inbox/items.ts
git commit -m "refactor: extract shared id util (createId) and re-point inbox"
```

---

### Task 3: SQLite substrate — open, pragmas, transactional migrations

**Files:**
- Create: `src/memory/migrations.ts`
- Create: `src/memory/db.ts`
- Create: `src/memory/db.test.ts`

- [ ] **Step 1: Write the failing test**

Create `src/memory/db.test.ts`:

```ts
import { test, expect, beforeEach, afterEach } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openMemoryDbAt } from "./db.ts";

let dir: string;
beforeEach(async () => { dir = await mkdtemp(join(tmpdir(), "myelin-db-")); });
afterEach(async () => { await rm(dir, { recursive: true, force: true }); });

test("opening creates the session schema and records the migration", () => {
  const db = openMemoryDbAt(join(dir, "memory.db"));
  const tables = db.query("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name").all() as { name: string }[];
  const names = tables.map((t) => t.name);
  expect(names).toContain("sessions");
  expect(names).toContain("session_events");
  expect(names).toContain("schema_migrations");
  const applied = db.query("SELECT version FROM schema_migrations").all() as { version: number }[];
  expect(applied.map((r) => r.version)).toEqual([1]);
  db.close();
});

test("migrations are idempotent across re-opens", () => {
  const path = join(dir, "memory.db");
  openMemoryDbAt(path).close();
  const db = openMemoryDbAt(path);
  const count = db.query("SELECT count(*) AS n FROM schema_migrations").get() as { n: number };
  expect(count.n).toBe(1);
  db.close();
});

test("foreign keys are enforced on the connection", () => {
  const db = openMemoryDbAt(join(dir, "memory.db"));
  const fk = db.query("PRAGMA foreign_keys").get() as { foreign_keys: number };
  expect(fk.foreign_keys).toBe(1);
  db.close();
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test src/memory/db.test.ts`
Expected: FAIL — cannot resolve `./db.ts`.

- [ ] **Step 3: Write the migrations module**

Create `src/memory/migrations.ts`:

```ts
import type { Database } from "bun:sqlite";

type Migration = { version: number; sql: string };

const MIGRATIONS: Migration[] = [
  {
    version: 1,
    sql: `
      CREATE TABLE sessions (
        id          TEXT PRIMARY KEY,
        project_key TEXT NOT NULL,
        title       TEXT,
        status      TEXT NOT NULL,
        started_at  TEXT NOT NULL,
        ended_at    TEXT,
        summary     TEXT
      );
      CREATE INDEX sessions_project_started ON sessions(project_key, started_at);
      CREATE TABLE session_events (
        id         INTEGER PRIMARY KEY AUTOINCREMENT,
        session_id TEXT NOT NULL REFERENCES sessions(id),
        ts         TEXT NOT NULL,
        kind       TEXT NOT NULL,
        message    TEXT NOT NULL
      );
      CREATE INDEX session_events_session_ts ON session_events(session_id, ts);
    `,
  },
];

export function runMigrations(db: Database, now: Date = new Date()): void {
  db.exec("CREATE TABLE IF NOT EXISTS schema_migrations (version INTEGER PRIMARY KEY, applied_at TEXT NOT NULL);");
  const row = db.query("SELECT MAX(version) AS v FROM schema_migrations").get() as { v: number | null };
  const current = row?.v ?? 0;

  for (const migration of MIGRATIONS) {
    if (migration.version <= current) continue;
    const apply = db.transaction(() => {
      db.exec(migration.sql);
      db.query("INSERT INTO schema_migrations (version, applied_at) VALUES (?, ?)").run(
        migration.version,
        now.toISOString(),
      );
    });
    apply(); // throws on failure → transaction rolls back, version stays unrecorded → re-open resumes
  }
}
```

- [ ] **Step 4: Write the db module**

Create `src/memory/db.ts`:

```ts
import { Database } from "bun:sqlite";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { resolveInside } from "../runtime/fs.ts";
import { runMigrations } from "./migrations.ts";

export type MemoryDb = Database;

export function memoryDbPath(root: string): string {
  return resolveInside(root, "state", "memory.db");
}

/** Open the repo-root memory DB (creates state/ if missing). Caller closes. */
export function openMemoryDb(root: string): MemoryDb {
  return openMemoryDbAt(memoryDbPath(root));
}

/** Open at an explicit path (":memory:" or a file) — used by tests. Caller closes. */
export function openMemoryDbAt(path: string): MemoryDb {
  if (path !== ":memory:") mkdirSync(dirname(path), { recursive: true });
  const db = new Database(path);
  db.exec("PRAGMA journal_mode = WAL;");
  db.exec("PRAGMA foreign_keys = ON;");
  db.exec("PRAGMA busy_timeout = 5000;");
  runMigrations(db);
  return db;
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `bun test src/memory/db.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 6: Typecheck and commit**

Run: `bun run typecheck`
Expected: clean.

```bash
git add src/memory/db.ts src/memory/migrations.ts src/memory/db.test.ts
git commit -m "feat: SQLite memory substrate (db open, pragmas, migrations)"
```

---

### Task 4: Session repository (pure data access)

**Files:**
- Create: `src/memory/sessions.ts`
- Create: `src/memory/sessions.test.ts`

- [ ] **Step 1: Write the failing test**

Create `src/memory/sessions.test.ts`:

```ts
import { test, expect, beforeEach, afterEach } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openMemoryDbAt, type MemoryDb } from "./db.ts";
import {
  startSession, logEvent, closeSession, openSessions, recentSessions, getSession,
} from "./sessions.ts";

let dir: string;
let db: MemoryDb;
beforeEach(async () => { dir = await mkdtemp(join(tmpdir(), "myelin-sess-")); db = openMemoryDbAt(join(dir, "memory.db")); });
afterEach(async () => { db.close(); await rm(dir, { recursive: true, force: true }); });

test("full lifecycle persists rows and recall counts events", () => {
  const s = startSession(db, "trygga", "work", new Date("2026-06-04T10:00:00Z"));
  expect(s.status).toBe("open");
  logEvent(db, s.id, "note", "looked at auth", new Date("2026-06-04T10:01:00Z"));
  logEvent(db, s.id, "decision", "use sqlite", new Date("2026-06-04T10:02:00Z"));
  const closed = closeSession(db, s.id, "done", new Date("2026-06-04T10:30:00Z"));
  expect(closed.status).toBe("closed");
  expect(closed.ended_at).toBe("2026-06-04T10:30:00.000Z");

  const recent = recentSessions(db, "trygga", 5);
  expect(recent).toHaveLength(1);
  expect(recent[0].event_count).toBe(2);
  expect(recent[0].summary).toBe("done");

  const full = getSession(db, s.id);
  expect(full?.events.map((e) => e.kind)).toEqual(["note", "decision"]);
});

test("recent is newest-first, truncates to limit, and is isolated by project_key", () => {
  const a1 = startSession(db, "alpha", null, new Date("2026-06-04T09:00:00Z"));
  const a2 = startSession(db, "alpha", null, new Date("2026-06-04T11:00:00Z"));
  startSession(db, "beta", null, new Date("2026-06-04T10:00:00Z"));
  const recent = recentSessions(db, "alpha", 5);
  expect(recent.map((r) => r.id)).toEqual([a2.id, a1.id]); // newest first (deterministic)
  expect(recent.every((r) => r.project_key === "alpha")).toBe(true); // no beta leakage
  expect(recentSessions(db, "alpha", 1).map((r) => r.id)).toEqual([a2.id]); // limit truncates
});

test("openSessions returns only open sessions newest-first", () => {
  const o1 = startSession(db, "trygga", null, new Date("2026-06-04T09:00:00Z"));
  const o2 = startSession(db, "trygga", null, new Date("2026-06-04T10:00:00Z"));
  closeSession(db, o1.id, null, new Date("2026-06-04T11:00:00Z"));
  expect(openSessions(db, "trygga").map((s) => s.id)).toEqual([o2.id]);
});

test("logEvent rejects an unknown session, a closed session, and a bad kind", () => {
  const s = startSession(db, "trygga", null);
  expect(() => logEvent(db, "no-such-id", "note", "x")).toThrow("Unknown session");
  expect(() => logEvent(db, s.id, "bogus" as never, "x")).toThrow("Invalid event kind");
  closeSession(db, s.id, null);
  expect(() => logEvent(db, s.id, "note", "x")).toThrow("is closed");
});

test("closeSession rejects an already-closed session", () => {
  const s = startSession(db, "trygga", null);
  closeSession(db, s.id, null);
  expect(() => closeSession(db, s.id, null)).toThrow("already closed");
});

test("getSession returns null for an unknown id", () => {
  expect(getSession(db, "no-such-id")).toBeNull();
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test src/memory/sessions.test.ts`
Expected: FAIL — cannot resolve `./sessions.ts`.

- [ ] **Step 3: Write the repository**

Create `src/memory/sessions.ts`:

```ts
import type { Database } from "bun:sqlite";
import { createId } from "../runtime/ids.ts";

export type SessionKind = "note" | "decision" | "finding" | "followup";
export const SESSION_KINDS: SessionKind[] = ["note", "decision", "finding", "followup"];

export type SessionRow = {
  id: string;
  project_key: string;
  title: string | null;
  status: "open" | "closed";
  started_at: string;
  ended_at: string | null;
  summary: string | null;
};

export type SessionEventRow = { ts: string; kind: SessionKind; message: string };
export type RecentSession = SessionRow & { event_count: number };

const ORDER = "ORDER BY started_at DESC, id DESC";

export function startSession(db: Database, projectKey: string, title: string | null = null, now: Date = new Date()): SessionRow {
  const id = createId(now);
  db.query(
    "INSERT INTO sessions (id, project_key, title, status, started_at, ended_at, summary) VALUES (?, ?, ?, 'open', ?, NULL, NULL)",
  ).run(id, projectKey, title, now.toISOString());
  return getRow(db, id)!;
}

export function logEvent(db: Database, sessionId: string, kind: SessionKind, message: string, now: Date = new Date()): { event_id: number; ts: string } {
  if (!SESSION_KINDS.includes(kind)) throw new Error(`Invalid event kind: ${kind}`);
  const row = getRow(db, sessionId);
  if (!row) throw new Error(`Unknown session: ${sessionId}`);
  if (row.status === "closed") throw new Error(`Session ${sessionId} is closed`);
  const ts = now.toISOString();
  const result = db.query("INSERT INTO session_events (session_id, ts, kind, message) VALUES (?, ?, ?, ?)").run(sessionId, ts, kind, message);
  return { event_id: Number(result.lastInsertRowid), ts };
}

export function closeSession(db: Database, sessionId: string, summary: string | null = null, now: Date = new Date()): SessionRow {
  const row = getRow(db, sessionId);
  if (!row) throw new Error(`Unknown session: ${sessionId}`);
  if (row.status === "closed") throw new Error(`Session ${sessionId} is already closed`);
  db.query("UPDATE sessions SET status = 'closed', ended_at = ?, summary = ? WHERE id = ?").run(now.toISOString(), summary, sessionId);
  return getRow(db, sessionId)!;
}

export function openSessions(db: Database, projectKey: string): SessionRow[] {
  return db.query(`SELECT * FROM sessions WHERE project_key = ? AND status = 'open' ${ORDER}`).all(projectKey) as SessionRow[];
}

export function recentSessions(db: Database, projectKey: string, limit = 5): RecentSession[] {
  return db.query(
    `SELECT s.*, (SELECT count(*) FROM session_events e WHERE e.session_id = s.id) AS event_count
     FROM sessions s WHERE s.project_key = ? ${ORDER} LIMIT ?`,
  ).all(projectKey, limit) as RecentSession[];
}

export function getSession(db: Database, sessionId: string): { session: SessionRow; events: SessionEventRow[] } | null {
  const session = getRow(db, sessionId);
  if (!session) return null;
  const events = db.query("SELECT ts, kind, message FROM session_events WHERE session_id = ? ORDER BY ts ASC, id ASC").all(sessionId) as SessionEventRow[];
  return { session, events };
}

function getRow(db: Database, sessionId: string): SessionRow | null {
  return (db.query("SELECT * FROM sessions WHERE id = ?").get(sessionId) as SessionRow | null) ?? null;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test src/memory/sessions.test.ts`
Expected: PASS (6 tests).

- [ ] **Step 5: Typecheck and commit**

Run: `bun run typecheck`
Expected: clean.

```bash
git add src/memory/sessions.ts src/memory/sessions.test.ts
git commit -m "feat: session repository (start/log/close/recent/show data access)"
```

---

### Task 5: `session` CLI — start/log/close/recent/show, targeting, `--json`

**Files:**
- Modify: `src/commands/session.ts` (replace the stub)
- Create: `src/commands/session.test.ts`

- [ ] **Step 1: Write the failing test**

Create `src/commands/session.test.ts`:

```ts
import { test, expect, beforeEach, afterEach } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createCli } from "./registry.ts";
import { registerSessionCommands } from "./session.ts";
import { writeJson } from "../runtime/json.ts";

let root: string;
let prevCwd: string;
beforeEach(async () => {
  prevCwd = process.cwd();
  root = await mkdtemp(join(tmpdir(), "myelin-session-cmd-"));
  process.chdir(root);
  await writeJson(join(root, "projects", "trygga", "state", "project.json"), { key: "trygga", name: "Trygga" });
});
afterEach(async () => { process.chdir(prevCwd); await rm(root, { recursive: true, force: true }); });

function cli() { const c = createCli("myelin"); registerSessionCommands(c); return c; }
async function jsonRun(args: string[]) { const r = await cli().run(args); return { code: r.exitCode, body: JSON.parse(r.message) }; }

test("lifecycle: start -> log -> close -> recent emits the json facade", async () => {
  const started = await jsonRun(["session", "start", "trygga", "--title", "work", "--json"]);
  expect(started.code).toBe(0);
  const id = started.body.session_id;
  expect(Object.keys(started.body).sort()).toEqual(["project_key", "session_id", "started_at", "status", "title"]);

  const logged = await jsonRun(["session", "log", "trygga", "found the bug", "--kind", "finding", "--json"]);
  expect(logged.body.kind).toBe("finding");
  expect(logged.body.session_id).toBe(id);

  await cli().run(["session", "close", "trygga", "--summary", "shipped"]);
  const recent = await jsonRun(["session", "recent", "trygga", "--json"]);
  expect(recent.body.sessions[0].event_count).toBe(1);
  expect(recent.body.sessions[0].summary).toBe("shipped");
  expect(recent.body.sessions[0].status).toBe("closed");
});

test("log fails closed with no open session", async () => {
  const r = await cli().run(["session", "log", "trygga", "x"]);
  expect(r.exitCode).toBe(1);
  expect(r.message).toContain("session start");
});

test("with >1 open session, log fails closed and lists ids unless --session is given", async () => {
  const a = (await jsonRun(["session", "start", "trygga", "--json"])).body.session_id;
  const b = (await jsonRun(["session", "start", "trygga", "--json"])).body.session_id;
  const ambiguous = await cli().run(["session", "log", "trygga", "x"]);
  expect(ambiguous.exitCode).toBe(1);
  expect(ambiguous.message).toContain("--session");
  expect(ambiguous.message).toContain(a);
  expect(ambiguous.message).toContain(b);
  const ok = await jsonRun(["session", "log", "trygga", "x", "--session", b, "--json"]);
  expect(ok.body.session_id).toBe(b);
});

test("unknown project and unknown session fail closed", async () => {
  expect((await cli().run(["session", "start", "nope"])).exitCode).toBe(1);
  expect((await cli().run(["session", "show", "no-such-id"])).exitCode).toBe(1);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test src/commands/session.test.ts`
Expected: FAIL — `registerSessionCommands` only registers `session close` (stub), so `start`/`log`/etc. are unknown commands.

- [ ] **Step 3: Replace the stub with the full command surface**

Replace the entire contents of `src/commands/session.ts` with:

```ts
import type { Cli, CommandResult } from "./registry.ts";
import { fail, ok } from "./registry.ts";
import { repoRoot } from "../runtime/fs.ts";
import { findProject } from "../runtime/projects.ts";
import { openMemoryDb, type MemoryDb } from "../memory/db.ts";
import {
  closeSession, getSession, logEvent, openSessions, recentSessions, startSession,
  SESSION_KINDS, type SessionKind,
} from "../memory/sessions.ts";

export function registerSessionCommands(cli: Cli): void {
  cli.command(["session", "start"], (args) => withDb((db) => start(db, args)));
  cli.command(["session", "log"], (args) => withDb((db) => log(db, args)));
  cli.command(["session", "close"], (args) => withDb((db) => close(db, args)));
  cli.command(["session", "recent"], (args) => withDb((db) => recent(db, args)));
  cli.command(["session", "show"], (args) => withDb((db) => show(db, args)));
}

async function withDb(fn: (db: MemoryDb) => Promise<CommandResult>): Promise<CommandResult> {
  const db = openMemoryDb(repoRoot().root);
  try {
    return await fn(db);
  } finally {
    db.close();
  }
}

async function start(db: MemoryDb, args: string[]): Promise<CommandResult> {
  const p = parse(args, { title: true });
  if (p.error) return fail(p.error);
  if (!p.projectKey) return fail("Usage: myelin session start <key> [--title \"...\"] [--json]");
  try {
    await findProject(repoRoot().root, p.projectKey);
  } catch (error) {
    return fail(errMsg(error));
  }
  const s = startSession(db, p.projectKey, p.title ?? null);
  return emit(p.json, { session_id: s.id, project_key: s.project_key, status: s.status, started_at: s.started_at, title: s.title },
    `Started session ${s.id} for ${s.project_key}.`);
}

async function log(db: MemoryDb, args: string[]): Promise<CommandResult> {
  const p = parse(args, { kind: true, session: true, message: true });
  if (p.error) return fail(p.error);
  if (!p.projectKey || !p.message) return fail("Usage: myelin session log <key> <message> [--kind note|decision|finding|followup] [--session <id>] [--json]");
  const projectErr = await ensureProject(p.projectKey);
  if (projectErr) return fail(projectErr);
  const target = resolveTarget(db, p.projectKey, p.session);
  if ("error" in target) return fail(target.error);
  const kind = (p.kind ?? "note") as SessionKind;
  if (!SESSION_KINDS.includes(kind)) return fail(`--kind must be one of: ${SESSION_KINDS.join(", ")}`);
  try {
    const r = logEvent(db, target.id, kind, p.message);
    return emit(p.json, { session_id: target.id, event_id: r.event_id, kind, ts: r.ts }, `Logged ${kind} to ${target.id}.`);
  } catch (error) {
    return fail(errMsg(error));
  }
}

async function close(db: MemoryDb, args: string[]): Promise<CommandResult> {
  const p = parse(args, { summary: true, session: true });
  if (p.error) return fail(p.error);
  if (!p.projectKey) return fail("Usage: myelin session close <key> [--summary \"...\"] [--session <id>] [--json]");
  const projectErr = await ensureProject(p.projectKey);
  if (projectErr) return fail(projectErr);
  const target = resolveTarget(db, p.projectKey, p.session);
  if ("error" in target) return fail(target.error);
  try {
    const s = closeSession(db, target.id, p.summary ?? null);
    return emit(p.json, { session_id: s.id, status: s.status, ended_at: s.ended_at, summary: s.summary }, `Closed session ${s.id}.`);
  } catch (error) {
    return fail(errMsg(error));
  }
}

async function recent(db: MemoryDb, args: string[]): Promise<CommandResult> {
  const p = parse(args, { limit: true });
  if (p.error) return fail(p.error);
  if (!p.projectKey) return fail("Usage: myelin session recent <key> [--limit N] [--json]");
  const projectErr = await ensureProject(p.projectKey);
  if (projectErr) return fail(projectErr);
  const limit = p.limit ?? 5;
  const sessions = recentSessions(db, p.projectKey, limit).map((s) => ({
    id: s.id, title: s.title, status: s.status, started_at: s.started_at, ended_at: s.ended_at, summary: s.summary, event_count: s.event_count,
  }));
  if (p.json) return ok(JSON.stringify({ project_key: p.projectKey, sessions }, null, 2));
  if (sessions.length === 0) return ok(`No sessions recorded for ${p.projectKey}.`);
  return ok(sessions.map((s) => `${s.id} [${s.status}] ${s.started_at} (${s.event_count} events) ${s.summary ?? ""}`.trim()).join("\n"));
}

async function show(db: MemoryDb, args: string[]): Promise<CommandResult> {
  const p = parse(args, {});
  if (p.error) return fail(p.error);
  if (!p.projectKey) return fail("Usage: myelin session show <session-id> [--json]");
  const found = getSession(db, p.projectKey); // first positional is the session id here
  if (!found) return fail(`Unknown session: ${p.projectKey}`);
  if (p.json) return ok(JSON.stringify({ session: found.session, events: found.events }, null, 2));
  const header = `${found.session.id} [${found.session.status}] ${found.session.project_key}`;
  const lines = found.events.map((e) => `  ${e.ts} ${e.kind}: ${e.message}`);
  return ok([header, ...lines].join("\n"));
}

function resolveTarget(db: MemoryDb, projectKey: string, explicit?: string): { id: string } | { error: string } {
  if (explicit) {
    const found = getSession(db, explicit);
    if (!found) return { error: `Unknown session: ${explicit}` };
    if (found.session.project_key !== projectKey) return { error: `Session ${explicit} does not belong to ${projectKey}` };
    if (found.session.status === "closed") return { error: `Session ${explicit} is closed` };
    return { id: explicit };
  }
  const open = openSessions(db, projectKey);
  if (open.length === 0) return { error: `No open session for ${projectKey}. Run: myelin session start ${projectKey}` };
  if (open.length > 1) return { error: `Multiple open sessions for ${projectKey}: ${open.map((s) => s.id).join(", ")}. Pass --session <id>.` };
  return { id: open[0].id };
}

async function ensureProject(projectKey: string): Promise<string | null> {
  try {
    await findProject(repoRoot().root, projectKey);
    return null;
  } catch (error) {
    return errMsg(error);
  }
}

type Parsed = {
  projectKey: string; message: string; title?: string; summary?: string;
  kind?: string; session?: string; limit?: number; json: boolean; error?: string;
};

function parse(args: string[], allow: { title?: boolean; summary?: boolean; kind?: boolean; session?: boolean; limit?: boolean; message?: boolean }): Parsed {
  const out: Parsed = { projectKey: "", message: "", json: false };
  for (let i = 0; i < args.length; i += 1) {
    const a = args[i];
    if (a === "--json") out.json = true;
    else if (a === "--title" && allow.title) out.title = args[++i];
    else if (a === "--summary" && allow.summary) out.summary = args[++i];
    else if (a === "--kind" && allow.kind) out.kind = args[++i];
    else if (a === "--session" && allow.session) out.session = args[++i];
    else if (a === "--limit" && allow.limit) {
      const n = Number(args[++i]);
      if (!Number.isInteger(n) || n <= 0) return { ...out, error: "--limit must be a positive integer" };
      out.limit = n;
    } else if (a.startsWith("-")) return { ...out, error: `Unknown option: ${a}` };
    else if (!out.projectKey) out.projectKey = a;
    else if (allow.message) out.message = out.message ? `${out.message} ${a}` : a;
    else return { ...out, error: `Unexpected argument: ${a}` };
  }
  return out;
}

function emit(json: boolean, payload: Record<string, unknown>, text: string): CommandResult {
  return ok(json ? JSON.stringify(payload, null, 2) : text);
}

function errMsg(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test src/commands/session.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Typecheck and commit**

Run: `bun run typecheck`
Expected: clean.

```bash
git add src/commands/session.ts src/commands/session.test.ts
git commit -m "feat: myelin session start/log/close/recent/show over SQLite memory"
```

---

### Task 6: Full-suite verification + real-project smoke (Definition of Done)

**Files:** none (verification only)

- [ ] **Step 1: Full test suite**

Run: `bun test`
Expected: PASS — all prior suites plus the new `ids`/`db`/`sessions`/`session` tests, **0 failures** (the real gate). The prior baseline is 31 tests on this branch; the absolute count shifts if another slice merges first, so assert on 0 failures, not the total.

- [ ] **Step 2: Typecheck**

Run: `bun run typecheck`
Expected: clean (exit 0).

- [ ] **Step 3: Real-project smoke (uses a real project under `projects/`)**

Run:
```bash
SID=$(bun src/cli.ts session start trygga --title smoke --json | grep -o '"session_id": "[^"]*"' | cut -d'"' -f4)
bun src/cli.ts session log trygga "smoke note" --kind note
bun src/cli.ts session close trygga --summary "smoke done"
bun src/cli.ts session recent trygga --json
```
Expected: `start` prints a session id; `log`/`close` succeed; `recent` shows the closed session with `event_count` 1 and `summary` "smoke done".

- [ ] **Step 4: Confirm the DB is git-ignored and unstaged**

Run: `git status --porcelain state/ ; git check-ignore state/memory.db state/memory.db-wal`
Expected: no `state/` entries in `git status` (ignored); both paths printed by `check-ignore`.

- [ ] **Step 5: Clean up the smoke DB (optional)**

Run: `rm -f state/memory.db state/memory.db-wal state/memory.db-shm`
Expected: removes the local generated DB (it is reversible — re-created on next open).

---

## Self-Review (done by the planner)

- **Spec coverage:** substrate + pragmas (Task 3) ✓; `project_key` partitioning + isolation test (Task 4) ✓; capture `start/log/close` (Tasks 4–5) ✓; recall `recent/show` (Tasks 4–5) ✓; `--session` targeting + fail-closed on 0/>1 open (Task 5) ✓; deterministic `started_at DESC, id DESC` ordering (Task 4 `ORDER`) ✓; FK/atomicity/resumable migrations (Task 3) ✓; shared `ids.ts` + inbox re-point (Task 2) ✓; gitignore (Task 1) ✓; `--json` shapes for all commands (Task 5 tests assert field sets) ✓; `recent` default 5 (Task 5) ✓; DoD + smoke (Task 6) ✓. `status` integration and markdown promotion are intentionally absent (deferred).
- **Placeholder scan:** none — every code/test/command step is complete.
- **Type consistency:** `MemoryDb`, `SessionRow`, `SessionKind`, `SESSION_KINDS`, `createId`, `openMemoryDb`/`openMemoryDbAt`, `runMigrations`, and the `session` repo function names match across Tasks 2–5.
