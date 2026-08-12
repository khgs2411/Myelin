# Chunk 04: Capture Routing And Errors

**Plan Set:** `../plan.md`
**Spec:** `../spec.md`
**Status:** Ready For Implementation
**Depends on:** `01-bootstrap-project-memory-shell.md`, `02-experience-log-storage.md`
**Enables:** `05-codex-capture-adapter.md`, `06-class-kit-verification.md`

## Goal

Add the provider-neutral capture facade that receives already-normalized provider events, resolves project ownership from hook `cwd`, drops unbootstrapped repos as no-ops, stores malformed bootstrapped-project events as invalid raw evidence when possible, and fails open by writing hook errors without interrupting the caller.

## Source Artifacts

- `../spec.md`: Codex Hook Input, Data / State, Error Handling.
- `../agenda.md`: Questions 13, 21, 22, 23, 24, 29, 30, 31, 32.
- `../../../CONTEXT.md`: Capture Adapter, Experience Log.
- `../../../docs/adr/0054-use-provider-agnostic-capture-adapters.md`
- `../../../docs/adr/0055-use-global-install-with-per-repo-capture-opt-in.md`
- Dependencies from chunks 01 and 02: `bootstrapProject`, `projectForRepoPath`, `recordExperienceEvent`, `recordHookError`, `openMemoryDb`.

## Relationships

- **Depends on:** project bootstrap metadata and Experience Log storage helpers.
- **Enables:** Codex adapter can submit normalized events without knowing routing/storage details.
- **Shared contracts:** `NormalizedCaptureEvent`, `CaptureResult`, `handleCaptureEvent`.
- **Integration points:** `src/runtime/projects.ts`, `src/memory/experience.ts`, `src/memory/db.ts`.

## File Responsibility Map

**Create:**
- `src/capture/facade.ts` - provider-neutral routing, validation, persistence, fail-open behavior.
- `src/capture/facade.test.ts` - routing, no-op drops, invalid preservation, hook error tests.

**Modify:**
- None expected outside imports created by earlier chunks.

**Test:**
- `src/capture/facade.test.ts`

## Implementation Tasks

### Task 1: Define And Test Capture Facade

**Files:**
- Create: `src/capture/facade.ts`
- Create: `src/capture/facade.test.ts`

- [ ] **Step 1: Add facade tests**

```ts
import { afterEach, beforeEach, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { bootstrapProject } from "../runtime/bootstrap.ts";
import { openMemoryDbAt } from "../memory/db.ts";
import { listExperienceEvents } from "../memory/experience.ts";
import { handleCaptureEvent } from "./facade.ts";

let root: string;
let repo: string;

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "myelin-capture-"));
  repo = join(root, "repos", "class-kit");
  await mkdir(repo, { recursive: true });
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

test("drops unbootstrapped repo events as no-ops", async () => {
  const result = await handleCaptureEvent(root, {
    provider: "codex",
    source: "codex-hook",
    cwd: repo,
    raw_payload_json: "{}",
    status: "valid",
  });

  expect(result.status).toBe("dropped-unregistered-repo");
});

test("stores valid events for bootstrapped project", async () => {
  await bootstrapProject(root, "class-kit", repo);
  const result = await handleCaptureEvent(root, {
    id: "evt_1",
    provider: "codex",
    provider_session_id: "sess_1",
    turn_id: "turn_1",
    source: "codex-hook",
    cwd: join(repo, "src"),
    hook_event_name: "UserPromptSubmit",
    event_kind: "user.prompt",
    raw_text: "hello",
    raw_payload_json: "{}",
    status: "valid",
    occurred_at: "2026-06-12T10:00:00.000Z",
  });

  expect(result.status).toBe("stored");
  const db = openMemoryDbAt(join(root, "state", "memory.db"));
  expect(listExperienceEvents(db, "class-kit")).toHaveLength(1);
  db.close();
});

test("stores malformed bootstrapped project events as invalid", async () => {
  await bootstrapProject(root, "class-kit", repo);
  const result = await handleCaptureEvent(root, {
    provider: "codex",
    source: "codex-hook",
    cwd: repo,
    raw_payload_json: "{\"malformed\":true}",
    status: "invalid",
  });

  expect(result.status).toBe("stored");
  const db = openMemoryDbAt(join(root, "state", "memory.db"));
  expect(listExperienceEvents(db, "class-kit")[0].status).toBe("invalid");
  db.close();
});

test("storage failures fail open and write fallback hook error log", async () => {
  await bootstrapProject(root, "class-kit", repo);
  await mkdir(join(root, "state", "memory.db"), { recursive: true });

  const result = await handleCaptureEvent(root, {
    id: "evt_1",
    provider: "codex",
    source: "codex-hook",
    cwd: repo,
    hook_event_name: "UserPromptSubmit",
    event_kind: "user.prompt",
    raw_text: "hello",
    raw_payload_json: "{}",
    status: "valid",
  });

  expect(result.status).toBe("failed-open");
  expect(await Bun.file(join(root, "state", "hook-errors.jsonl")).exists()).toBe(true);
});
```

