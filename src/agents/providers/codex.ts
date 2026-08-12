import type { JsonObject, ProviderExecutionInput, ProviderExecutionResult } from "../contracts.ts";
import { parseJsonishObject } from "../json-response.ts";

export async function executeCodex(input: ProviderExecutionInput): Promise<ProviderExecutionResult> {
  const command = [input.env.CODEX_BIN ?? "codex", "exec", "--skip-git-repo-check", "--sandbox", "read-only"];
  if (input.outputSchema) command.push("--output-schema", input.outputSchema);
  if (input.invocation.model) command.push("--model", input.invocation.model);
  if (input.invocation.reasoningEffort) {
    command.push("-c", `model_reasoning_effort="${input.invocation.reasoningEffort}"`);
  }
  command.push("-");

  const result = await input.runner(command, {
    cwd: input.cwd,
    stdin: input.prompt,
    env: input.env,
    timeoutMs: input.timeoutMs,
  });
  if (result.exitCode !== 0) throw new Error(`codex exited ${result.exitCode}: ${result.stderr.trim()}`);
  return { response: parseCodexResponse(result.stdout), outputChars: result.stdout.length };
}

export function parseCodexResponse(stdout: string): JsonObject {
  const text = stdout.trim();
  if (text === "") throw new Error("codex returned empty output");

  try {
    return parseJsonishObject(text);
  } catch (error) {
    throw new Error(`response is not valid JSON: ${error instanceof Error ? error.message : String(error)}`);
  }
}
