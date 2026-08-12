import { expect, test } from "bun:test";
import type { RunProcessOptions } from "../../src/runtime/process-contracts.ts";
import { invokeSMCActionTurn } from "../../src/agents/smc-adapter.ts";
import { invokeLlm } from "../../src/agents/execute.ts";

test("Codex SMC transport remains target-cwd and read-only", async () => {
  let captured!: { command: string[]; options?: RunProcessOptions };
  const result = await invokeSMCActionTurn({
    prompt: "bounded prompt",
    maxPromptBytes: 100,
    resolvedInvocation: { provider: "codex", model: "gpt-test", reasoningEffort: "medium" },
    cwd: "/target/repo",
    runner: async (command, options) => {
      captured = { command, options };
      return { exitCode: 0, stdout: '{"action":"blocker"}', stderr: "" };
    },
  });
  expect(captured.command).toEqual([
    "codex", "exec", "--skip-git-repo-check", "--sandbox", "read-only",
    "--model", "gpt-test", "-c", 'model_reasoning_effort="medium"', "-",
  ]);
  expect(captured.options?.cwd).toBe("/target/repo");
  expect(captured.options?.stdin).toBe("bounded prompt");
  expect(result.action).toEqual({ action: "blocker" });
  expect(result.invocation).toEqual({ provider: "codex", model: "gpt-test", reasoningEffort: "medium" });
});

test("Claude transports the same one-action JSON contract without filesystem result indirection", async () => {
  let captured!: { command: string[]; options?: RunProcessOptions };
  const result = await invokeSMCActionTurn({
    prompt: "bounded prompt",
    maxPromptBytes: 100,
    resolvedInvocation: { provider: "claude", model: "claude-test" },
    cwd: "/target/repo",
    runner: async (command, options) => {
      captured = { command, options };
      return {
        exitCode: 0,
        stdout: JSON.stringify({ result: '{"action":"blocker"}' }),
        stderr: "",
      };
    },
  });
  expect(captured.command).toEqual([
    "claude", "-p", "--output-format", "json", "--permission-mode", "plan",
    "--model", "claude-test", "bounded prompt",
  ]);
  expect(captured.command.at(-1)).toBe("bounded prompt");
  expect(captured.options?.cwd).toBe("/target/repo");
  expect(result.action).toEqual({ action: "blocker" });
  expect(result.invocation).toEqual({ provider: "claude", model: "claude-test" });
});

test("generic Claude invocation does not inherit the SMC-only plan permission mode", async () => {
  let captured!: { command: string[]; options?: RunProcessOptions };
  await invokeLlm({
    workload: "pipeline",
    prompt: "generic prompt",
    resolvedInvocation: { provider: "claude", model: "claude-test" },
    cwd: "/target/repo",
    runner: async (command, options) => {
      captured = { command, options };
      return { exitCode: 0, stdout: JSON.stringify({ result: '{"ok":true}' }), stderr: "" };
    },
  });
  expect(captured.command).toEqual([
    "claude", "-p", "--output-format", "json", "--model", "claude-test", "generic prompt",
  ]);
  expect(captured.options?.cwd).toBe("/target/repo");
});

test("SMC adapter enforces exact UTF-8 provider-envelope bytes before process launch", async () => {
  let launched = false;
  await expect(invokeSMCActionTurn({
    prompt: "éé",
    maxPromptBytes: 3,
    resolvedInvocation: { provider: "codex" },
    cwd: "/target/repo",
    runner: async () => {
      launched = true;
      return { exitCode: 0, stdout: "{}", stderr: "" };
    },
  })).rejects.toThrow("requires 4 bytes");
  expect(launched).toBeFalse();
});
