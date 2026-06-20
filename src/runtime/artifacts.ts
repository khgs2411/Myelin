import { mkdir, writeFile } from "node:fs/promises";
import { projectPath, resolveInside } from "./fs.ts";

export function runsRoot(root: string, projectKey: string): string {
  return projectPath(root, projectKey, "runs");
}

export function runDir(root: string, projectKey: string, runId: string, command?: string): string {
  if (!/^[a-zA-Z0-9][a-zA-Z0-9_.:-]*$/.test(runId)) {
    throw new Error(`Invalid run id: ${runId}`);
  }
  if (!command) return resolveInside(runsRoot(root, projectKey), runId);
  assertRunCommand(command);
  return resolveInside(runsRoot(root, projectKey), command, runId);
}

export async function createRunDir(
  root: string,
  projectKey: string,
  runId = timestampRunId(),
  command?: string,
): Promise<string> {
  const dir = runDir(root, projectKey, runId, command);
  await ensureRunIndexes(root, projectKey, command);
  await mkdir(dir, { recursive: true });
  await writeFileIfMissing(
    resolveInside(dir, "index.md"),
    [
      `# ${command ?? "Run"} ${runId}`,
      "",
      `Run artifacts for \`${command ?? "command"}\`.`,
      "",
    ].join("\n"),
  );
  return dir;
}

export function timestampRunId(date = new Date()): string {
  return `${date.toISOString().replaceAll(":", "-")}-run`;
}

async function ensureRunIndexes(root: string, projectKey: string, command: string | undefined): Promise<void> {
  await mkdir(runsRoot(root, projectKey), { recursive: true });
  await writeFileIfMissing(
    resolveInside(runsRoot(root, projectKey), "index.md"),
    [
      "# Runs",
      "",
      `Command run artifacts for \`${projectKey}\`.`,
      "",
      "Command-specific run folders live under this directory.",
      "",
    ].join("\n"),
  );

  if (!command) return;

  const commandRoot = resolveInside(runsRoot(root, projectKey), command);
  await mkdir(commandRoot, { recursive: true });
  await writeFileIfMissing(
    resolveInside(commandRoot, "index.md"),
    [
      `# ${command}`,
      "",
      `Run artifacts for \`${command}\`.`,
      "",
      "Each run has its own timestamped directory with an `index.md` summary.",
      "",
    ].join("\n"),
  );
}

async function writeFileIfMissing(path: string, content: string): Promise<void> {
  try {
    await writeFile(path, content, { encoding: "utf8", flag: "wx" });
  } catch (error) {
    if (error && typeof error === "object" && "code" in error && error.code === "EEXIST") return;
    throw error;
  }
}

function assertRunCommand(command: string): void {
  if (!/^[a-zA-Z0-9][a-zA-Z0-9_.:-]*$/.test(command)) {
    throw new Error(`Invalid run command: ${command}`);
  }
}
