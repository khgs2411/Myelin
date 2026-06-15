import { afterEach, beforeEach, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  invokeLlm,
  parseClaudeResponse,
  parseCodexResponse,
  resolveInvocation,
  type ProcessRunner,
} from "./llm-client.ts";
import type { RunProcessOptions, RunProcessResult } from "./process.ts";

let root: string;

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "myelin-llm-client-"));
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

test("stub mode returns canned responses and verifies prompt hashes", async () => {
  const stubDir = join(root, "stubs");
  const prompt = "classify this source";
  await mkdir(stubDir, { recursive: true });
  await writeFile(
    join(stubDir, "03-propose.json"),
    JSON.stringify({
      prompt_hash: sha256(prompt),
      response: { source_kind: "spec" },
      tokens_consumed: { input: 10, output: 2 },
    }),
    "utf8",
  );

  const result = await invokeLlm({
    root,
    workload: "pipeline",
    stageId: "03-propose",
    prompt,
    env: { LLM_STUB_RESPONSES_DIR: stubDir },
  });

  expect(result.response).toEqual({ source_kind: "spec" });
  expect(result.tokens_consumed).toEqual({ input_chars: 10, output_chars: 2, is_estimate: true });
  await expect(
    invokeLlm({
      root,
      workload: "pipeline",
      stageId: "03-propose",
      prompt: "different",
      env: { LLM_STUB_RESPONSES_DIR: stubDir },
    }),
  ).rejects.toThrow("prompt_hash mismatch");
});

test("codex dispatch uses read-only sandbox, profile model, and reasoning effort", async () => {
  await writeFile(
    join(root, "myelin.config"),
    ["DEFAULT_PROVIDER=codex", "PIPELINE_CODEX_MODEL=gpt-pipeline", "PIPELINE_CODEX_REASONING_EFFORT=high"].join("\n"),
    "utf8",
  );
  const captured: Captured = {};
  const result = await invokeLlm({
    root,
    workload: "pipeline",
    prompt: "runtime prompt",
    env: {},
    runner: captureRunner(captured, '{"ok": true}'),
  });

  expect(result.response).toEqual({ ok: true });
  expect(captured.command).toEqual([
    "codex",
    "exec",
    "--skip-git-repo-check",
    "--sandbox",
    "read-only",
    "--model",
    "gpt-pipeline",
    "-c",
    'model_reasoning_effort="high"',
    "-",
  ]);
  expect(captured.options?.stdin).toBe("runtime prompt");
});

test("codex dispatch can request structured output with a JSON schema", async () => {
  await writeFile(join(root, "myelin.config"), "DEFAULT_PROVIDER=codex\nPIPELINE_CODEX_MODEL=gpt-pipeline", "utf8");
  const captured: Captured = {};
  const result = await invokeLlm({
    root,
    workload: "pipeline",
    prompt: "runtime prompt",
    outputSchema: "/tmp/schema.json",
    env: {},
    runner: captureRunner(captured, '{"ok": true}'),
  });

  expect(result.response).toEqual({ ok: true });
  expect(captured.command).toContain("--output-schema");
  expect(captured.command).toContain("/tmp/schema.json");
});

test("claude dispatch uses default provider profile and parses result wrappers", async () => {
  await writeFile(
    join(root, "myelin.config"),
    ["DEFAULT_PROVIDER=claude", "QUERY_CLAUDE_MODEL=haiku-test"].join("\n"),
    "utf8",
  );
  const captured: Captured = {};
  const result = await invokeLlm({
    root,
    workload: "query",
    prompt: "answer the question",
    env: {},
    runner: captureRunner(captured, JSON.stringify({ result: '{"answer": "yes"}' })),
  });

  expect(result.response).toEqual({ answer: "yes" });
  expect(captured.command).toEqual(["claude", "-p", "--output-format", "json", "--model", "haiku-test", "answer the question"]);
  expect(captured.options?.stdin).toBeUndefined();
});

test("MODEL and per-call provider overrides control profile resolution", async () => {
  await writeFile(
    join(root, "myelin.config"),
    [
      "DEFAULT_PROVIDER=codex",
      "QUERY_CODEX_MODEL=gpt-query",
      "QUERY_CODEX_REASONING_EFFORT=medium",
      "QUERY_CLAUDE_MODEL=haiku-query",
    ].join("\n"),
    "utf8",
  );

  await expect(resolveInvocation(root, "query", "claude", undefined, {})).resolves.toEqual({
    provider: "claude",
    model: "haiku-query",
  });
  await expect(resolveInvocation(root, "query", undefined, undefined, { MODEL: "claude/sonnet-override" })).resolves.toEqual({
    provider: "claude",
    model: "sonnet-override",
  });
  await expect(resolveInvocation(root, "query", undefined, "legacy-model", {})).resolves.toEqual({
    provider: "codex",
    model: "legacy-model",
    reasoningEffort: "medium",
  });
});

test("JSON recovery handles fenced output, prose-wrapped JSON, file references, and claude final_message", async () => {
  expect(parseCodexResponse('```json\n{"findings":[]}\n```')).toEqual({ findings: [] });
  expect(parseCodexResponse('Wrote [x](/tmp/x.json).\n{"approved":false,"units":[]}')).toEqual({
    approved: false,
    units: [],
  });

  const referenced = join(root, "recovered.json");
  await writeFile(referenced, '{"from_file":true}', "utf8");
  expect(parseCodexResponse(`Wrote [recovered.json](${referenced}).`)).toEqual({ from_file: true });
  expect(parseClaudeResponse(JSON.stringify({ final_message: '{"ok":1}' }))).toEqual({ ok: 1 });
});

type Captured = {
  command?: string[];
  options?: RunProcessOptions;
};

function captureRunner(captured: Captured, stdout: string): ProcessRunner {
  return async (command: string[], options?: RunProcessOptions): Promise<RunProcessResult> => {
    captured.command = command;
    captured.options = options;
    return { exitCode: 0, stdout, stderr: "" };
  };
}

function sha256(text: string): string {
  return createHash("sha256").update(text, "utf8").digest("hex");
}
