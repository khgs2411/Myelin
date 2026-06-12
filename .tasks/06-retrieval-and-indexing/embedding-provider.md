# Embedding Provider

## Outcome

Embeddings use a provider abstraction separate from chat/model execution.

## Why it matters

Embedding needs different failure modes, quotas, and caching than LLM stage execution.

## Scope

- Provider interface.
- Config.
- Retry and pending state.
- Stub support for tests.

## Done means

- Retrieval indexing does not assume a fixed free tier.
- Tests can run without network access.

## Notes

- Gemini is a likely future embedding provider, not currently wired.
