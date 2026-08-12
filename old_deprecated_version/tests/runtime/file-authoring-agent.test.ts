import { describe, expect, test } from "bun:test";
import { access, mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runFileAuthoringAgent } from "../../src/runtime/file-authoring-agent.ts";
import { runProcess } from "../../src/runtime/process.ts";

describe("runFileAuthoringAgent", () => {
  test("copies fixture outputs into allowed roots and records stub metadata", async () => {
    const root = await mkdtemp(join(tmpdir(), "myelin-agent-root-"));
    const runDir = join(root, "runs", "demo", "project-learn", "run-1");
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
    const runDir = join(root, "runs", "demo", "project-learn", "run-2");
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

  test("prevents target snapshot git discovery from escaping into the parent repository", async () => {
    const root = await mkdtemp(join(tmpdir(), "myelin-agent-git-ceiling-"));
    expect((await runProcess(["git", "init"], { cwd: root })).exitCode).toBe(0);
    const targetRepoDir = join(root, "source");
    const runDir = join(root, "runs", "demo", "project-learn", "run-git-ceiling");
    const workspaceDir = join(runDir, "agents", "writer");
    await mkdir(targetRepoDir, { recursive: true });
    await writeFile(join(targetRepoDir, "README.md"), "# Demo\n", "utf8");

    const result = await runFileAuthoringAgent({
      root,
      projectKey: "demo",
      stageId: "git-ceiling",
      prompt: "write docs",
      runDir,
      targetRepoDir,
      workspaceDir,
      outputRoots: [{ name: "subject", relativePath: "subject" }],
      provider: "codex",
      runner: async (_command, options) => {
        const discovery = await runProcess(
          ["git", "rev-parse", "--show-toplevel"],
          { cwd: join(workspaceDir, "target-repo"), env: options?.env },
        );
        expect(discovery.exitCode).not.toBe(0);
        await writeFile(join(workspaceDir, "subject", "topic.md"), "# Topic\n", "utf8");
        return { stdout: "done", stderr: "", exitCode: 0 };
      },
    });

    expect(result.status).toBe("completed");
  });

  test("excludes sensitive and generated paths at every repository depth", async () => {
    const root = await mkdtemp(join(tmpdir(), "myelin-agent-root-"));
    const targetRepoDir = await mkdtemp(join(tmpdir(), "myelin-target-repo-"));
    const runDir = join(root, "runs", "demo", "project-learn", "run-nested");
    const workspaceDir = join(runDir, "agents", "writer");
    const files = [
      ["README.md", "# Demo\n"],
      ["apps/api/src/index.ts", "export const api = true;\n"],
      ["apps/api/.env.example", "API_URL=http://localhost\n"],
      ["apps/api/.env", "secret\n"],
      ["apps/web/.env.local", "secret\n"],
      ["apps/api/.git/config", "private remote\n"],
      ["apps/web/.codex/settings.json", "{}\n"],
      ["apps/web/.agents/context.md", "private\n"],
      ["apps/web/.tmp/cache", "generated\n"],
      ["apps/web/node_modules/package/index.js", "generated\n"],
      ["apps/web/state/memory/memory.db", "generated\n"],
    ] as const;
    for (const [relativePath, contents] of files) {
      const path = join(targetRepoDir, relativePath);
      await mkdir(join(path, ".."), { recursive: true });
      await writeFile(path, contents, "utf8");
    }

    const result = await runFileAuthoringAgent({
      root,
      projectKey: "demo",
      stageId: "nested-snapshot",
      prompt: "write docs",
      runDir,
      targetRepoDir,
      workspaceDir,
      outputRoots: [{ name: "subject", relativePath: "subject" }],
      provider: "codex",
      runner: async (_command, options) => {
        const snapshot = join(String(options?.cwd), "target-repo");
        expect(await readFile(join(snapshot, "README.md"), "utf8")).toBe("# Demo\n");
        expect(await readFile(join(snapshot, "apps/api/src/index.ts"), "utf8")).toContain("api = true");
        expect(await readFile(join(snapshot, "apps/api/.env.example"), "utf8")).toContain("API_URL");
        for (const excluded of files.slice(3).map(([relativePath]) => relativePath)) {
          await expect(access(join(snapshot, excluded))).rejects.toThrow();
        }
        await writeFile(join(String(options?.cwd), "subject", "topic.md"), "# Topic\n", "utf8");
        return { stdout: "done", stderr: "", exitCode: 0 };
      },
    });

    expect(result.status).toBe("completed");
    await expect(access(join(workspaceDir, "target-repo"))).rejects.toThrow();
  });

  test("fails when an output root escapes the run-local workspace", async () => {
    const root = await mkdtemp(join(tmpdir(), "myelin-agent-root-"));
    const runDir = join(root, "runs", "demo", "project-learn", "run-3");
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
    const runDir = join(root, "runs", "demo", "project-learn", "run-4");
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
    await expect(access(join(runDir, "agents", "stray-write", "target-repo"))).rejects.toThrow();
  });
});
