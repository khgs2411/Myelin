# Chunk 03: Ingest Runtime Profile

**Plan Set:** `../plan.md`
**Spec:** `../spec.md`
**Status:** Ready For Implementation
**Depends on:** None
**Enables:** `04-ingest-status-readback.md`, `05-docs-validation-and-retest.md`

## Goal

Define and wire a named ingest runtime profile in `myelin.config` and `src/runtime/config.ts` so live ingest controls are not hidden as broad pipeline defaults. The profile owns batch size, worker concurrency, startup delay, provider timeout, prompt budget, model, and reasoning effort, while environment overrides remain available for local debugging or emergency runs.

## Source Artifacts

- `../spec.md`: Runtime Safety Envelope; Planning Boundary Guidance.
- `../agenda.md`: Question 3.
- `src/runtime/config.ts`, `src/runtime/runtime.test.ts`, `src/runtime/llm-client.ts`, `src/commands/ingest.ts`, `src/ingest/worker.ts`, `myelin.config`.

## Relationships

- **Depends on:** None.
- **Enables:** status/readback can report profile-derived values; docs/retest can use documented knobs.
- **Shared contracts:** `MyelinConfig.ingest`, `INGEST_*` config keys, `LLM_TIMEOUT_MS` env override.
- **Integration points:** command start batching, worker prompt size, LLM invocation timeout/model/reasoning selection.

## File Responsibility Map

**Modify:**
- `src/runtime/config.ts` - expand `IngestConfig` and parse named ingest profile values.
- `src/runtime/llm-client.ts` - allow ingest-specific timeout and model profile selection without broad pipeline coupling.
- `src/commands/ingest.ts` - use config concurrency/start delay/batch defaults.
- `src/ingest/worker.ts` - use ingest prompt budget config where passed.
- `myelin.config` - document stable ingest profile keys.

**Test:**
- `src/runtime/runtime.test.ts` - config parsing and env precedence.
- `src/runtime/llm-client.test.ts` - timeout/model profile behavior.
- `src/commands/ingest.test.ts` - concurrency/start delay behavior.

## Implementation Tasks

### Task 1: Expand ingest config parsing

**Files:**
- Modify: `src/runtime/config.ts`
- Modify: `src/runtime/runtime.test.ts`

- [ ] **Step 1: Add config tests**

Append to `src/runtime/runtime.test.ts`:

```ts
test("loadConfig parses named ingest runtime profile", async () => {
  await writeFile(
    join(root, "myelin.config"),
    [
      "DEFAULT_PROVIDER=codex",
      "INGEST_BATCH_SIZE=25",
      "INGEST_WORKER_CONCURRENCY=2",
      "INGEST_WORKER_START_DELAY_MS=500",
      "INGEST_LLM_TIMEOUT_MS=120000",
      "INGEST_PROMPT_CHAR_LIMIT=150000",
      "INGEST_CODEX_MODEL=gpt-ingest",
      "INGEST_CODEX_REASONING_EFFORT=medium",
    ].join("\n"),
    "utf8",
  );

  await expect(loadConfig(root, {})).resolves.toMatchObject({
    ingest: {
      batchSize: 25,
      workerConcurrency: 2,
      workerStartDelayMs: 500,
      llmTimeoutMs: 120000,
      promptCharLimit: 150000,
      profiles: {
        codex: { provider: "codex", model: "gpt-ingest", reasoningEffort: "medium" },
      },
    },
  });
});

test("loadConfig validates ingest runtime profile bounds", async () => {
  await expect(loadConfig(root, { INGEST_WORKER_CONCURRENCY: "0" })).rejects.toThrow("Invalid ingest worker concurrency");
  await expect(loadConfig(root, { INGEST_WORKER_START_DELAY_MS: "-1" })).rejects.toThrow("Invalid ingest worker start delay");
  await expect(loadConfig(root, { INGEST_LLM_TIMEOUT_MS: "0" })).rejects.toThrow("Invalid ingest LLM timeout");
  await expect(loadConfig(root, { INGEST_PROMPT_CHAR_LIMIT: "not-a-number" })).rejects.toThrow("Invalid ingest prompt char limit");
});
```

