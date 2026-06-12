import { afterEach, beforeEach, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openMemoryDbAt } from "../memory/db.ts";
import { listExperienceEvents } from "../memory/experience.ts";
import { bootstrapProject } from "../runtime/bootstrap.ts";
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
  expect(result.message).toBe("capture stored");

  const db = openMemoryDbAt(join(root, "state", "memory.db"));
  try {
    expect(listExperienceEvents(db, "class-kit").map((event) => event.event_kind)).toEqual(["user.prompt"]);
  } finally {
    db.close();
  }
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
    try {
      expect(listExperienceEvents(db, "class-kit")).toHaveLength(1);
    } finally {
      db.close();
    }
  } finally {
    process.chdir(oldCwd);
  }
});
