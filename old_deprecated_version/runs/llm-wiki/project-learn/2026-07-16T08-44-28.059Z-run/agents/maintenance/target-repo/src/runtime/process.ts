import type { RunProcessOptions, RunProcessResult } from "./process-contracts.ts";

export type { RunProcessOptions, RunProcessResult } from "./process-contracts.ts";

export async function runProcess(command: string[], options: RunProcessOptions = {}): Promise<RunProcessResult> {
  if (command.length === 0) throw new Error("Command must not be empty");
  const killGraceMs = normalizeKillGraceMs(options.killGraceMs);

  const proc = Bun.spawn(command, {
    cwd: options.cwd,
    env: { ...process.env, ...options.env },
    stdin: options.stdin === undefined ? "ignore" : "pipe",
    stdout: "pipe",
    stderr: "pipe",
  });
  let timedOut = false;
  let terminationStarted = false;
  let forceKill: ReturnType<typeof setTimeout> | null = null;
  const terminate = (): void => {
    if (terminationStarted) return;
    terminationStarted = true;
    try {
      proc.kill("SIGTERM");
    } catch {
      // The process may already have exited.
    }
    forceKill = setTimeout(() => {
      try {
        proc.kill("SIGKILL");
      } catch {
        // The process may have exited between the grace timer firing and kill.
      }
    }, killGraceMs);
  };
  const timeout =
    options.timeoutMs !== undefined && Number.isFinite(options.timeoutMs) && options.timeoutMs > 0
      ? setTimeout(() => {
          timedOut = true;
          terminate();
        }, options.timeoutMs)
      : null;

  let stdout: string;
  let stderr: string;
  let exitCode: number;
  try {
    if (options.stdin !== undefined) {
      const stdin = proc.stdin;
      if (!stdin) throw new Error("Process stdin pipe was not created");
      stdin.write(options.stdin);
      stdin.end();
    }

    [stdout, stderr, exitCode] = await Promise.all([
      new Response(proc.stdout).text(),
      new Response(proc.stderr).text(),
      proc.exited,
    ]);
  } catch (error) {
    terminate();
    await proc.exited.catch(() => undefined);
    throw error;
  } finally {
    if (timeout) clearTimeout(timeout);
    if (forceKill) clearTimeout(forceKill);
  }

  if (!timedOut) return { exitCode, stdout, stderr };
  const timeoutMessage = `Process timed out after ${options.timeoutMs}ms`;
  return { exitCode: 124, stdout, stderr: stderr ? `${stderr.trimEnd()}\n${timeoutMessage}` : timeoutMessage };
}

function normalizeKillGraceMs(value: number | undefined): number {
  if (value === undefined) return 1_000;
  if (!Number.isFinite(value) || value < 0) throw new Error("killGraceMs must be a non-negative finite number");
  return value;
}

export async function runProcessChecked(command: string[], options: RunProcessOptions = {}): Promise<string> {
  const result = await runProcess(command, options);
  if (result.exitCode !== 0) {
    throw new Error(`Command failed (${result.exitCode}): ${command.join(" ")}\n${result.stderr}`);
  }
  return result.stdout;
}
