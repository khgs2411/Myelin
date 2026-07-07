import { describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runFileAuthoringAgent } from "../../src/runtime/file-authoring-agent.ts";

describe("runFileAuthoringAgent", () => {
  test("copies fixture outputs into allowed roots and records stub metadata", async () => {
    const root = await mkdtemp(join(tmpdir(), "myelin-agent-root-"));
    const runDir = join(root, "projects", "demo", "runs", "project-learn", "run-1");
    const fixtureDir = join(root, "fixtures", "planner");
    await mkdir(join(fixtureDir, "draft-wiki"), { recursive: true });
    await writeFile(join(fixtureDir, "draft-wiki", "index.md"), "# Demo\n", "utf8");

    const result = await runFileAuthoringAgent({
      root,
      projectKey: "demo",
      stageId: "planner",
      prompt: "write docs",
      runDir,
      targetRepoDir: root,
      workspaceDir: join(runDir, "agents", "planner"),
      outputRoots: [{ name: "draft_wiki", relativePath: "draft-wiki" }],
      provider: "codex",
      env: { FILE_AUTHORING_STUB_OUTPUTS_DIR: join(root, "fixtures") },
    });

    expect(result.status).toBe("completed");
    expect(result.provider_mode).toBe("stub");
    expect(result.discovered_outputs.map((item) => item.relative_path)).toEqual(["draft-wiki/index.md"]);
    const metadata = JSON.parse(await readFile(join(runDir, "agents", "planner", "file-authoring-agent-result.json"), "utf8"));
    expect(metadata.cwd).toBe(join(runDir, "agents", "planner"));
  });

  test("invokes codex in a run-local cwd with workspace-write sandbox", async () => {
    const commands: string[][] = [];
    const root = await mkdtemp(join(tmpdir(), "myelin-agent-root-"));
    const runDir = join(root, "projects", "demo", "runs", "project-learn", "run-2");
    const result = await runFileAuthoringAgent({
      root,
      projectKey: "demo",
      stageId: "writer",
      prompt: "write docs",
      runDir,
      targetRepoDir: root,
      workspaceDir: join(runDir, "agents", "writer"),
      outputRoots: [{ name: "subject", relativePath: "subject" }],
      provider: "codex",
      runner: async (command, options) => {
        commands.push(command);
        expect(options?.cwd).toBe(join(runDir, "agents", "writer"));
        expect(options?.stdin).toContain("write docs");
        expect(options?.stdin).toContain("target-repo");
        await writeFile(join(runDir, "agents", "writer", "subject", "topic.md"), "# Topic\n", "utf8");
        return { stdout: "done", stderr: "", exitCode: 0 };
      },
    });

    expect(result.status).toBe("completed");
    expect(commands[0]).toContain("--sandbox");
    expect(commands[0]).toContain("workspace-write");
    expect(result.discovered_outputs.map((item) => item.relative_path)).toEqual(["subject/topic.md"]);
  });

  test("fails when an output root escapes the run-local workspace", async () => {
    const root = await mkdtemp(join(tmpdir(), "myelin-agent-root-"));
    const runDir = join(root, "projects", "demo", "runs", "project-learn", "run-3");
    const result = await runFileAuthoringAgent({
      root,
      projectKey: "demo",
      stageId: "escape",
      prompt: "write docs",
      runDir,
      targetRepoDir: root,
      workspaceDir: join(runDir, "agents", "escape"),
      outputRoots: [{ name: "bad", relativePath: "../../wiki" }],
      provider: "codex",
      env: { FILE_AUTHORING_STUB_OUTPUTS_DIR: join(root, "fixtures") },
    });

    expect(result.status).toBe("failed");
    expect(result.error).toContain("outside file-authoring workspace");
  });

  test("fails when the agent writes outside allowed output roots", async () => {
    const root = await mkdtemp(join(tmpdir(), "myelin-agent-root-"));
    const runDir = join(root, "projects", "demo", "runs", "project-learn", "run-4");
    const result = await runFileAuthoringAgent({
      root,
      projectKey: "demo",
      stageId: "stray-write",
      prompt: "write docs",
      runDir,
      targetRepoDir: root,
      workspaceDir: join(runDir, "agents", "stray-write"),
      outputRoots: [{ name: "draft_wiki", relativePath: "draft-wiki" }],
      provider: "codex",
      runner: async (_command, options) => {
        await writeFile(join(String(options?.cwd), "extra.md"), "# outside\n", "utf8");
        return { stdout: "done", stderr: "", exitCode: 0 };
      },
    });

    expect(result.status).toBe("failed");
    expect(result.error).toContain("outside allowed output roots");
  });
});
