# Retrieval and embedding lifecycle

Myelin retrieves either indexed Session Memory or indexed canonical Project Memory through the CLI/JSON boundary, while embedding contracts make provider, model, vector size, purpose, and format version explicit and safely replaceable.

The checked-out repository is the registered `llm-wiki` project at commit `78cc13dfcc73145db780b80c38c7d247efd9eca9` on `master` ([repository-identity.json](../repository-identity.json)).

## Query boundary and layer selection

`myelin memory query <project-key> <question> --json` is the supported machine-readable query boundary. Core query code lives in `src/query/`, but detached MCP consumers are intentionally outside the root package graph and must invoke this CLI/JSON contract rather than import core source. `src/commands/memory.ts` parses the command, and `src/query/engine.ts` owns configuration, active-contract resolution, database lifetime, and optional current-branch resolution.

The `--layer` policy has two supported values:

| Selection | Result |
| --- | --- |
| omitted or `--layer session` | Query active Session Memory only. `--branch <name>` filters this layer; `--branch current` resolves the target repository's current branch. |
| `--layer project` | Query Project Memory only. Branch filtering is not passed to this retrieval layer. |

The layers are deliberately not merged. Session results populate `matches` and have `memory_scope: session_memory`; Project Memory results populate `project_memory_matches` and have `memory_scope: project_memory`. `--debug` adds one layer diagnostic with index counts, pending count, query-embedding-cache information, normalized question, and degraded status. A retrieval exception produces a successful JSON-shaped response only at the service layer; the CLI treats a degraded non-JSON query as a failure and emits its reason.

This separation is regression-tested in `tests/query/memory-query-service.test.ts`: a project selection leaves session matches empty, and distance alone is not treated as a probability. Confidence is a bounded evidence heuristic; it is zero for degraded/no-match output and capped for poor Project Memory token coverage.

## Retrieval freshness and quality

Session retrieval uses the active session embedding contract and the session vector index. If sqlite-vec, the embedding runtime, or indexed rows are unavailable, it fails closed with a degraded result rather than fabricating an answer. Pending rows identify work for `myelin memory index session`.

Project Memory retrieval is hybrid and canonical-markdown-aware (`src/query/project-memory-query-service.ts`):

- It requires active-contract vector rows. With pending rows it reports that `myelin memory index project` is needed; with none it reports an empty index.
- It embeds the normalized question under the same identity but with `retrieval_query` purpose, caching that embedding in SQLite.
- It takes a broader vector recall set, combines it with an FTS section recall set using reciprocal-rank fusion, then reranks using title, heading, query token/phrase coverage, navigation penalty, and compound-question facets.
- It resolves each hit back to the current `projects/<key>/` markdown section. A matching section hash returns `inline_content` unless it exceeds `--max-inline-chars`; an oversized section returns a citation-only `reference` with `too_large`.
- A changed hash or missing current section never leaks stale indexed text. It returns a citation-only reference with `stale_hash` or `missing_markdown` and marks the response degraded.

`tests/query/project-memory-query-service.test.ts` covers hybrid recall/reranking, cache and rank diagnostics, oversized references, and the stale/missing-markdown freshness boundary. The indexer accepts only non-top-level structural sections and rejects a `retrieval_query` contract at the document-index boundary (`tests/memory/project-memory-retrieval-indexer.test.ts`).

## Indexing operations

Operators index derived retrieval state through these commands:

```text
myelin memory index session <project-key> [--limit N] [--batch-size N] [--retry-failed] [--json]
myelin memory index project <project-key> [--limit N] [--batch-size N] [--retry-failed] [--json]
```

`--limit` and `--batch-size` must be positive; batch size is capped at 500. Omitting `--retry-failed` selects pending work only. Adding it includes failed rows for another attempt. Both commands return selected/indexed/failed/pending counts and failure details in JSON; a degraded index exits as a CLI failure after recording selected rows as failed when vector storage is unavailable.

