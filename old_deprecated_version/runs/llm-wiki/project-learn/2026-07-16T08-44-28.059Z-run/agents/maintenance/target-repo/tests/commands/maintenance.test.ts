import { expect, test } from "bun:test";
import { registerMaintenanceCommands } from "../../src/commands/maintenance.ts";
import { createCli } from "../../src/commands/registry.ts";
import type { LaunchContext } from "../../src/runtime/launch-context.ts";

const context: LaunchContext = {
  myelinRoot: "/tmp/myelin",
  callerCwd: "/tmp/target",
  invocationKind: "test",
  rootSource: "test_dependency",
  launcherPath: null,
  locatorPath: null,
};

test("maintenance worker routes invoke their owning service through the central CLI", async () => {
  const cli = createCli("myelin");
  const calls: string[] = [];
  registerMaintenanceCommands(cli, {
    context,
    sessionRunner: {
      async run(projectKey) {
        calls.push(`session:${projectKey}`);
        return {
          status: "completed",
          project_key: projectKey,
          run_id: "session_run",
          ingest_started: false,
          indexed: 0,
          index_failed: 0,
          pending_remaining: 0,
        };
      },
    },
    projectRunner: {
      async run(projectKey) {
        calls.push(`project:${projectKey}`);
        return {
          status: "completed",
          project_key: projectKey,
          run_id: "project_run",
          changed_files: [],
          counts_before: { pending_inbox_items: 0, pending_project_candidates: 0 },
          counts_after: { pending_inbox_items: 0, pending_project_candidates: 0 },
        };
      },
    },
  });

  expect((await cli.run(["maintenance", "worker", "session", "demo"])).exitCode).toBe(0);
  expect((await cli.run(["maintenance", "worker", "project", "demo"])).exitCode).toBe(0);
  expect(calls).toEqual(["session:demo", "project:demo"]);
});

test("maintenance worker routes fail closed on usage and service failure", async () => {
  const cli = createCli("myelin");
  registerMaintenanceCommands(cli, {
    context,
    sessionRunner: {
      async run(projectKey) {
        return {
          status: "failed",
          project_key: projectKey,
          run_id: "failed_run",
          ingest_started: false,
          indexed: 0,
          index_failed: 0,
          pending_remaining: 0,
          error_message: "session failed",
        };
      },
    },
  });

  expect((await cli.run(["maintenance", "worker", "session"])).message).toContain("Usage");
  expect((await cli.run(["maintenance", "worker", "session", "demo"]))).toEqual({
    exitCode: 1,
    message: "session failed",
  });
});
