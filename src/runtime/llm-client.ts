import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { loadConfig, type ModelProfile, type Provider, type Workload } from "./config.ts";
import { type RunProcessOptions, type RunProcessResult, runProcess } from "./process.ts";

export const PROMPT_SIZE_LIMIT = 200_000;
export const DEFAULT_LLM_TIMEOUT_MS = 10 * 60 * 1000;

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

export type ProcessRunner = (command: string[], options?: RunProcessOptions) => Promise<RunProcessResult>;

type ResolvedInvocation = {
  provider: Provider;
  model?: string;
  reasoningEffort?: string;
};

export async function invokeLlm(options: InvokeLlmOptions): Promise<LlmResult> {
  const root = options.root ?? process.cwd();
  const env = options.env ?? process.env;
  const stubDir = env.LLM_STUB_RESPONSES_DIR;
  if (stubDir) return readStub(stubDir, options.stageId ?? options.workload, options.prompt);

  const resolved = await resolveInvocation(root, options.workload, options.provider, options.modelOverride, env);
  if (options.prompt.length > PROMPT_SIZE_LIMIT) {
    throw new Error(`prompt too large: ${options.prompt.length} chars exceeds ${PROMPT_SIZE_LIMIT}`);
  }

  const runner = options.runner ?? runProcess;
  const timeoutMs = options.timeoutMs ?? llmTimeoutMs(env);
  const output =
    resolved.provider === "claude"
      ? await invokeClaude(resolved, options.prompt, runner, options.cwd, env, timeoutMs)
      : await invokeCodex(resolved, options.prompt, runner, options.cwd, env, options.outputSchema, timeoutMs);

  return {
    response: output.response,
    tokens_consumed: normalizeTokens({ input_chars: options.prompt.length, output_chars: output.outputChars }),
  };
}

export async function resolveInvocation(
  root: string,
  workload: Workload,
  providerOverride?: Provider,
  modelOverride?: string,
  env: NodeJS.ProcessEnv = process.env,
): Promise<ResolvedInvocation> {
  const config = await loadConfig(root, env);
  const modelSelector = modelOverride ?? env.MODEL;
  if (modelSelector) return resolveModelSelector(modelSelector, config.profiles[workload].codex?.reasoningEffort);

  const profile = config.profiles[workload][providerOverride ?? config.defaultProvider] ?? {
    provider: providerOverride ?? config.defaultProvider,
  };
  return withReasoningOverride(profile, env);
}

export function parseCodexResponse(stdout: string): JsonObject {
  const text = stdout.trim();
  if (text === "") throw new Error("codex returned empty output");

  try {
    return parseJsonishObject(text);
  } catch {
    const recovered = recoverFromReferencedFile(text);
    if (recovered) return recovered;
  }

  try {
    return parseJsonishObject(text);
  } catch (error) {
    throw new Error(`response is not valid JSON: ${error instanceof Error ? error.message : String(error)}`);
  }
}

export function parseClaudeResponse(stdout: string): JsonObject {
  const text = stdout.trim();
  if (text === "") throw new Error("claude returned empty output");

  let wrapper: unknown;
  try {
    wrapper = JSON.parse(text);
  } catch (error) {
    throw new Error(`claude wrapper is not valid JSON: ${error instanceof Error ? error.message : String(error)}`);
  }

  if (!isRecord(wrapper)) throw new Error("claude wrapper is not a JSON object");
  const inner = wrapper.result ?? wrapper.final_message;
  if (typeof inner !== "string" || inner.trim() === "") {
    throw new Error("claude wrapper missing result/final_message");
  }
  try {
    return parseJsonishObject(inner);
  } catch (error) {
    throw new Error(`response is not valid JSON: ${error instanceof Error ? error.message : String(error)}`);
  }
}

function resolveModelSelector(selector: string, defaultReasoningEffort?: string): ResolvedInvocation {
  if (selector === "claude") return { provider: "claude" };
  if (selector.startsWith("claude/")) return { provider: "claude", model: selector.slice("claude/".length) };
  if (selector === "codex") return { provider: "codex", reasoningEffort: defaultReasoningEffort };
  if (selector.startsWith("codex/")) {
    return { provider: "codex", model: selector.slice("codex/".length), reasoningEffort: defaultReasoningEffort };
  }
  return { provider: "codex", model: selector, reasoningEffort: defaultReasoningEffort };
}

function withReasoningOverride(profile: ModelProfile, env: NodeJS.ProcessEnv): ResolvedInvocation {
  return {
    provider: profile.provider,
    model: profile.model,
    reasoningEffort: profile.provider === "codex" ? (env.MODEL_REASONING_EFFORT ?? profile.reasoningEffort) : undefined,
  };
}

