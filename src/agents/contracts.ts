import type { Provider, Workload } from "../runtime/config.ts";
import type { RunProcessOptions, RunProcessResult } from "../runtime/process-contracts.ts";

export type JsonObject = Record<string, unknown>;

export type TokenUsage = {
  input_chars: number;
  output_chars: number;
  is_estimate: boolean;
};

export type ResolvedLlmInvocation = {
  provider: Provider;
  model?: string;
  reasoningEffort?: string;
};

export type LlmResult = {
  response: JsonObject;
  tokens_consumed: TokenUsage;
  invocation: ResolvedLlmInvocation;
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
  resolvedInvocation?: ResolvedLlmInvocation;
  timeoutMs?: number;
  env?: NodeJS.ProcessEnv;
  cwd?: string;
  runner?: ProcessRunner;
};

export type SMCTurnRequest = {
  root?: string;
  stageId?: string;
  prompt: string;
  maxPromptBytes: number;
  resolvedInvocation: ResolvedLlmInvocation;
  timeoutMs?: number;
  env?: NodeJS.ProcessEnv;
  cwd: string;
  runner?: ProcessRunner;
};

export type SMCTurnResult = {
  action: JsonObject;
  tokens_consumed: TokenUsage;
  invocation: ResolvedLlmInvocation;
};

export type ProviderExecutionInput = {
  invocation: ResolvedLlmInvocation;
  prompt: string;
  outputSchema?: string;
  runner: ProcessRunner;
  cwd?: string;
  env: NodeJS.ProcessEnv;
  timeoutMs: number;
  claudePermissionMode?: "plan";
};

export type ProviderExecutionResult = {
  response: JsonObject;
  outputChars: number;
};
