import type { JsonObject, ProviderExecutionInput, ProviderExecutionResult } from "../contracts.ts";
import { isRecord, parseJsonishObject } from "../json-response.ts";

export async function executeClaude(input: ProviderExecutionInput): Promise<ProviderExecutionResult> {
  const command = [input.env.CLAUDE_BIN ?? "claude", "-p", "--output-format", "json"];
  if (input.claudePermissionMode) command.push("--permission-mode", input.claudePermissionMode);
  if (input.invocation.model) command.push("--model", input.invocation.model);
  command.push(input.prompt);

  const result = await input.runner(command, {
    cwd: input.cwd,
    env: input.env,
    timeoutMs: input.timeoutMs,
  });
  if (result.exitCode !== 0) throw new Error(`claude exited ${result.exitCode}: ${result.stderr.trim()}`);
  return { response: parseClaudeResponse(result.stdout), outputChars: result.stdout.length };
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