- [ ] **Step 2: Run facade tests**

Run: `bun test src/capture/facade.test.ts`  
Expected: fails because `src/capture/facade.ts` does not exist.

- [ ] **Step 3: Implement facade**

```ts
import { join } from "node:path";
import { openMemoryDb } from "../memory/db.ts";
import { recordExperienceEvent, recordHookError, type ExperienceStatus } from "../memory/experience.ts";
import { projectForRepoPath } from "../runtime/projects.ts";

export type NormalizedCaptureEvent = {
  id?: string;
  occurred_at?: string;
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

export type CaptureResult =
  | { status: "stored"; project_key: string; event_id: string }
  | { status: "dropped-unregistered-repo" }
  | { status: "failed-open"; error_message: string };

export async function handleCaptureEvent(root: string, event: NormalizedCaptureEvent): Promise<CaptureResult> {
  try {
    if (!event.cwd) return { status: "dropped-unregistered-repo" };
    const project = await projectForRepoPath(root, event.cwd);
    if (!project) return { status: "dropped-unregistered-repo" };

    const db = openMemoryDb(root);
    try {
      const row = recordExperienceEvent(db, {
        id: event.id ?? crypto.randomUUID(),
        project_key: project.key,
        occurred_at: event.occurred_at ?? new Date().toISOString(),
        hook_event_name: event.hook_event_name ?? null,
        event_kind: event.event_kind ?? null,
        cwd: event.cwd,
        provider: event.provider,
        provider_session_id: event.provider_session_id ?? null,
        turn_id: event.turn_id ?? null,
        raw_text: event.raw_text ?? null,
        raw_payload_json: event.raw_payload_json,
        source: event.source,
        status: event.status,
      });
      return { status: "stored", project_key: project.key, event_id: row.id };
    } finally {
      db.close();
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    try {
      const db = openMemoryDb(root);
      try {
        recordHookError(db, join(root, "state", "hook-errors.jsonl"), {
          occurred_at: new Date().toISOString(),
          provider: event.provider,
          source: event.source,
          cwd: event.cwd ?? null,
          hook_event_name: event.hook_event_name ?? null,
          error_message: message,
          raw_payload_json: event.raw_payload_json,
        });
      } finally {
        db.close();
      }
    } catch {
      recordHookError(null, join(root, "state", "hook-errors.jsonl"), {
        occurred_at: new Date().toISOString(),
        provider: event.provider,
        source: event.source,
        cwd: event.cwd ?? null,
        hook_event_name: event.hook_event_name ?? null,
        error_message: message,
        raw_payload_json: event.raw_payload_json,
      });
    }
    return { status: "failed-open", error_message: message };
  }
}
```

- [ ] **Step 4: Run facade tests**

Run: `bun test src/capture/facade.test.ts`  
Expected: passes.

## Verification

Run: `bun test src/capture/facade.test.ts src/runtime/bootstrap.test.ts src/memory/experience.test.ts`  
Expected: all tests pass.

Run: `bun run typecheck`  
Expected: TypeScript completes without errors.

## Acceptance Criteria Covered

- Global hooks save only for bootstrapped repos.
- Unbootstrapped repo events are no-op drops.
- Malformed events from bootstrapped repos can be stored as invalid raw evidence.
- Hook failures fail open and record errors when possible.
- Core capture logic is provider-neutral.

## Risks And Rollback

- Risk: facade accidentally throws to hook caller. Tests must assert `failed-open` return instead of thrown errors for storage failures.
- Rollback: remove `src/capture/facade.ts` and tests if the provider-neutral boundary needs redesign before adapter work.

## Non-Goals

- Do not install hooks.
- Do not parse Codex payloads.
- Do not create Myelin Session Memory rows.
- Do not mutate curated `wiki/` files.

## Type And Name Consistency

- Facade function: `handleCaptureEvent`.
- Input type: `NormalizedCaptureEvent`.
- Result type: `CaptureResult`.
- No-op status: `dropped-unregistered-repo`.
- Fail-open status: `failed-open`.
