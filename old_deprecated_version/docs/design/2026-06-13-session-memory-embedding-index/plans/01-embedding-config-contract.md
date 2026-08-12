# Chunk 01: Embedding Config Contract

**Plan Set:** `../plan.md`
**Spec:** `../spec.md`
**Status:** Ready For Implementation
**Depends on:** None
**Enables:** `02-sqlite-vec-adapter-and-availability.md`, `03-embedding-provider-and-normalizer.md`, `04-embedding-storage-schema.md`, `06-indexer-backfill-command.md`, `07-session-memory-query-facade.md`

## Goal

Add the shared embedding configuration and active-contract resolver used by schema, provider, indexer, and query code. This chunk defines names, precedence, and the default Session Memory document contract only; it does not call Gemini, load sqlite-vec, or change SQLite schema.

## Source Artifacts

- `../spec.md`: Embedding Config Contract, Embedding Contract Versioning
- `../agenda.md`: Questions 1, 2, 4, 6 and External Audit Reconciliation
- `../../../CONTEXT.md`: Provider Abstraction, Session Memory, Query Facade
- Code paths: `src/runtime/config.ts`, `src/runtime/runtime.test.ts`, `myelin.config`, `AGENTS.md`

## Relationships

- **Depends on:** Existing `loadConfig` dotenv/env precedence.
- **Enables:** Every later chunk that needs the configured active embedding contract.
- **Shared contracts:** `EmbeddingProvider`, `EmbeddingPurpose`, `ActiveEmbeddingContract`, `EmbeddingConfig`, `selectActiveEmbeddingContract`, `DEFAULT_SESSION_MEMORY_EMBEDDING_CONTRACT`.
- **Integration points:** `src/runtime/config.ts` remains the config source of truth.

## File Responsibility Map

**Modify:**
- `src/runtime/config.ts` - add embedding config types, defaults, parsing, and active-contract selection.
- `src/runtime/runtime.test.ts` - verify defaults, file config, environment precedence, unsupported provider, invalid dimensions, and active contract identity.
- `myelin.config` - add commented embedding defaults as operator documentation.
- `AGENTS.md` - document embedding config variables.

## Implementation Tasks

### Task 1: Extend Runtime Config Types

**Files:**
- Modify: `src/runtime/config.ts`
- Test: `src/runtime/runtime.test.ts`

- [ ] **Step 1: Add failing tests for embedding defaults and env precedence**

Add tests like:

```ts
test("config exposes default embedding contract", async () => {
  const root = await mkdtemp(join(tmpdir(), "myelin-config-"));
  try {
    const config = await loadConfig(root, {});
    expect(config.embedding).toEqual({
      provider: "gemini",
      geminiModel: "gemini-embedding-2",
      dimensions: 1536,
      stubResponsesDir: undefined,
    });
    expect(selectActiveEmbeddingContract(config, "retrieval_document")).toEqual({
      provider: "gemini",
      model: "gemini-embedding-2",
      dimensions: 1536,
      purpose: "retrieval_document",
      formatVersion: 1,
    });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("embedding config honors file values and environment precedence", async () => {
  const root = await mkdtemp(join(tmpdir(), "myelin-config-"));
  try {
    await writeFile(
      join(root, "myelin.config"),
      [
        "EMBEDDING_PROVIDER=gemini",
        "EMBEDDING_GEMINI_MODEL=file-model",
        "EMBEDDING_DIMENSIONS=768",
        "EMBEDDING_STUB_RESPONSES_DIR=file-stubs",
      ].join("\n"),
    );
    const config = await loadConfig(root, {
      EMBEDDING_GEMINI_MODEL: "env-model",
      EMBEDDING_DIMENSIONS: "1536",
    });
    expect(config.embedding).toEqual({
      provider: "gemini",
      geminiModel: "env-model",
      dimensions: 1536,
      stubResponsesDir: "file-stubs",
    });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
```

Expected before implementation: tests fail because `config.embedding` and `selectActiveEmbeddingContract` do not exist.

- [ ] **Step 2: Implement embedding config types and parser**

Add to `src/runtime/config.ts`:

