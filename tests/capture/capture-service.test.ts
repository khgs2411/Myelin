import { afterEach, beforeEach, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openMemoryDbAt } from "../../src/memory/db.ts";
import { listExperienceEvents } from "../../src/memory/experience.ts";
import { bootstrapProject } from "../../src/runtime/bootstrap.ts";
import { CaptureService } from "../../src/capture/capture-service.ts";

let root: string;
let repo: string;

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "myelin-capture-service-"));
  repo = join(root, "repos", "class-kit");
  await mkdir(repo, { recursive: true });
  await bootstrapProject(root, "class-kit", repo);
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

test("capture service normalizes Codex payloads and stores routed experience events", async () => {
  const service = new CaptureService(root);

  const result = await service.captureCodexPayload({
    hook_event_name: "UserPromptSubmit",
    session_id: "sess_1",
    turn_id: "turn_1",
    cwd: repo,
    prompt: "hello",
  });

  expect(result.message).toBe("capture stored");
  const db = openMemoryDbAt(join(root, "state", "memory.db"));
  try {
    expect(listExperienceEvents(db, "class-kit").map((event) => event.event_kind)).toEqual(["user.prompt"]);
  } finally {
    db.close();
  }
});