- [ ] **Step 2: Update `Workload` and config types**

In `src/runtime/config.ts`:

```ts
export type Workload = "pipeline" | "query" | "ingest";

export type IngestConfig = {
  batchSize: number;
  workerConcurrency: number;
  workerStartDelayMs: number;
  llmTimeoutMs: number;
  promptCharLimit: number;
  profiles: Partial<Record<Provider, ModelProfile>>;
};
```

Add constants:

```ts
export const DEFAULT_INGEST_WORKER_CONCURRENCY = 1;
export const MAX_INGEST_WORKER_CONCURRENCY = 16;
export const DEFAULT_INGEST_WORKER_START_DELAY_MS = 750;
export const DEFAULT_INGEST_LLM_TIMEOUT_MS = 10 * 60 * 1000;
export const DEFAULT_INGEST_PROMPT_CHAR_LIMIT = 180_000;
```

- [ ] **Step 3: Parse ingest keys**

```ts
function ingestConfig(values: Record<string, string>): IngestConfig {
  return {
    batchSize: parseIngestBatchSize(values.INGEST_BATCH_SIZE ?? String(DEFAULT_INGEST_BATCH_SIZE)),
    workerConcurrency: parsePositiveInteger(
      values.INGEST_WORKER_CONCURRENCY ?? String(DEFAULT_INGEST_WORKER_CONCURRENCY),
      "Invalid ingest worker concurrency",
      MAX_INGEST_WORKER_CONCURRENCY,
    ),
    workerStartDelayMs: parseNonNegativeInteger(
      values.INGEST_WORKER_START_DELAY_MS ?? String(DEFAULT_INGEST_WORKER_START_DELAY_MS),
      "Invalid ingest worker start delay",
    ),
    llmTimeoutMs: parsePositiveInteger(
      values.INGEST_LLM_TIMEOUT_MS ?? String(DEFAULT_INGEST_LLM_TIMEOUT_MS),
      "Invalid ingest LLM timeout",
    ),
    promptCharLimit: parsePositiveInteger(
      values.INGEST_PROMPT_CHAR_LIMIT ?? String(DEFAULT_INGEST_PROMPT_CHAR_LIMIT),
      "Invalid ingest prompt char limit",
    ),
    profiles: {
      codex: profile("ingest", "codex", values),
      claude: profile("ingest", "claude", values),
    },
  };
}

function parsePositiveInteger(value: string, label: string, max?: number): number {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0 || (max !== undefined && parsed > max)) {
    throw new Error(`${label}: ${value}`);
  }
  return parsed;
}

function parseNonNegativeInteger(value: string, label: string): number {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 0) throw new Error(`${label}: ${value}`);
  return parsed;
}
```

Add `ingest` profiles to `DEFAULT_CONFIG.profiles`.

### Task 2: Use ingest workload for provider invocation

**Files:**
- Modify: `src/ingest/worker.ts`
- Modify: `src/runtime/llm-client.ts`
- Modify: `src/runtime/llm-client.test.ts`

- [ ] **Step 1: Add optional timeout override to LLM invocation**

In `InvokeLlmOptions`:

```ts
timeoutMs?: number;
```

In `invokeLlm`:

```ts
const timeoutMs = options.timeoutMs ?? llmTimeoutMs(env);
```

- [ ] **Step 2: Add test for ingest profile selection**

```ts
test("ingest dispatch uses ingest model profile and explicit timeout", async () => {
  await writeFile(
    join(root, "myelin.config"),
    "DEFAULT_PROVIDER=codex\nINGEST_CODEX_MODEL=gpt-ingest\nINGEST_CODEX_REASONING_EFFORT=medium\n",
    "utf8",
  );
  const captured: Captured = {};
  await invokeLlm({
    root,
    workload: "ingest",
    prompt: "runtime prompt",
    timeoutMs: 1234,
    env: {},
    runner: captureRunner(captured, '{"ok": true}'),
  });

  expect(captured.command).toContain("--model");
  expect(captured.command).toContain("gpt-ingest");
  expect(captured.command).toContain('model_reasoning_effort="medium"');
  expect(captured.options?.timeoutMs).toBe(1234);
});
```