```ts
export type EmbeddingProvider = "gemini";
export type EmbeddingPurpose = "retrieval_document" | "retrieval_query";

export type EmbeddingConfig = {
  provider: EmbeddingProvider;
  geminiModel: string;
  dimensions: number;
  stubResponsesDir?: string;
};

export type ActiveEmbeddingContract = {
  provider: EmbeddingProvider;
  model: string;
  dimensions: number;
  purpose: EmbeddingPurpose;
  formatVersion: number;
};

export const EMBEDDING_FORMAT_VERSION = 1;
export const DEFAULT_EMBEDDING_PROVIDER: EmbeddingProvider = "gemini";
export const DEFAULT_GEMINI_EMBEDDING_MODEL = "gemini-embedding-2";
export const DEFAULT_EMBEDDING_DIMENSIONS = 1536;
export const DEFAULT_SESSION_MEMORY_EMBEDDING_CONTRACT: ActiveEmbeddingContract = {
  provider: DEFAULT_EMBEDDING_PROVIDER,
  model: DEFAULT_GEMINI_EMBEDDING_MODEL,
  dimensions: DEFAULT_EMBEDDING_DIMENSIONS,
  purpose: "retrieval_document",
  formatVersion: EMBEDDING_FORMAT_VERSION,
};
```

Extend `MyelinConfig`:

```ts
export type MyelinConfig = {
  defaultProvider: Provider;
  profiles: Record<Workload, Partial<Record<Provider, ModelProfile>>>;
  embedding: EmbeddingConfig;
  values: Record<string, string>;
};
```

Add parsing helpers:

```ts
function embeddingConfig(values: Record<string, string>): EmbeddingConfig {
  const provider = parseEmbeddingProvider(values.EMBEDDING_PROVIDER ?? DEFAULT_EMBEDDING_PROVIDER);
  return {
    provider,
    geminiModel: values.EMBEDDING_GEMINI_MODEL ?? DEFAULT_GEMINI_EMBEDDING_MODEL,
    dimensions: parseEmbeddingDimensions(values.EMBEDDING_DIMENSIONS ?? String(DEFAULT_EMBEDDING_DIMENSIONS)),
    stubResponsesDir: values.EMBEDDING_STUB_RESPONSES_DIR,
  };
}

function parseEmbeddingProvider(value: string): EmbeddingProvider {
  if (value === "gemini") return value;
  throw new Error(`Unsupported embedding provider: ${value}`);
}

function parseEmbeddingDimensions(value: string): number {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) throw new Error(`Invalid embedding dimensions: ${value}`);
  return parsed;
}

export function selectActiveEmbeddingContract(
  config: MyelinConfig,
  purpose: EmbeddingPurpose,
): ActiveEmbeddingContract {
  return {
    provider: config.embedding.provider,
    model: config.embedding.geminiModel,
    dimensions: config.embedding.dimensions,
    purpose,
    formatVersion: EMBEDDING_FORMAT_VERSION,
  };
}
```

`DEFAULT_SESSION_MEMORY_EMBEDDING_CONTRACT` exists for migration and low-level repository code that cannot safely load `myelin.config`. Runtime index/query paths must prefer `selectActiveEmbeddingContract(config, purpose)` when config is available.

Wire `embedding: embeddingConfig(merged)` into `loadConfig`.

- [ ] **Step 3: Add invalid provider/dimensions tests**

Add assertions that `loadConfig(root, { EMBEDDING_PROVIDER: "openai" })` rejects with `Unsupported embedding provider` and `loadConfig(root, { EMBEDDING_DIMENSIONS: "zero" })` rejects with `Invalid embedding dimensions`.

- [ ] **Step 4: Document config keys**

Add commented defaults to `myelin.config`:

```dotenv
# Session Memory embedding/indexing.
# EMBEDDING_PROVIDER=gemini
# EMBEDDING_GEMINI_MODEL=gemini-embedding-2
# EMBEDDING_DIMENSIONS=1536
# EMBEDDING_STUB_RESPONSES_DIR=
# GEMINI_API_KEY is read from the environment, not checked into this file.
```

Update the AGENTS environment table with the embedding keys and `GEMINI_API_KEY`.

## Verification

- Run: `rtk bun test src/runtime/runtime.test.ts`
  - Expected: passes, including the new embedding config tests.
- Run: `rtk bun run typecheck`
  - Expected: exits 0.
- Run: `rtk git diff --check`
  - Expected: no whitespace errors.

## Acceptance Criteria Covered

- Embedding config is separate from chat/model profiles.
- Active contract resolver and default Session Memory document contract exist before schema/index/query code.
- Environment values override `myelin.config`.

## Risks And Rollback

- Risk: `MyelinConfig` changes break LLM config callers. Mitigation: keep existing fields unchanged and only add `embedding`.
- Rollback: remove the new types/tests/docs if downstream chunks have not landed.

## Non-Goals

- No Gemini calls.
- No sqlite-vec loading.
- No database schema or command changes.

## Type And Name Consistency

Use these exact names in later chunks: `EmbeddingProvider`, `EmbeddingPurpose`, `EmbeddingConfig`, `ActiveEmbeddingContract`, `EMBEDDING_FORMAT_VERSION`, `DEFAULT_SESSION_MEMORY_EMBEDDING_CONTRACT`, `selectActiveEmbeddingContract`.
