# Chunk 03: Embedding Provider And Normalizer

**Plan Set:** `../plan.md`
**Spec:** `../spec.md`
**Status:** Ready For Implementation
**Depends on:** `01-embedding-config-contract.md`
**Enables:** `06-indexer-backfill-command.md`, `07-session-memory-query-facade.md`

## Goal

Add network-free-testable embedding provider contracts, a Gemini adapter, a deterministic stub adapter, and a Session Memory searchable-text normalizer. This chunk does not write database rows or vectors.

## Source Artifacts

- `../spec.md`: Embedding Provider, Embedding Config Contract, Canonical Record And Derived Index
- `../agenda.md`: Question 3
- Code paths: `src/runtime/config.ts`, `src/memory/session-memories.ts`, `src/memory/ingest-types.ts`
- External docs: Gemini embeddings JavaScript docs

## Relationships

- **Depends on:** `ActiveEmbeddingContract`, `EmbeddingPurpose` from Chunk 01.
- **Enables:** Indexer/backfill and query facade can embed document/query text through one provider API.
- **Shared contracts:** `EmbeddingProviderClient`, `EmbeddingRequest`, `EmbeddingResult`, `normalizeSessionMemoryForEmbedding`, stub fixture filename convention.
- **Integration points:** Gemini API via `fetch`; stub provider via local JSON files or injected provider.

## File Responsibility Map

**Create:**
- `src/memory/embedding-provider.ts` - provider interfaces, Gemini/stub providers, request formatting.
- `src/memory/embedding-provider.test.ts` - provider tests with fake fetch and stub responses.
- `src/memory/session-memory-text.ts` - deterministic Session Memory text normalization.
- `src/memory/session-memory-text.test.ts` - normalizer behavior.

## Implementation Tasks

### Task 1: Add Normalizer

**Files:**
- Create: `src/memory/session-memory-text.ts`
- Test: `src/memory/session-memory-text.test.ts`

- [ ] **Step 1: Add normalizer tests**

Test cases:

```ts
test("normalizes title summary kind and safe scalar payload fields", () => {
  const text = normalizeSessionMemoryForEmbedding({
    title: "Review gate",
    summary: "Reviewer accepted the Symphony card.",
    memory_kind: "verification",
    payload_json: JSON.stringify({
      branch: "myelin/example",
      command: "rtk bun test",
      nested: { ignored: true },
      transcript: "must not appear",
    }),
  });
  expect(text).toContain("title: Review gate");
  expect(text).toContain("summary: Reviewer accepted the Symphony card.");
  expect(text).toContain("kind: verification");
  expect(text).toContain("branch: myelin/example");
  expect(text).not.toContain("must not appear");
  expect(text).not.toContain("nested");
});

test("falls back when payload json is invalid", () => {
  expect(
    normalizeSessionMemoryForEmbedding({
      title: null,
      summary: "Useful continuity.",
      memory_kind: "continuity",
      payload_json: "{",
    }),
  ).toBe("summary: Useful continuity.\nkind: continuity");
});
```

- [ ] **Step 2: Implement normalizer**

Use an allowlist such as `branch`, `command`, `status`, `decision`, `next_action`, `verification`, `artifact`, `url`. Include only scalar string/number/boolean values under a maximum value length such as 500 characters.

Export:

```ts
export type SessionMemoryTextInput = {
  title?: string | null;
  summary: string;
  memory_kind: string;
  payload_json: string;
};

export function normalizeSessionMemoryForEmbedding(input: SessionMemoryTextInput): string;
```

### Task 2: Add Provider Contract

**Files:**
- Create: `src/memory/embedding-provider.ts`
- Test: `src/memory/embedding-provider.test.ts`

- [ ] **Step 1: Add provider interface**

Implement:

```ts
import type { ActiveEmbeddingContract } from "../runtime/config.ts";

export type EmbeddingRequest = {
  contract: ActiveEmbeddingContract;
  text: string;
  title?: string | null;
};

export type EmbeddingResult = {
  embedding: number[];
  model: string;
  dimensions: number;
};

export type EmbeddingProviderClient = {
  embed: (request: EmbeddingRequest) => Promise<EmbeddingResult>;
};
```

- [ ] **Step 2: Implement Gemini formatting and fake-fetch tests**

Test that document requests send:

```ts
{
  content: { parts: [{ text: "title: Review | text: normalized" }] },
  outputDimensionality: 1536
}
```

and query requests send:

```ts
{
  content: { parts: [{ text: "task: search result | query: what happened?" }] },
  outputDimensionality: 1536
}
```

Implement `createGeminiEmbeddingProvider(input: { apiKey?: string; fetch?: typeof fetch })`. Missing `apiKey` throws `Gemini API key is required for embedding requests` when `embed` is called.

The Gemini adapter should call:

```text
POST https://generativelanguage.googleapis.com/v1beta/models/{model}:embedContent?key={apiKey}
```

Expected response shape:

```json
{
  "embedding": {
    "values": [0.1, 0.2, 0.3]
  }
}
```

The adapter returns `dimensions` from `embedding.values.length` and must verify it equals `request.contract.dimensions`; mismatch throws `Gemini embedding dimensions mismatch: expected <expected>, got <actual>`.

### Task 3: Add Stub Provider

- [ ] **Step 1: Add deterministic stub tests**

Stub filename convention:

```text
<purpose>-<sha256(text).slice(0, 24)>.json
```

For example, a retrieval document embedding for text `summary: Useful continuity.` reads:

```text
retrieval_document-<hash>.json
```

Stub file shape:

```json
{
  "embedding": [0.1, 0.2, 0.3],
  "model": "stub-model",
  "dimensions": 3
}
```

Test that `createStubEmbeddingProvider(dir).embed({ contract, text })` reads the exact filename convention above. The hash input is `request.text` only; purpose is represented in the filename prefix.

- [ ] **Step 2: Implement stub provider**

Keep the stub provider independent from Gemini and suitable for CI. Use `node:crypto` hashing and `node:fs/promises` reads. If the loaded embedding length differs from `request.contract.dimensions`, throw `Stub embedding dimensions mismatch: expected <expected>, got <actual>`.

## Verification

- Run: `rtk bun test src/memory/session-memory-text.test.ts src/memory/embedding-provider.test.ts`
  - Expected: normalizer and provider tests pass without network access.
- Run: `rtk bun run typecheck`
  - Expected: exits 0.
- Run: `rtk git diff --check`
  - Expected: no whitespace errors.

## Acceptance Criteria Covered

- Gemini/stub embedding provider exists.
- Gemini endpoint, response parsing, and dimension checks are explicit.
- Stub fixture naming is deterministic and shared.
- Tests are network-free.
- Embedding text excludes raw Experience Log text and unsafe payload blobs.

## Risks And Rollback

- Risk: Gemini API response shape changes. Mitigation: centralize parsing in `embedding-provider.ts` and cover with fake-fetch tests.
- Rollback: remove provider/normalizer files if no later chunks landed.

## Non-Goals

- No database schema.
- No sqlite-vec table or vector writes.
- No command or query facade.

## Type And Name Consistency

Use exact exports: `EmbeddingProviderClient`, `EmbeddingRequest`, `EmbeddingResult`, `createGeminiEmbeddingProvider`, `createStubEmbeddingProvider`, `normalizeSessionMemoryForEmbedding`.
