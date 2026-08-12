import { test, expect, beforeEach, afterEach } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createCli } from "../../src/commands/registry.ts";
import { registerSessionCommands as registerSessionCommandsWithContext } from "../../src/commands/session.ts";
import { writeJson } from "../../src/runtime/json.ts";

let root: string;
let prevCwd: string;
beforeEach(async () => {
  prevCwd = process.cwd();
  root = await mkdtemp(join(tmpdir(), "myelin-session-cmd-"));
  process.chdir(root);
  await writeJson(join(root, "state", "trygga", "project.json"), { key: "trygga", name: "Trygga" });
});
afterEach(async () => { process.chdir(prevCwd); await rm(root, { recursive: true, force: true }); });

function cli() {
  const c = createCli("myelin");
  registerSessionCommandsWithContext(c, {
    context: {
      myelinRoot: root,
      callerCwd: join(root, "caller"),
      invocationKind: "test",
      rootSource: "test_dependency",
      launcherPath: null,
      locatorPath: null,
    },
  });
  return c;
}
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
