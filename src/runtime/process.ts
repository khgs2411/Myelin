export type RunProcessOptions = {
  cwd?: string;
  env?: Record<string, string | undefined>;
  stdin?: string;
  timeoutMs?: number;
};

export type RunProcessResult = {
  exitCode: number;
  stdout: string;
  stderr: string;
};

export async function runProcess(command: string[], options: RunProcessOptions = {}): Promise<RunProcessResult> {
  if (command.length === 0) throw new Error("Command must not be empty");

  const proc = Bun.spawn(command, {
    cwd: options.cwd,
    env: { ...process.env, ...options.env },
    stdin: options.stdin === undefined ? "ignore" : "pipe",
    stdout: "pipe",
    stderr: "pipe",
  });
  let timedOut = false;
  const timeout =
    options.timeoutMs !== undefined && Number.isFinite(options.timeoutMs) && options.timeoutMs > 0
      ? setTimeout(() => {
          timedOut = true;
          proc.kill();
        }, options.timeoutMs)
      : null;

  if (options.stdin !== undefined) {
    const stdin = proc.stdin;
    if (!stdin) throw new Error("Process stdin pipe was not created");
    stdin.write(options.stdin);
    stdin.end();
  }

  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);
  if (timeout) clearTimeout(timeout);

  if (!timedOut) return { exitCode, stdout, stderr };
  const timeoutMessage = `Process timed out after ${options.timeoutMs}ms`;
  return { exitCode: 124, stdout, stderr: stderr ? `${stderr.trimEnd()}\n${timeoutMessage}` : timeoutMessage };
}

export async function runProcessChecked(command: string[], options: RunProcessOptions = {}): Promise<string> {
  const result = await runProcess(command, options);
  if (result.exitCode !== 0) {
    throw new Error(`Command failed (${result.exitCode}): ${command.join(" ")}\n${result.stderr}`);
  }
  return result.stdout;
}
