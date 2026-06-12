# Vector Indexer

## Outcome

Myelin can index changed curated memory chunks for semantic retrieval.

## Why it matters

Semantic recall helps agents find relevant memory without scanning every page.

## Scope

- Chunk curated wiki, session summaries, and practice pages.
- Hash chunks.
- Skip unchanged content.
- Store embedding status.
- Leave failed embeddings pending.

## Done means

- Indexing is deterministic around chunk identity and freshness.
- Provider or quota failures do not corrupt memory.

## Notes

- Vector search is retrieval over curated truth, not the product itself.
