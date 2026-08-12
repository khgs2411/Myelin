# Storage, SQLite, And Retrieval Indexes

Placeholder for the subject writer.

Document Myelin's storage model. Explain repo-root `state/memory.db`, migrations, WAL/foreign-key behavior, root SQLite versus project-owned markdown/state, vendored SQLite runtime selection, sqlite-vec availability, embedding providers/contracts, pending embedding rows, query embedding cache, Session Memory indexing/query, Project Memory section extraction, retrieval hints, retrieval maintenance queue, and why Project Memory retrieval rows are derived pointers back to markdown.

Suggested repo paths to inspect: `src/memory/db.ts`, `src/memory/migrations.ts`, `src/memory/sqlite-runtime.ts`, `src/memory/sqlite-vec.ts`, `src/memory/embedding-provider.ts`, `src/memory/embedding-provider-factory.ts`, `src/memory/session-memory-embeddings.ts`, `src/memory/session-memory-indexer.ts`, `src/memory/session-memory-query.ts`, `src/memory/project-memory-retrieval-storage.ts`, `src/memory/project-memory-retrieval-indexer.ts`, `src/memory/project-memory-retrieval-index-service.ts`, `src/memory/retrieval-maintenance-queue.ts`, `src/project/project-memory-markdown-sections.ts`, `src/project/project-memory-hints.ts`, `vendor/sqlite/README.md`, `tests/memory/`.
