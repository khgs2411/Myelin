# Chunk 05: Codex Capture Adapter

**Plan Set:** `../plan.md`
**Spec:** `../spec.md`
**Status:** Ready For Implementation
**Depends on:** `02-experience-log-storage.md`, `03-provider-install-lifecycle.md`, `04-capture-routing-and-errors.md`
**Enables:** `06-class-kit-verification.md`

## Goal

Implement the first capture provider adapter for Codex hooks. The adapter reads Codex hook JSON from stdin, maps `SessionStart`, `UserPromptSubmit`, and non-empty `Stop.last_assistant_message` into provider-neutral capture events, calls the capture facade using the explicit Myelin checkout root from `MYELIN_ROOT`, and never parses unstable transcripts, calls models, or mutates curated memory.

## Source Artifacts

- `../spec.md`: Codex Hook Input, Data / State, Testing Strategy.
- `../agenda.md`: Questions 2, 24, 28, 29, 30, 31, 32, 33, 34.
- `../../../CONTEXT.md`: Capture Provider, Capture Adapter, Experience Log.
- `../../../docs/adr/0054-use-provider-agnostic-capture-adapters.md`
- Dependencies from earlier chunks: `handleCaptureEvent`, `NormalizedCaptureEvent`, install shim calling `myelin capture codex-hook`.

## Relationships

- **Depends on:** Experience Log storage, install shim command path, provider-neutral capture facade.
- **Enables:** real Codex hook capture and manual `class-kit` verification.
- **Shared contracts:** command `myelin capture codex-hook`; shim-provided `MYELIN_ROOT`; `provider=codex`; `source=codex-hook`; event kinds `session.start`, `user.prompt`, `assistant.response`.
- **Integration points:** `src/cli.ts`, `src/capture/facade.ts`, `tests/fixtures/capture/codex/`.

## File Responsibility Map

**Create:**
- `src/capture/providers/codex.ts` - Codex payload parsing and mapping.
- `src/capture/providers/codex.test.ts` - adapter mapping tests.
- `src/commands/capture.ts` - CLI command for shim/stdin capture.
- `src/commands/capture.test.ts` - command stdin/error behavior tests.
- `tests/fixtures/capture/codex/session-start.json` - docs-based fixture.
- `tests/fixtures/capture/codex/user-prompt-submit.json` - docs-based fixture.
- `tests/fixtures/capture/codex/stop-with-message.json` - docs-based fixture.
- `tests/fixtures/capture/codex/stop-empty.json` - docs-based fixture.

**Modify:**
- `src/cli.ts` - register capture command.

**Test:**
- `src/capture/providers/codex.test.ts`
- `src/commands/capture.test.ts`

## Implementation Tasks

### Task 1: Add Codex Fixtures And Adapter Tests

**Files:**
- Create fixture JSON files under `tests/fixtures/capture/codex/`
- Create: `src/capture/providers/codex.test.ts`

- [ ] **Step 1: Add docs-based fixtures**

`tests/fixtures/capture/codex/session-start.json`:

```json
{
  "hook_event_name": "SessionStart",
  "session_id": "sess_123",
  "cwd": "/tmp/class-kit",
  "model": "gpt-5.4"
}
```

`tests/fixtures/capture/codex/user-prompt-submit.json`:

```json
{
  "hook_event_name": "UserPromptSubmit",
  "session_id": "sess_123",
  "turn_id": "turn_1",
  "cwd": "/tmp/class-kit",
  "model": "gpt-5.4",
  "prompt": "How do we create new users using Supabase?"
}
```

`tests/fixtures/capture/codex/stop-with-message.json`:

```json
{
  "hook_event_name": "Stop",
  "session_id": "sess_123",
  "turn_id": "turn_1",
  "cwd": "/tmp/class-kit",
  "model": "gpt-5.4",
  "last_assistant_message": "Use Supabase Auth admin APIs from server-side code."
}
```

`tests/fixtures/capture/codex/stop-empty.json`:

```json
{
  "hook_event_name": "Stop",
  "session_id": "sess_123",
  "turn_id": "turn_2",
  "cwd": "/tmp/class-kit",
  "model": "gpt-5.4",
  "last_assistant_message": ""
}
```

- [ ] **Step 2: Add adapter tests**

