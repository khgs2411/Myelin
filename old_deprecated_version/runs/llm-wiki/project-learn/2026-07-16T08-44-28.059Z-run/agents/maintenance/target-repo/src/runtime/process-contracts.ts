export type RunProcessOptions = {
  cwd?: string;
  env?: Record<string, string | undefined>;
  stdin?: string;
  timeoutMs?: number;
  killGraceMs?: number;
};

export type RunProcessResult = {
  exitCode: number;
  stdout: string;
  stderr: string;
};
