import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { loadConfig, type ModelProfile, type Provider, type Workload } from "../runtime/config.ts";
import { runProcess } from "../runtime/process.ts";
import type {
  InvokeLlmOptions,
  LlmResult,
  ResolvedLlmInvocation,
  SMCTurnRequest,
  SMCTurnResult,
  TokenUsage,
} from "./contracts.ts";
import { isRecord } from "./json-response.ts";
import { executeClaude } from "./providers/claude.ts";
import { executeCodex } from "./providers/codex.ts";

export const PROMPT_SIZE_LIMIT = 200_000;
export const DEFAULT_LLM_TIMEOUT_MS = 10 * 60 * 1000;

export async function invokeLlm(options: InvokeLlmOptions): Promise<LlmResult> {
  const root = options.root ?? process.cwd();
  const env = options.env ?? process.env;
  const invocation = options.resolvedInvocation
    ?? await resolveInvocation(root, options.workload, options.provider, options.modelOverride, env);
  const stubDir = env.LLM_STUB_RESPONSES_DIR;
  if (stubDir) return readStub(stubDir, options.stageId ?? options.workload, options.prompt, invocation);

  if (options.prompt.length > PROMPT_SIZE_LIMIT) {
    throw new Error(`prompt too large: ${options.prompt.length} chars exceeds ${PROMPT_SIZE_LIMIT}`);
  }

  const providerInput = {
    invocation,
    prompt: options.prompt,
    outputSchema: options.outputSchema,
    runner: options.runner ?? runProcess,
    cwd: options.cwd,
    env,
    timeoutMs: options.timeoutMs ?? llmTimeoutMs(env),
  };
  const output = invocation.provider === "claude"
    ? await executeClaude(providerInput)
    : await executeCodex(providerInput);

  return {
    response: output.response,
    tokens_consumed: normalizeTokens({ input_chars: options.prompt.length, output_chars: output.outputChars }),
    invocation,
  };
}

export async function invokeSMCTurn(options: SMCTurnRequest): Promise<SMCTurnResult> {
  const env = options.env ?? process.env;
  const encodedBytes = Buffer.byteLength(options.prompt, "utf8");
  if (!Number.isSafeInteger(options.maxPromptBytes) || options.maxPromptBytes <= 0) {
    throw new Error("SMC maxPromptBytes must be a positive safe integer");
  }
  if (encodedBytes > options.maxPromptBytes) {
    throw new Error(`SMC provider envelope requires ${encodedBytes} bytes, limit is ${options.maxPromptBytes}`);
  }
  const stubDir = env.LLM_STUB_RESPONSES_DIR;
  if (stubDir) {
    const stub = await readStub(
      stubDir,
      options.stageId ?? "smc-turn",
      options.prompt,
      options.resolvedInvocation,
    );
    return {
      action: stub.response,
      tokens_consumed: stub.tokens_consumed,
      invocation: stub.invocation,
    };
  }
  const input = {
    invocation: options.resolvedInvocation,
    prompt: options.prompt,
    runner: options.runner ?? runProcess,
    cwd: options.cwd,
    env,
    timeoutMs: options.timeoutMs ?? llmTimeoutMs(env),
    ...(options.resolvedInvocation.provider === "claude" ? { claudePermissionMode: "plan" as const } : {}),
  };
  const output = options.resolvedInvocation.provider === "codex"
    ? await executeCodex(input)
    : options.resolvedInvocation.provider === "claude"
      ? await executeClaude(input)
      : assertNever(options.resolvedInvocation.provider);
  return {
    action: output.response,
    tokens_consumed: normalizeTokens({ input_chars: options.prompt.length, output_chars: output.outputChars }),
    invocation: options.resolvedInvocation,
  };
}

