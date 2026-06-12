import { afterEach, beforeEach, expect, test } from "bun:test";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
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

  expect(row?.id).toBe("evt_1");
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

  expect(row?.status).toBe("invalid");
  expect(row?.hook_event_name).toBeNull();
  expect(row?.cwd).toBeNull();
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

test("tombstoned provider identities prevent replayed raw rows", () => {
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
  tombstoneExperienceEvent(db, {
    id: "tomb_1",
    original_event_id: "evt_1",
    project_key: "class-kit",
    processed_at: "2026-06-12T10:05:00.000Z",
    terminal_decision: "memory.candidate",
    output_references: ["projects/class-kit/state/candidates.json"],
  });

  const replay = recordExperienceEvent(db, { ...input, id: "evt_2" });

  expect(replay).toBeNull();
  expect(listExperienceEvents(db, "class-kit")).toEqual([]);
});

test("tombstones keep uncertain duplicates when no dedupe identity exists", () => {
  const input = {
    project_key: "class-kit",
    occurred_at: "2026-06-12T10:00:00.000Z",
    provider: "codex",
    raw_payload_json: "{}",
    source: "codex-hook",
    status: "valid" as const,
  };

  recordExperienceEvent(db, { ...input, id: "evt_1" });
  tombstoneExperienceEvent(db, {
    id: "tomb_1",
    original_event_id: "evt_1",
    project_key: "class-kit",
    processed_at: "2026-06-12T10:05:00.000Z",
    terminal_decision: "rejected.no-action",
    output_references: ["projects/class-kit/state/rejections.json"],
  });

  const uncertainReplay = recordExperienceEvent(db, { ...input, id: "evt_2" });

  expect(uncertainReplay?.id).toBe("evt_2");
  expect(listExperienceEvents(db, "class-kit").map((event) => event.id)).toEqual(["evt_2"]);
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
