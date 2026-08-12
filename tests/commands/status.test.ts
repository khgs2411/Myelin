import { afterEach, beforeEach, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createCli } from "../../src/commands/registry.ts";
import { registerStatusCommand } from "../../src/commands/status.ts";
import { openMemoryDbAt } from "../../src/memory/db.ts";
import { writeJson } from "../../src/runtime/json.ts";

let root: string;
beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "myelin-status-command-"));
  await writeFile(join(root, "myelin.config"), "AUTO_MEMORY_MAINTENANCE=0\nAUTO_PROJECT_MEMORY_MAINTENANCE=0\n");
  await seedProject();
});
afterEach(async () => { await rm(root, { recursive: true, force: true }); });

test("human status derives from the normalized operational contract", async () => {
  seedDb();
  const result = await cli(join(root, "repos", "demo")).run(["status"]);
  expect(result.exitCode).toBe(0);
  expect(result.message).toContain("Myelin status: attention");
  expect(result.message).toContain("Project: demo (Demo) [cwd]");
  expect(result.message).toContain("Session continuity: unavailable");
  expect(result.message).toContain("Session Memory:");
  expect(result.message).toContain("Project Memory:");
});

test("--json emits exact myelin.status.v1 and no legacy shallow fields", async () => {
  seedDb();
  const result = await cli().run(["status", "demo", "--json"]);
  const response = JSON.parse(result.message);
  expect(result.exitCode).toBe(0);
  expect(response.contract_version).toBe("myelin.status.v1");
  expect(response.kind).toBe("project_operational_status");
  expect(response.project.resolved_from).toBe("argument");
  expect(Object.keys(response)).toEqual(["contract_version", "kind", "generated_at", "overall_state", "project", "installation", "session_memory", "project_memory", "briefing", "warnings", "actions", "evidence"]);
  expect(response.briefing).toMatchObject({
    contract_version: "myelin.status.briefing.v1",
    session_continuity: {
      contract_version: "myelin.session_continuity.v1",
      kind: "session_current_continuity",
      state: "unavailable",
    },
  });
  for (const key of ["answer", "confidence", "memory_scope", "citations", "candidate_ids", "degraded", "degraded_reason", "source_tools"]) expect(key in response).toBe(false);
});

test("a successfully observed blocked state exits zero", async () => {
  const result = await cli().run(["status", "demo", "--json"]);
  expect(result.exitCode).toBe(0);
  expect(JSON.parse(result.message).overall_state).toBe("blocked");
});

test("identity and invocation failures exit nonzero before a contract exists", async () => {
  expect(await cli(join(root, "unrelated")).run(["status"])).toMatchObject({ exitCode: 1 });
  expect(await cli().run(["status", "--bad"])).toMatchObject({ exitCode: 1 });
  expect(await cli().run(["status", "demo", "extra"])).toMatchObject({ exitCode: 1 });
});

function cli(callerCwd = join(root, "caller")): ReturnType<typeof createCli> {
  const value = createCli("myelin");
  registerStatusCommand(value, { context: { myelinRoot: root, callerCwd, invocationKind: "test", rootSource: "test_dependency", launcherPath: null, locatorPath: join(root, "machine", "install.json") } });
  return value;
}

function seedDb(): void { openMemoryDbAt(join(root, "state", "memory", "memory.db")).close(); }
async function seedProject(): Promise<void> {
  const repo = join(root, "repos", "demo");
  await mkdir(repo, { recursive: true });
  await writeJson(join(root, "state", "demo", "project.json"), { key: "demo", name: "Demo", repo_paths: [repo] });
}
