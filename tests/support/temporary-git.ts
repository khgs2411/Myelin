import { mkdir, mkdtemp, realpath, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

export class TemporaryGit {
  private constructor(public readonly root: string, public readonly environment: Record<string, string | undefined>) {}

  public static async Create(): Promise<TemporaryGit> {
    const root = await realpath(await mkdtemp(join(tmpdir(), "llm-wiki-git-test-")));
    const configHome = join(root, "config-home");
    await mkdir(configHome);
    const environment = { ...process.env };
    for (const key of Object.keys(environment)) {
      if (key.startsWith("GIT_")) delete environment[key];
    }
    Object.assign(environment, {
      GIT_CONFIG_NOSYSTEM: "1", GIT_CONFIG_GLOBAL: "/dev/null",
      GIT_TERMINAL_PROMPT: "0", XDG_CONFIG_HOME: configHome,
      GIT_AUTHOR_NAME: "Fixture", GIT_AUTHOR_EMAIL: "fixture@example.invalid",
      GIT_COMMITTER_NAME: "Fixture", GIT_COMMITTER_EMAIL: "fixture@example.invalid",
    });
    return new TemporaryGit(root, environment);
  }

  public async run(directory: string, ...arguments_: string[]): Promise<string> {
    const child = Bun.spawn(["git", "-C", directory, ...arguments_], {
      env: this.environment, stdin: "ignore", stdout: "pipe", stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([
      new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited,
    ]);
    if (exitCode !== 0) throw new Error(`Temporary Git command failed: ${stderr}`);
    return stdout.trim();
  }

  public async repository(name = "workspace"): Promise<string> {
    const directory = join(this.root, name);
    await mkdir(directory);
    await this.run(directory, "init", "--initial-branch=master", "--template=");
    return directory;
  }

  public async commit(directory: string, value: string): Promise<string> {
    await writeFile(join(directory, "tracked.txt"), value);
    await this.run(directory, "add", "tracked.txt");
    await this.run(directory, "-c", "core.hooksPath=/dev/null", "-c", "commit.gpgSign=false", "commit", "-m", value);
    return this.run(directory, "rev-parse", "HEAD");
  }

  public async close(): Promise<void> {
    await rm(this.root, { recursive: true, force: true });
  }
}