export async function resolveInvocation(
  root: string,
  workload: Workload,
  providerOverride?: Provider,
  modelOverride?: string,
  env: NodeJS.ProcessEnv = process.env,
): Promise<ResolvedLlmInvocation> {
  const config = await loadConfig(root, env);
  const selectedProvider = providerOverride ?? config.defaultProvider;
  const selector = modelOverride ?? env.MODEL;
  if (selector) {
    const resolved = resolveModelSelector(selector, providerOverride, selectedProvider);
    const profile = config.profiles[workload][resolved.provider] ?? { provider: resolved.provider };
    return withReasoningOverride({ ...profile, model: resolved.model }, env);
  }

  const profile = config.profiles[workload][selectedProvider] ?? { provider: selectedProvider };
  return withReasoningOverride(profile, env);
}

function resolveModelSelector(
  selector: string,
  explicitProvider: Provider | undefined,
  selectedProvider: Provider,
): Pick<ResolvedLlmInvocation, "provider" | "model"> {
  const parsed = parseModelSelector(selector, explicitProvider ?? selectedProvider, explicitProvider !== undefined);
  if (explicitProvider && parsed.provider !== explicitProvider) {
    throw new Error(
      `model selector ${JSON.stringify(selector)} requests ${parsed.provider}, but invocation provider is fixed to ${explicitProvider}`,
    );
  }
  return parsed;
}

function parseModelSelector(
  selector: string,
  fallbackProvider: Provider,
  providerIsFixed: boolean,
): Pick<ResolvedLlmInvocation, "provider" | "model"> {
  if (selector === "claude") return { provider: "claude" };
  if (selector.startsWith("claude/")) return { provider: "claude", model: selector.slice("claude/".length) };
  if (selector === "codex") return { provider: "codex" };
  if (selector.startsWith("codex/")) return { provider: "codex", model: selector.slice("codex/".length) };
  return { provider: providerIsFixed ? fallbackProvider : "codex", model: selector };
}

function withReasoningOverride(profile: ModelProfile, env: NodeJS.ProcessEnv): ResolvedLlmInvocation {
  return {
    provider: profile.provider,
    model: profile.model,
    reasoningEffort: profile.provider === "codex" ? (env.MODEL_REASONING_EFFORT ?? profile.reasoningEffort) : undefined,
  };
}

function llmTimeoutMs(env: NodeJS.ProcessEnv): number {
  const value = env.LLM_TIMEOUT_MS;
  if (value === undefined || value === "") return DEFAULT_LLM_TIMEOUT_MS;
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) return DEFAULT_LLM_TIMEOUT_MS;
  return parsed;
}

async function readStub(
  stubDir: string,
  stubKey: string,
  prompt: string,
  invocation: ResolvedLlmInvocation,
): Promise<LlmResult> {
  const stubPath = join(stubDir, `${stubKey}.json`);
  if (!existsSync(stubPath)) throw new Error(`stub not found: ${stubPath}`);
  const data = JSON.parse(await readFile(stubPath, "utf8")) as unknown;
  if (!isRecord(data) || !isRecord(data.response)) throw new Error(`stub is missing response object: ${stubPath}`);

  if (typeof data.prompt_hash === "string") {
    const actual = sha256(prompt);
    if (actual !== data.prompt_hash) {
      throw new Error(`prompt_hash mismatch for ${stubKey}: stub expects ${data.prompt_hash}, got ${actual}`);
    }
  }

  return {
    response: data.response,
    tokens_consumed: normalizeTokens(isRecord(data.tokens_consumed) ? data.tokens_consumed : {}),
    invocation,
  };
}

function normalizeTokens(raw: Record<string, unknown>): TokenUsage {
  return {
    input_chars: Number(raw.input_chars ?? raw.input ?? 0),
    output_chars: Number(raw.output_chars ?? raw.output ?? 0),
    is_estimate: typeof raw.is_estimate === "boolean" ? raw.is_estimate : true,
  };
}

function sha256(text: string): string {
  return createHash("sha256").update(text, "utf8").digest("hex");
}

function assertNever(value: never): never {
  throw new Error(`Unsupported provider: ${String(value)}`);
}