```ts
import { expect, test } from "bun:test";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { normalizeCodexHookPayload } from "./codex.ts";

const fixtures = join(process.cwd(), "tests", "fixtures", "capture", "codex");

test("maps SessionStart to session.start", async () => {
  const payload = JSON.parse(await readFile(join(fixtures, "session-start.json"), "utf8"));
  const event = normalizeCodexHookPayload(payload);

  expect(event?.provider).toBe("codex");
  expect(event?.source).toBe("codex-hook");
  expect(event?.hook_event_name).toBe("SessionStart");
  expect(event?.event_kind).toBe("session.start");
  expect(event?.provider_session_id).toBe("sess_123");
});

test("maps UserPromptSubmit prompt text", async () => {
  const payload = JSON.parse(await readFile(join(fixtures, "user-prompt-submit.json"), "utf8"));
  const event = normalizeCodexHookPayload(payload);

  expect(event?.event_kind).toBe("user.prompt");
  expect(event?.turn_id).toBe("turn_1");
  expect(event?.raw_text).toContain("Supabase");
});

test("maps Stop only when assistant message is non-empty", async () => {
  const withMessage = JSON.parse(await readFile(join(fixtures, "stop-with-message.json"), "utf8"));
  const empty = JSON.parse(await readFile(join(fixtures, "stop-empty.json"), "utf8"));

  expect(normalizeCodexHookPayload(withMessage)?.event_kind).toBe("assistant.response");
  expect(normalizeCodexHookPayload(empty)).toBeNull();
});

test("unknown or malformed payload becomes invalid raw evidence when cwd is present", () => {
  const event = normalizeCodexHookPayload({ hook_event_name: "Unexpected", cwd: "/tmp/class-kit" });

  expect(event?.status).toBe("invalid");
  expect(event?.event_kind).toBeNull();
  expect(event?.raw_payload_json).toContain("Unexpected");
});
```

- [ ] **Step 3: Run adapter tests**

Run: `bun test src/capture/providers/codex.test.ts`  
Expected: fails because `src/capture/providers/codex.ts` does not exist.

### Task 2: Implement Codex Payload Normalization

**Files:**
- Create: `src/capture/providers/codex.ts`

- [ ] **Step 1: Implement adapter normalization**

```ts
import type { NormalizedCaptureEvent } from "../facade.ts";

type CodexHookPayload = {
  hook_event_name?: string;
  session_id?: string;
  turn_id?: string;
  cwd?: string;
  prompt?: string;
  last_assistant_message?: string;
  [key: string]: unknown;
};

export function normalizeCodexHookPayload(payload: unknown, occurredAt = new Date()): NormalizedCaptureEvent | null {
  const value = payload && typeof payload === "object" ? (payload as CodexHookPayload) : {};
  const rawPayload = JSON.stringify(payload ?? null);
  const base = {
    id: crypto.randomUUID(),
    occurred_at: occurredAt.toISOString(),
    hook_event_name: value.hook_event_name ?? null,
    cwd: value.cwd ?? null,
    provider: "codex",
    provider_session_id: value.session_id ?? null,
    turn_id: value.turn_id ?? null,
    raw_payload_json: rawPayload,
    source: "codex-hook",
  };

  if (value.hook_event_name === "SessionStart") {
    return { ...base, event_kind: "session.start", raw_text: null, status: "valid" };
  }

  if (value.hook_event_name === "UserPromptSubmit" && typeof value.prompt === "string") {
    return { ...base, event_kind: "user.prompt", raw_text: value.prompt, status: "valid" };
  }

  if (value.hook_event_name === "Stop") {
    if (typeof value.last_assistant_message === "string" && value.last_assistant_message.trim().length > 0) {
      return { ...base, event_kind: "assistant.response", raw_text: value.last_assistant_message, status: "valid" };
    }
    return null;
  }

  return {
    ...base,
    event_kind: null,
    raw_text: null,
    status: "invalid",
  };
}
```

- [ ] **Step 2: Run adapter tests**

Run: `bun test src/capture/providers/codex.test.ts`  
Expected: passes.

### Task 3: Add `myelin capture codex-hook`

**Files:**
- Create: `src/commands/capture.ts`
- Create: `src/commands/capture.test.ts`
- Modify: `src/cli.ts`

- [ ] **Step 1: Add command tests**

```ts
import { afterEach, beforeEach, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { bootstrapProject } from "../runtime/bootstrap.ts";
import { openMemoryDbAt } from "../memory/db.ts";
import { listExperienceEvents } from "../memory/experience.ts";
import { captureCodexPayload } from "./capture.ts";

let root: string;
let repo: string;

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "myelin-capture-command-"));
  repo = join(root, "repos", "class-kit");
  await mkdir(repo, { recursive: true });
  await bootstrapProject(root, "class-kit", repo);
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

test("captureCodexPayload stores mapped events", async () => {
  const result = await captureCodexPayload(root, {
    hook_event_name: "UserPromptSubmit",
    session_id: "sess_1",
    turn_id: "turn_1",
    cwd: repo,
    prompt: "hello",
  });

  expect(result.exitCode).toBe(0);
  const db = openMemoryDbAt(join(root, "state", "memory.db"));
  expect(listExperienceEvents(db, "class-kit").map((event) => event.event_kind)).toEqual(["user.prompt"]);
  db.close();
});

test("captureCodexPayload treats empty Stop as no-op success", async () => {
  const result = await captureCodexPayload(root, {
    hook_event_name: "Stop",
    session_id: "sess_1",
    turn_id: "turn_1",
    cwd: repo,
    last_assistant_message: "",
  });

  expect(result.exitCode).toBe(0);
  expect(result.message).toContain("ignored");
});

test("captureCodexPayload uses explicit Myelin root even when caller cwd is another repo", async () => {
  const oldCwd = process.cwd();
  const otherRepo = join(root, "other-cwd");
  await mkdir(otherRepo, { recursive: true });
  process.chdir(otherRepo);
  try {
    const result = await captureCodexPayload(root, {
      hook_event_name: "UserPromptSubmit",
      session_id: "sess_1",
      turn_id: "turn_1",
      cwd: repo,
      prompt: "hello from another cwd",
    });

    expect(result.exitCode).toBe(0);
    const db = openMemoryDbAt(join(root, "state", "memory.db"));
    expect(listExperienceEvents(db, "class-kit")).toHaveLength(1);
    db.close();
  } finally {
    process.chdir(oldCwd);
  }
});
```

