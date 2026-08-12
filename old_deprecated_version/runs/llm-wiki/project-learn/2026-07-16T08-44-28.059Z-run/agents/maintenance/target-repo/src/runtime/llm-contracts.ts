import type { Provider, Workload } from "./config.ts";
import type { RunProcessOptions, RunProcessResult } from "./process-contracts.ts";

export type JsonObject = Record<string, unknown>;

export type TokenUsage = {
  input_chars: number;
  output_chars: number;
  is_estimate: boolean;
};

export type LlmResult = {
  response: JsonObject;
  tokens_consumed: TokenUsage;
};

export type ProcessRunner = (command: string[], options?: RunProcessOptions) => Promise<RunProcessResult>;

export type InvokeLlmOptions = {
  root?: string;
  workload: Workload;
  stageId?: string;
  prompt: string;
  outputSchema?: string;
  provider?: Provider;
  modelOverride?: string;
  timeoutMs?: number;
  env?: NodeJS.ProcessEnv;
  cwd?: string;
  runner?: ProcessRunner;
};
