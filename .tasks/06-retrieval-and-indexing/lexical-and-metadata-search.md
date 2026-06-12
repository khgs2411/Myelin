# Lexical And Metadata Search

## Outcome

Myelin can retrieve relevant memory using cheap lexical and metadata search before using embeddings or model synthesis.

## Why it matters

The docs consistently treat vector search as a retrieval layer, not the product. Cheap deterministic search should carry as much as it can.

## Scope

- Page metadata.
- Tags, aliases, relationships, and rankings where available.
- Lexical search over curated memory.
- Route hints for semantic facades.

## Done means

- Query/status can answer obvious questions without embeddings.
- Retrieval explains which pages or state records were considered.

## Notes

- Related: ADR 0052.