- [ ] **Step 2: Implement capture command helper and registration**

```ts
import type { Cli, CommandResult } from "./registry.ts";
import { ok, fail } from "./registry.ts";
import { repoRoot } from "../runtime/fs.ts";
import { handleCaptureEvent } from "../capture/facade.ts";
import { normalizeCodexHookPayload } from "../capture/providers/codex.ts";

export function registerCaptureCommands(cli: Cli): void {
  cli.command(["capture", "codex-hook"], async () => {
    try {
      const payload = JSON.parse(await Bun.stdin.text());
      return await captureCodexPayload(process.env.MYELIN_ROOT ?? repoRoot().root, payload);
    } catch (error) {
      return ok(`capture failed open: ${error instanceof Error ? error.message : String(error)}`);
    }
  });
}

export async function captureCodexPayload(root: string, payload: unknown): Promise<CommandResult> {
  const event = normalizeCodexHookPayload(payload);
  if (!event) return ok("codex hook ignored");
  const result = await handleCaptureEvent(root, event);
  if (result.status === "failed-open") return ok(`capture failed open: ${result.error_message}`);
  return ok(`capture ${result.status}`);
}
```

The command must use `process.env.MYELIN_ROOT` when present because Codex executes hooks with the active session `cwd`, not necessarily the Myelin checkout. The install shim from chunk 03 is responsible for exporting `MYELIN_ROOT=<active Myelin checkout>` before invoking this command.

Register in `src/cli.ts`:

```ts
import { registerCaptureCommands } from "./commands/capture.ts";
```

and:

```ts
registerCaptureCommands(cli);
```

- [ ] **Step 3: Run command tests**

Run: `bun test src/commands/capture.test.ts src/capture/providers/codex.test.ts`  
Expected: passes.

## Verification

Run: `bun test src/capture/providers/codex.test.ts src/commands/capture.test.ts src/capture/facade.test.ts`  
Expected: all tests pass.

Run: `bun run typecheck`  
Expected: TypeScript completes without errors.

Run: `printf '%s\n' '{"hook_event_name":"Stop","last_assistant_message":""}' | bun src/cli.ts capture codex-hook`  
Expected output contains `codex hook ignored`.

Run from a non-Myelin directory with `MYELIN_ROOT=/Users/liadgoren/Repositories/llm-wiki`: `printf '%s\n' '{"hook_event_name":"UserPromptSubmit","session_id":"manual","turn_id":"manual","cwd":"/Users/liadgoren/Repositories/class-kit","prompt":"synthetic"}' | MYELIN_ROOT=/Users/liadgoren/Repositories/llm-wiki bun /Users/liadgoren/Repositories/llm-wiki/src/cli.ts capture codex-hook`  
Expected: output contains `capture stored`, and the row is written to `/Users/liadgoren/Repositories/llm-wiki/state/memory.db`, not the caller cwd.

## Acceptance Criteria Covered

- Codex maps `SessionStart`, `UserPromptSubmit`, and non-empty `Stop` to provider-neutral events.
- Empty `Stop` does not create an assistant response row.
- Native provider fields remain in `raw_payload_json`.
- No transcript parsing is introduced.
- Hook command fails open from malformed stdin or storage errors.
- Docs-based fixtures exist under `tests/fixtures/capture/codex/`.
- Hook command uses `MYELIN_ROOT` when invoked from a non-Myelin cwd.

## Risks And Rollback

- Risk: real Codex payload shape may differ. Keep docs fixtures and add redacted live fixtures in chunk 06.
- Rollback: remove `capture codex-hook` registration and adapter files; install shim from chunk 03 will then point to a missing command, so do not deploy real hooks until this chunk passes.

## Non-Goals

- Do not install global hooks.
- Do not capture tool-level events.
- Do not parse `transcript_path`.
- Do not create Session Memory.
- Do not mutate curated `wiki/`.

## Type And Name Consistency

- Adapter export: `normalizeCodexHookPayload`.
- Command registration: `registerCaptureCommands`.
- Command helper: `captureCodexPayload`.
- Provider/source: `codex` / `codex-hook`.
- Fixture root: `tests/fixtures/capture/codex/`.
- Checkout root handoff: `MYELIN_ROOT`.