For Session Memory, `SessionMemoryIndexService` delegates to `src/memory/session-memory-indexer.ts`: it creates active-contract embedding rows for active memories, normalizes content, batches provider calls, atomically upserts vector plus indexed metadata, and marks per-row failures. Superseded and retracted memories are not active input. For Project Memory, `ProjectMemoryRetrievalIndexCoordinator` is the runtime authority: it loads config, resolves the active project contract/provider, opens and closes the database, and delegates to the injected `ProjectMemoryRetrievalIndexService`. The indexer derives rows from current markdown; obsolete rows are marked `stale` when their section hash changed or `orphaned` when the section disappeared. Valid current hints enrich index text; stale hints are excluded.

These service boundaries are independently covered by `tests/memory/session-memory-index-service.test.ts` and `tests/memory/project-memory-retrieval-index-service.test.ts`.

## Embedding provider contracts

An embedding contract consists of provider, model, dimensions, purpose, and format version. The supported provider modes are:

| `EMBEDDING_PROVIDER` value | Outcome |
| --- | --- |
| `auto` (default) | Probes available local Ollama providers in priority order for a scope with no persisted contract, then registers the selected contract. Later processes reuse that active contract and do not re-probe. |
| `ollama_nomic` | Uses the configured/default Nomic Ollama model and dimensions. |
| `ollama_qwen` | Uses the configured/default Qwen Ollama model and dimensions. |
| `gemini` | Uses the configured/default Gemini model and dimensions; initialization fails closed without `GOOGLE_API_KEY` or its accepted `GEMINI_API_KEY` alias. |

`EMBEDDING_NOMIC_*`, `EMBEDDING_QWEN_*`, and `EMBEDDING_GEMINI_*` configure models/dimensions; `EMBEDDING_OLLAMA_URL` configures the local endpoint. Document indexing always uses `retrieval_document`; query embeddings use `retrieval_query`. A configured provider change becomes desired state, but never silently replaces the active contract: it requires an explicit migration. This stickiness and desired-versus-active distinction are covered by `tests/memory/embedding-contract-resolver.test.ts`.

## Migration, rollback, and protected pruning

The embedding lifecycle commands operate across both `session_memory` and `project_memory` scopes:

```text
myelin memory embeddings migrate [--apply] [--json]
myelin memory embeddings rollback [--apply] [--json]
myelin memory embeddings prune [--apply] [--json]
```

Without `--apply`, every command is a preview. `migrate --apply` stages the desired contract, creates its vector table, reindexes all relevant projects, then verifies all metadata/vector row counts and runs a vector smoke query before activating it. Any indexing failure, remaining pending work, count mismatch, or smoke-query failure leaves the old contract active and marks the staging contract failed. A successful activation retains the previous contract for rollback.

`rollback --apply` swaps the active and previous contracts for every scope that has a previous contract. Its user-visible result is that subsequent indexing and query runtime resolve the former contract again. This is a state transition, not a deletion; no rollback occurs for a scope without previous state.

`prune --apply` is destructive and irreversible. It removes inactive historical/failed contract metadata, matching query-embedding cache rows, vectors, and owned retired vector tables; it also removes the inactive contract registration. The active and immediately previous contracts are protected from candidate selection. Before any removal, the service requires complete active-contract coverage:

- every active Session Memory must have an indexed active-contract document embedding;
- every indexable current Project Memory section must have an indexed active-contract document embedding.

If either condition is unmet, pruning aborts before writes. This precedence is intentional: active coverage protection comes before the transaction that deletes retired derived state. `tests/memory/embedding-contract-lifecycle-service.test.ts` covers staged activation, rollback, removal of unprotected historical rows, and refusal to prune when active Session Memory coverage is incomplete.

## Known gaps

- The inspected lifecycle regression tests directly demonstrate the Session Memory prune guard, but do not include an equivalent end-to-end fixture that proves the Project Memory active-section coverage failure path.
- The inspected query tests prove each layer independently and preserve their separation; they do not provide an end-to-end CLI test of a detached MCP consumer invoking `myelin memory query --json`.