async function invokeCodex(
  resolved: ResolvedInvocation,
  prompt: string,
  runner: ProcessRunner,
  cwd: string | undefined,
  env: NodeJS.ProcessEnv,
  outputSchema: string | undefined,
  timeoutMs: number,
): Promise<{ response: JsonObject; outputChars: number }> {
  const command = [env.CODEX_BIN ?? "codex", "exec", "--skip-git-repo-check", "--sandbox", "read-only"];
  if (outputSchema) command.push("--output-schema", outputSchema);
  if (resolved.model) command.push("--model", resolved.model);
  if (resolved.reasoningEffort) command.push("-c", `model_reasoning_effort="${resolved.reasoningEffort}"`);
  command.push("-");

  const result = await runner(command, { cwd, stdin: prompt, env, timeoutMs });
  if (result.exitCode !== 0) throw new Error(`codex exited ${result.exitCode}: ${result.stderr.trim()}`);
  return { response: parseCodexResponse(result.stdout), outputChars: result.stdout.length };
}

async function invokeClaude(
  resolved: ResolvedInvocation,
  prompt: string,
  runner: ProcessRunner,
  cwd: string | undefined,
  env: NodeJS.ProcessEnv,
  timeoutMs: number,
): Promise<{ response: JsonObject; outputChars: number }> {
  const command = [env.CLAUDE_BIN ?? "claude", "-p", "--output-format", "json"];
  if (resolved.model) command.push("--model", resolved.model);
  command.push(prompt);

  const result = await runner(command, { cwd, env, timeoutMs });
  if (result.exitCode !== 0) throw new Error(`claude exited ${result.exitCode}: ${result.stderr.trim()}`);
  return { response: parseClaudeResponse(result.stdout), outputChars: result.stdout.length };
}

function llmTimeoutMs(env: NodeJS.ProcessEnv): number {
  const value = env.LLM_TIMEOUT_MS;
  if (value === undefined || value === "") return DEFAULT_LLM_TIMEOUT_MS;
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) return DEFAULT_LLM_TIMEOUT_MS;
  return parsed;
}

async function readStub(stubDir: string, stubKey: string, prompt: string): Promise<LlmResult> {
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
  };
}

function normalizeTokens(raw: Record<string, unknown>): TokenUsage {
  return {
    input_chars: Number(raw.input_chars ?? raw.input ?? 0),
    output_chars: Number(raw.output_chars ?? raw.output ?? 0),
    is_estimate: typeof raw.is_estimate === "boolean" ? raw.is_estimate : true,
  };
}

function parseJsonishObject(text: string): JsonObject {
  const direct = tryParseObject(text);
  if (direct) return direct;

  for (const match of text.matchAll(/```(?:json)?\s*([\s\S]*?)\s*```/gi)) {
    const parsed = tryParseObject(match[1] ?? "");
    if (parsed) return parsed;
  }

  for (const candidate of iterBalancedJsonCandidates(text)) {
    const parsed = tryParseObject(candidate);
    if (parsed) return parsed;
  }

  JSON.parse(text);
  throw new Error("JSON payload is not an object");
}

function tryParseObject(text: string): JsonObject | null {
  try {
    const parsed = JSON.parse(text);
    return isRecord(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function recoverFromReferencedFile(text: string): JsonObject | null {
  const seen = new Set<string>();
  for (const match of text.matchAll(/\((\/[^)\s]+?\.json)(?:\s+"[^"]*")?\)/g)) {
    const path = match[1];
    if (!path || seen.has(path) || !existsSync(path)) continue;
    seen.add(path);
    try {
      const parsed = JSON.parse(readFileSync(path, "utf8"));
      if (isRecord(parsed)) return parsed;
    } catch {
      continue;
    }
  }
  return null;
}

function* iterBalancedJsonCandidates(text: string): Generator<string> {
  for (let index = 0; index < text.length; index += 1) {
    if (text[index] !== "{" && text[index] !== "[") continue;
    const candidate = extractBalancedJsonValue(text, index);
    if (candidate) yield candidate;
  }
}

function extractBalancedJsonValue(text: string, start: number): string | null {
  const stack: string[] = [];
  let inString = false;
  let escape = false;

  for (let index = start; index < text.length; index += 1) {
    const char = text[index];
    if (inString) {
      if (escape) escape = false;
      else if (char === "\\") escape = true;
      else if (char === "\"") inString = false;
      continue;
    }

    if (char === "\"") {
      inString = true;
    } else if (char === "{" || char === "[") {
      stack.push(char);
    } else if (char === "}" || char === "]") {
      const opener = stack.pop();
      if ((opener === "{" && char !== "}") || (opener === "[" && char !== "]")) return null;
      if (stack.length === 0) return text.slice(start, index + 1);
    }
  }

  return null;
}

function sha256(text: string): string {
  return createHash("sha256").update(text, "utf8").digest("hex");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
