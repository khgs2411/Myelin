import { afterEach, beforeEach, expect, test } from "bun:test";
import { mkdir, mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openMemoryDbAt } from "../../src/memory/db.ts";
import { listExperienceEvents } from "../../src/memory/experience.ts";
import { bootstrapProject } from "../../src/runtime/bootstrap.ts";
import { handleCaptureEvent } from "../../src/capture/facade.ts";

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
  }, {
    gitContextRunner: async (command) => {
      if (command.join(" ") === "git branch --show-current") return { exitCode: 0, stdout: "feature/sqlite-vec\n", stderr: "" };
      if (command.join(" ") === "git rev-parse HEAD") return { exitCode: 0, stdout: "abc123\n", stderr: "" };
      return { exitCode: 1, stdout: "", stderr: "unknown command" };
    },
  });

  expect(result).toEqual({ status: "stored", project_key: "class-kit", event_id: "evt_1" });

  const db = openMemoryDbAt(join(root, "state", "memory.db"));
  try {
    const [event] = listExperienceEvents(db, "class-kit");
    expect(event.git_branch).toBe("feature/sqlite-vec");
    expect(event.git_commit).toBe("abc123");
    expect(event.repo_path).toBe(repo);
    expect(event.git_worktree_id).toBe(repo);
  } finally {
    db.close();
  }
});

test("stored capture events schedule auto memory maintenance through injected scheduler", async () => {
  await bootstrapProject(root, "class-kit", repo);
  const scheduled: string[] = [];

  const result = await handleCaptureEvent(
    root,
    {
      id: "evt_1",
      provider: "codex",
      source: "codex-hook",
      cwd: repo,
      hook_event_name: "UserPromptSubmit",
      event_kind: "user.prompt",
      raw_text: "hello",
      raw_payload_json: "{}",
      status: "valid",
      occurred_at: "2026-06-12T10:00:00.000Z",
    },
    {
      maintenanceScheduler: {
        async maybeSchedule(projectKey) {
          scheduled.push(projectKey);
          return { status: "skipped", reason: "test scheduler" };
        },
      },
    },
  );

  expect(result).toEqual({ status: "stored", project_key: "class-kit", event_id: "evt_1" });
  expect(scheduled).toEqual(["class-kit"]);
});

test("auto memory maintenance scheduling failures do not break capture", async () => {
  await bootstrapProject(root, "class-kit", repo);

  const result = await handleCaptureEvent(
    root,
    {
      id: "evt_1",
      provider: "codex",
      source: "codex-hook",
      cwd: repo,
      raw_payload_json: "{}",
      status: "valid",
    },
    {
      maintenanceScheduler: {
        async maybeSchedule() {
          throw new Error("scheduler failed");
        },
      },
    },
  );

  expect(result).toEqual({ status: "stored", project_key: "class-kit", event_id: "evt_1" });
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
  try {
    const [event] = listExperienceEvents(db, "class-kit");
    expect(event.status).toBe("invalid");
    expect(event.hook_event_name).toBeNull();
  } finally {
    db.close();
  }
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

  const fallback = join(root, "state", "hook-errors.jsonl");
  expect(await Bun.file(fallback).exists()).toBe(true);
  const [line] = (await readFile(fallback, "utf8")).trim().split("\n");
  expect(JSON.parse(line).error_message).toBeString();
});
