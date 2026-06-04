# Myelin — SQLite Memory Foundation, Slice 1: Session Memory (capture + recall)

This is the first SQLite memory slice, landing on the completed Bun/TypeScript V2 core (Phase 0). It stands up the repo-root SQLite substrate and its first consumer — session memory for cross-session continuity. It deliberately does not move any curated truth into SQLite.

## Scope And Boundary

In scope:

- The SQLite substrate: a repo-root `state/memory.db` (Bun `bun:sqlite`), opened/migrated by a small `src/memory/` module, partitioned by `project_key`.
- Session memory as the first consumer: capture during work (`start` → `log` → `close`) and recall recent sessions (`recent`, `show`), agent-driven through the `myelin session` CLI.
- A small shared id utility (`src/runtime/ids.ts`) extracted from the existing inbox id generator (see "Session Id").
- A `.gitignore` rule for the generated database (see "DB Location & VCS").

Out of scope (deferred to later slices):

- Promotion of SQLite session rows into curated `wiki/sessions/*.md`.
- Wiring session recall into the existing `myelin status` startup read (status keeps its current `SessionPointer`/state-JSON behavior this slice).
- Repo-root discovery (walking up to a marker) — this slice keeps the existing `cwd`-based contract; discovery, if wanted, is a separate cross-cutting change.
- Vector recall / `sqlite-vec`, embeddings; a broader event/experience log beyond `session_events`; practice/personal memory; Codex hooks / auto-capture; MCP facade changes.

## Decided Architecture (from existing ADRs)

Settled; this slice conforms rather than revisiting:

- **ADR 0001** — one repo-root SQLite database at `state/memory.db`, partitioned by `project_key` (not one DB per project).
- **ADR 0021 / 0022** — SQLite is generated serving/recall/session/event/queue state, never curated truth. Curated Project Memory stays markdown + state JSON.
- **ADR 0002** — session memory starts in SQLite, with markdown promotion as a later, explicit step.
- **ADR 0013** — SQLite memory lands only after the core TypeScript migration, which is now complete.

## DB Location & VCS

- **Path:** repo-root `state/memory.db` (per ADR 0001). This root-level `state/` is **distinct** from the per-project `projects/<key>/state/` directories that `src/runtime/state.ts` manages; it is a new top-level directory created on first open.
- **Root resolution:** all `myelin` commands resolve paths from `repoRoot().root`, which is `process.cwd()` today (`src/runtime/fs.ts`); there is no upward repo-root discovery. The contract for this slice is the same as every existing command: **run `myelin` from the Myelin repo root**. `db.ts` resolves `state/memory.db` via the same `repoRoot()`/`resolveInside` helpers so session memory and `projects/` always share one root. Error/usage text should make the repo-root expectation explicit.
- **Version control:** the database is generated serving state and **must never be committed** (ADR 0021/0022). This slice **adds** ignore rules — they do not exist today — for `state/memory.db` and its WAL/SHM sidecars (`state/memory.db*`). A test or check confirms the path is ignored.

## Connection Setup (`db.ts`)

On open, before any feature read/write, set per-connection pragmas:

- `PRAGMA journal_mode = WAL` — better concurrent-reader behavior for a multi-agent repo; this is why the WAL/SHM sidecars exist and are git-ignored.
- `PRAGMA foreign_keys = ON` — `bun:sqlite` does not enforce foreign keys by default; this is required for `session_events.session_id` integrity (confirm against current `bun:sqlite` docs during implementation).
- `PRAGMA busy_timeout = <small ms>` — so concurrent writers queue briefly instead of erroring immediately.

## Module Layout

- `src/runtime/ids.ts` — **new shared** id helpers extracted from `src/inbox/items.ts`: `createId(now?)` and `timestampForFilename(now)` with the exact existing format `YYYY-MM-DDTHH-MM-SS(.mmm)Z_<6-hex>` (UTC ISO with `:`→`-`, then `randomBytes(3)` hex). `src/inbox/items.ts` is re-pointed to import these and **keeps a `createInboxItemId` re-export** so any existing import site stays green; run `bun test src/inbox/` immediately after the move as an early checkpoint. Sessions use `createId` for `sessions.id`.
- `src/memory/db.ts` — open `state/memory.db` via `bun:sqlite`, create `state/` if missing, apply pragmas, run migrations on open, expose a typed handle. Supports an in-memory / temp path for tests.
- `src/memory/migrations.ts` — ordered migrations (`version` + SQL); a `schema_migrations` table records applied versions; `migrate(db)` is idempotent. Each migration runs in a transaction: on failure it rolls back and its version is **not** recorded, so a re-open resumes cleanly from the failed version.
- `src/memory/sessions.ts` — pure data-access repository over a db handle: `startSession`, `logEvent`, `closeSession`, `recentSessions`, `getSession`. Deterministic; no LLM. `closeSession` updates `status`, `ended_at`, and `summary` in a single statement.
- `src/commands/session.ts` — thin CLI over the repository; replaces today's not-implemented `session close` stub. Arg parsing mirrors the existing `parseArgs` style in `src/commands/schema.ts`/`memory.ts`. Every command validates the project with `findProject` and supports `--json`.

## Schema

