import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdtemp, realpath, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

import type { ProjectRegistration } from "../../src/project/project-registration.ts";
import { Project } from "../../src/storage/sqlite/models/project.model.ts";
import { ProjectRegistrationRepository } from "../../src/storage/sqlite/repositories/project-registration.repository.ts";
import { SqliteDatabase } from "../../src/storage/sqlite/sqlite-database.ts";
import {
  SqliteRuntime,
  type InitializedSqliteRuntime,
} from "../../src/storage/sqlite/sqlite-runtime.ts";
import type { WorkspaceContextResolution } from "../../src/workspace/workspace-context.service.ts";
import { WorkspaceContextService } from "../../src/workspace/workspace-context.service.ts";

const REPOSITORY_ROOT = await realpath(join(import.meta.dir, "..", ".."));
const DATABASE_PATH = join(REPOSITORY_ROOT, ".llm-wiki-dev", "state.sqlite");
const APPLICATION_PROBE = join(
  REPOSITORY_ROOT,
  "tests",
  "support",
  "application-probe.ts",
);

let database: SqliteDatabase | undefined;
let runtime: InitializedSqliteRuntime;
let registrations: readonly ProjectRegistration[];
let workspaceResolution: WorkspaceContextResolution;

beforeAll(async () => {
  if (!(await Bun.file(DATABASE_PATH).exists())) {
    throw new Error(
      "Local sanity tests require the seeded .llm-wiki-dev/state.sqlite database.",
    );
  }

  runtime = await SqliteRuntime.initialize();
  database = await SqliteDatabase.open({
    databasePath: DATABASE_PATH,
    runtime,
  });

  const repository = new ProjectRegistrationRepository();
  registrations = await repository.listRegistrations();
  workspaceResolution = await new WorkspaceContextService(repository).resolve({
    workingDirectory: join(REPOSITORY_ROOT, "src", "storage"),
  });
});

afterAll(async () => {
  await database?.close();
});

describe("local LLM Wiki application", () => {
  test("opens the real SQLite stack with the expected runtime", async () => {
    expect(runtime.bunVersion).toBe(Bun.version);
    expect(runtime.bunVersion.startsWith("1.4.")).toBeTrue();
    expect(await Bun.file(runtime.sqliteVecExtensionPath).exists()).toBeTrue();
  });

  test("reads the seeded Project as a plain application snapshot", () => {
    const project = registrations.find(({ key }) => key === "llm-wiki");

    expect(project).toEqual({
      identity: expect.any(Number),
      key: "llm-wiki",
      rootPath: REPOSITORY_ROOT,
      repositoryRootPath: REPOSITORY_ROOT,
    });
    expect(project).not.toBeInstanceOf(Project);
  });

  test("resolves a real descendant directory and active Git branch", async () => {
    expect(workspaceResolution.kind).toBe("managed");
    if (workspaceResolution.kind !== "managed") {
      throw new Error(
        `Expected a managed resolution, received ${workspaceResolution.kind}.`,
      );
    }

    const branch = await currentBranch();
    expect(workspaceResolution.context.project.key).toBe("llm-wiki");
    expect(workspaceResolution.context.workingDirectory).toBe(
      await realpath(join(REPOSITORY_ROOT, "src", "storage")),
    );
    expect(workspaceResolution.context.git).toMatchObject({
      kind: "observed",
      branchName: branch,
      headCommitId: expect.any(String),
    });
  });

  test("creates and closes Application for the registered repository", async () => {
    const result = await runBun([
      "run",
      APPLICATION_PROBE,
      DATABASE_PATH,
      REPOSITORY_ROOT,
    ]);

    expect(result).toEqual({
      exitCode: 0,
      stdout: "opened-and-closed\n",
      stderr: "",
    });
  });

  test("opens the runtime without resolving a capture directory", async () => {
    const unmanagedDirectory = await mkdtemp(
      join(tmpdir(), "llm-wiki-unmanaged-"),
    );

    try {
      const result = await runBun([
        "run",
        APPLICATION_PROBE,
        DATABASE_PATH,
        unmanagedDirectory,
      ]);

      expect(result).toEqual({
        exitCode: 0,
        stdout: "opened-and-closed\n",
        stderr: "",
      });
    } finally {
      await rm(unmanagedDirectory, { recursive: true, force: true });
    }
  });

  test("prints CLI help on stdout with success", async () => {
    const result = await runBun(["run", "cli.ts", "--help"]);

    expect(result.exitCode).toBe(0);
    expect(result.stderr).toBe("");
    expect(result.stdout).toContain("LLM Wiki local prototype");
    expect(result.stdout).toContain("dev capture-fixture <fixture-file>");
  });

  test("prints an unknown CLI command on stderr with usage status", async () => {
    const result = await runBun(["run", "cli.ts", "unknown"]);

    expect(result.exitCode).toBe(2);
    expect(result.stdout).toBe("");
    expect(result.stderr).toContain("Unknown command.");
    expect(result.stderr).toContain("LLM Wiki local prototype");
  });
});

async function currentBranch(): Promise<string> {
  const process = Bun.spawn(
    ["git", "-C", REPOSITORY_ROOT, "branch", "--show-current"],
    { stdout: "pipe", stderr: "pipe" },
  );
  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(process.stdout).text(),
    new Response(process.stderr).text(),
    process.exited,
  ]);

  if (exitCode !== 0 || !stdout.trim()) {
    throw new Error(`Unable to read the active Git branch: ${stderr.trim()}`);
  }

  return stdout.trim();
}

async function runBun(args: readonly string[]): Promise<{
  exitCode: number;
  stdout: string;
  stderr: string;
}> {
  const process = Bun.spawn(["bun", ...args], {
    cwd: REPOSITORY_ROOT,
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(process.stdout).text(),
    new Response(process.stderr).text(),
    process.exited,
  ]);

  return { exitCode, stdout, stderr };
}
