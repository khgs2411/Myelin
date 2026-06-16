import { afterEach, beforeEach, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { writeJson } from "../../src/runtime/json.ts";
import { SessionService } from "../../src/session/session-service.ts";

let root: string;

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "myelin-session-service-"));
  await writeJson(join(root, "projects", "trygga", "state", "project.json"), { key: "trygga", name: "Trygga" });
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

test("session service owns lifecycle workflow and active-session resolution", async () => {
  const service = new SessionService(root);

  const started = await service.start("trygga", "work");
  const logged = await service.log({ projectKey: "trygga", message: "found the bug", kind: "finding" });
  const closed = await service.close({ projectKey: "trygga", summary: "shipped" });
  const recent = await service.recent("trygga");

  expect(started.title).toBe("work");
  expect(logged.session_id).toBe(started.session_id);
  expect(logged.kind).toBe("finding");
  expect(closed.status).toBe("closed");
  expect(closed.summary).toBe("shipped");
  expect(recent.sessions[0]).toMatchObject({ id: started.session_id, event_count: 1, status: "closed" });
});

test("session service fails closed when no active session can be resolved", async () => {
  const service = new SessionService(root);

  await expect(service.log({ projectKey: "trygga", message: "x" })).rejects.toThrow(
    "No open session for trygga. Run: myelin session start trygga",
  );
});
