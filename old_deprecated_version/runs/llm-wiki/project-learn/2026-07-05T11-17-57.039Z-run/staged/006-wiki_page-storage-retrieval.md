# Storage And Retrieval

SQLite, embeddings, and markdown retrieval

## Overview

The root SQLite database is state/memory.db, and it stores Session Memory records, memory candidates, handoffs, experience-log state, embeddings, and retrieval serving metadata keyed by project.

Session Memory rows are durable conversation-derived memory items; Project Memory retrieval rows are derived pointers generated from canonical wiki markdown sections.

This distinction matters because memory query can return recent Session Memory directly, while Project Memory lookup should resolve index hits back to markdown content or a file reference.

Provenance:

- Evidence: repo_citation:src/memory/db.ts
- Evidence: repo_citation:src/memory/project-memory-retrieval-indexer.ts
- Repo: src/memory/db.ts:1 - root SQLite database and memory tables
- Repo: src/memory/project-memory-retrieval-indexer.ts:1 - Project Memory retrieval rows

## Operational Details

Project Memory retrieval indexing reads rendered wiki sections, combines section text with generated hints, embeds those serving texts, and stores rows that can be refreshed when markdown hashes change.

The query service hydrates vector hits by reading the current markdown section and refuses stale inline content when the stored hash no longer matches the canonical file.

Session Memory indexing is a separate operator command through memory index session, using pending embedding rows and branch-aware retrieval semantics.

Provenance:

- Evidence: repo_citation:src/memory/db.ts
- Evidence: repo_citation:src/memory/project-memory-retrieval-indexer.ts
- Repo: src/memory/db.ts:1 - root SQLite database and memory tables
- Repo: src/memory/project-memory-retrieval-indexer.ts:1 - Project Memory retrieval rows

## Evidence And Boundaries

src/memory/db.ts and src/memory/migrations.ts own the SQLite schema and migration lifecycle for root memory state.

src/memory/project-memory-retrieval-indexer.ts and src/query/project-memory-query-service.ts own the derived Project Memory retrieval/index hydration behavior.

The canonical Project Memory page is still markdown; a SQLite row is only a fast pointer and must not become the source of truth.

Provenance:

- Evidence: repo_citation:src/memory/db.ts
- Evidence: repo_citation:src/memory/project-memory-retrieval-indexer.ts
- Repo: src/memory/db.ts:1 - root SQLite database and memory tables
- Repo: src/memory/project-memory-retrieval-indexer.ts:1 - Project Memory retrieval rows

Page provenance:

- Evidence: repo_citation:src/memory/db.ts
- Evidence: repo_citation:src/memory/project-memory-retrieval-indexer.ts
- Repo: src/memory/db.ts:1 - root SQLite database and memory tables
- Repo: src/memory/project-memory-retrieval-indexer.ts:1 - Project Memory retrieval rows