```
sessions(
  id          TEXT PRIMARY KEY,          -- createId(): YYYY-MM-DDTHH-MM-SS(.mmm)Z_<6hex>
  project_key TEXT NOT NULL,
  title       TEXT,                       -- optional, set at start
  status      TEXT NOT NULL,              -- 'open' | 'closed'
  started_at  TEXT NOT NULL,              -- ISO 8601
  ended_at    TEXT,                        -- ISO 8601, null while open
  summary     TEXT                         -- set at close
)
INDEX sessions_project_started ON sessions(project_key, started_at)

session_events(
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  session_id  TEXT NOT NULL REFERENCES sessions(id),
  ts          TEXT NOT NULL,              -- ISO 8601
  kind        TEXT NOT NULL,              -- 'note' | 'decision' | 'finding' | 'followup'
  message     TEXT NOT NULL
)
INDEX session_events_session_ts ON session_events(session_id, ts)

schema_migrations(version INTEGER PRIMARY KEY, applied_at TEXT NOT NULL)
```

`kind` is a small fixed enum (default `note`); `logEvent` rejects values outside the enum. The normalized `session_events` table is also the seam toward the later unified event/experience-log layer.

## Command Surface & Session Targeting

The project-keyed commands (`start`/`log`/`close`/`recent`) validate the project via `findProject` (unknown project → fail closed, matching existing commands). `show` takes a session id, not a project key, so it does not call `findProject`: it fails closed on an unknown id and reads `project_key` from the session row. All commands accept `--json`.

- `myelin session start <key> [--title "..."]` — insert an `open` session; print the new session id. `start` never refuses; multiple open sessions per project are allowed (see targeting).
- `myelin session log <key> <message> [--kind note|decision|finding|followup] [--session <id>]` — append an event to the target session (default `kind` = `note`).
- `myelin session close <key> [--summary "..."] [--session <id>]` — set `status=closed`, `ended_at`, `summary` on the target session.
- `myelin session recent <key> [--limit N] [--json]` — recent sessions newest-first (default **N = 5**), each with close summary and event count. This is the continuity read a new session performs at startup.
- `myelin session show <session-id> [--json]` — one session plus its ordered events; unknown id → fail closed. `project_key` is read from the session row (no project positional).

**Target session resolution (concurrency-safe):** `log` and `close` resolve the target session as:

1. If `--session <id>` is given: target that session. Error if it does not exist or is already closed.
2. Else, look at the project's `open` sessions: **exactly one** → target it; **zero** → fail closed ("run `myelin session start <key>`"); **more than one** → **fail closed**, listing the open session ids and instructing the caller to pass `--session <id>`. (No silent "most recent" pick — this is the concurrent-agent corruption guard.)

Ordering for `recent` and for resolution is deterministic: `started_at DESC, id DESC` (the `id` tiebreak handles equal timestamps, since `started_at` is TEXT).

## `--json` Output Shapes

Stable, asserted field sets (a degraded/error result uses `{ "error": "<message>" }` with a non-zero exit):

- `start` → `{ session_id, project_key, status, started_at, title }`
- `log` → `{ session_id, event_id, kind, ts }`
- `close` → `{ session_id, status, ended_at, summary }`
- `recent` → `{ project_key, sessions: [ { id, title, status, started_at, ended_at, summary, event_count } ] }`
- `show` → `{ session: { id, project_key, title, status, started_at, ended_at, summary }, events: [ { ts, kind, message } ] }`

Human (non-`--json`) output is concise text; a degraded result is printed to stderr with a non-zero exit.

## Error Handling

- Opening the DB creates `state/` and the file if missing, applies pragmas, and runs pending migrations; a migration failure rolls back that migration (version unrecorded) and aborts before any feature write — re-open resumes from the failed version.
- `log`/`close` with **no** open session and no `--session` → fail closed with the "run `session start`" guidance.
- `log`/`close` with **>1** open session and no `--session` → fail closed listing open ids (see targeting).
- `log`/`close --session <id>` against an unknown or already-closed session → fail closed.
- `close` on an already-closed session → fail closed ("session already closed").
- `log` against an invalid `session_id` is rejected (enforced by `PRAGMA foreign_keys=ON` plus an explicit open-status check).
- `show <id>` for an unknown id, and any command for an unknown project → fail closed.
- `--json` always returns a structured result (success or `{error}`); deferred/unsupported behavior is explicit, never a silent weak fallback.

## Testing (intent-encoding)

- Migrations apply once and are idempotent; a re-open does not re-run them; a failing migration leaves the DB resumable (version unrecorded).
- Full `start` → `log` → `close` → `recent` lifecycle persists correct rows; `recent` returns sessions newest-first with correct `event_count`.
- **`project_key` isolation** — sessions written under project A never surface in B's `recent`/`show`.
- **Concurrency targeting** — two open sessions + `log` without `--session` fails closed listing ids; `log --session <id>` routes to the right session; one open session resolves implicitly.
- No open session → `log`/`close` fail closed with guidance.
- **FK integrity** — `logEvent` against a non-existent `session_id` is rejected (the test opens through the real `db.ts` path so the per-connection `foreign_keys=ON` pragma applies).
- `close` on an already-closed session fails closed.
- `--json` field set is stable for every command (asserted).

## Definition Of Done

- `bun test` green (including the tests above) and `bun run typecheck` clean.
- `state/memory.db*` is git-ignored — verified for the base file **and** a WAL sidecar (e.g. `git check-ignore state/memory.db-wal`) — and no DB file is staged.
- `myelin session start/log/close/recent/show` work end-to-end against a real project; inbox tests still pass after the `ids.ts` extraction.

This slice is fully autonomous to implement: it adds generated, git-ignored state and a new command surface, performs no destructive migration of existing data, and is trivially reversible (delete `state/memory.db*` — base plus WAL/SHM sidecars — and re-migrate). No confirmation gates are required during implementation.

## Future Slices (not built here)

Markdown promotion (`session promote` → `wiki/sessions/*.md`), wiring recall into `myelin status`, repo-root discovery, the broader event/experience log, practice/personal memory, vector recall, and hook-based auto-capture each build on this substrate in later, separately-specced slices.