Use the existing `Captured` and `captureRunner` patterns in `src/runtime/llm-client.test.ts`.

- [ ] **Step 3: Invoke worker LLM with ingest workload**

In `runIngestWorker`, load config once at worker start and call:

```ts
const config = await loadConfig(input.root);
```

Then pass:

```ts
workload: "ingest",
timeoutMs: config.ingest.llmTimeoutMs,
```

Set `maxPromptChars` default from `config.ingest.promptCharLimit`.

### Task 3: Use concurrency and start delay in command start

**Files:**
- Modify: `src/commands/ingest.ts`
- Modify: `src/commands/ingest.test.ts`

- [ ] **Step 1: Update command test expectation**

Seed config in the command test with:

```ts
await writeFile(join(root, "myelin.config"), "INGEST_BATCH_SIZE=2\nINGEST_WORKER_START_DELAY_MS=250\n", "utf8");
```

Then expect:

```ts
expect(spawned.map((item) => (item as { env: Record<string, string | undefined> }).env.MYELIN_INGEST_START_DELAY_MS)).toEqual([
  "250",
  "500",
  "750",
]);
```

- [ ] **Step 2: Wire start delay from config**

In `start`, replace the hardcoded `750`:

```ts
MYELIN_INGEST_START_DELAY_MS: String((index + 1) * config.ingest.workerStartDelayMs),
```

- [ ] **Step 3: Record concurrency in job input without changing scheduler behavior**

Until a scheduler exists, keep one job per batch but record the profile value:

```ts
worker_concurrency: config.ingest.workerConcurrency,
```

Do not implement a worker pool in this chunk.

### Task 4: Document stable keys

**Files:**
- Modify: `myelin.config`

- [ ] **Step 1: Add ingest profile keys**

```dotenv
# Experience Log to Session Memory ingest.
INGEST_BATCH_SIZE=100
INGEST_WORKER_CONCURRENCY=1
INGEST_WORKER_START_DELAY_MS=750
INGEST_LLM_TIMEOUT_MS=600000
INGEST_PROMPT_CHAR_LIMIT=180000
INGEST_CODEX_MODEL=gpt-5.4-mini
INGEST_CODEX_REASONING_EFFORT=medium
# INGEST_CLAUDE_MODEL=claude-sonnet-4-7
```

Keep existing `PIPELINE_*` keys for non-ingest pipeline work.

## Verification

Run: `bun test src/runtime/runtime.test.ts src/runtime/llm-client.test.ts`
Expected: config and LLM invocation tests pass.

Run: `bun test src/commands/ingest.test.ts src/ingest/worker.test.ts`
Expected: command/worker tests pass with config-derived delay and ingest workload.

Run: `bun run typecheck`
Expected: exits 0.

Run: `git diff --check`
Expected: no output.

## Acceptance Criteria Covered

- Ingest runtime controls live in a named ingest profile.
- Stable defaults are documented in `myelin.config`.
- Env overrides remain available through existing config merge behavior.
- Ingest model/reasoning/timeout are separate from broad pipeline defaults.

## Risks And Rollback

- Risk: adding `ingest` to `Workload` can affect generic model selection. Keep tests for `pipeline` and `query` profiles passing.
- Risk: `INGEST_WORKER_CONCURRENCY` is recorded before a scheduler exists. Do not use it to launch unbounded workers in this chunk.
- Rollback: revert config profile parsing and keep `INGEST_BATCH_SIZE` only if integration tests fail.

## Non-Goals

- No tombstone lifecycle changes.
- No status/readback UI changes.
- No full worker pool or scheduler.

## Type And Name Consistency

Use config keys exactly as `INGEST_BATCH_SIZE`, `INGEST_WORKER_CONCURRENCY`, `INGEST_WORKER_START_DELAY_MS`, `INGEST_LLM_TIMEOUT_MS`, `INGEST_PROMPT_CHAR_LIMIT`, `INGEST_CODEX_MODEL`, `INGEST_CODEX_REASONING_EFFORT`, and `INGEST_CLAUDE_MODEL`.
