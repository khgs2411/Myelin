# Derive Project Memory retrieval from markdown with separate hint maintenance

Project Memory retrieval should be derived serving state over canonical wiki markdown, not a second source of truth. Myelin will derive structural section metadata deterministically from markdown, use a separate hint-generation flow for semantic keywords and aliases, and route hint/index repair through a dedicated retrieval-maintenance queue instead of Project Memory candidates. This preserves the markdown truth boundary while still allowing richer semantic lookup and usage-driven retrieval repair.

## Considered Options

- Let the Project Memory curator also author retrieval hints.
- Store hint files inside `wiki/` next to markdown pages.
- Treat poor retrieval feedback as ordinary Project Memory candidates.
- Keep retrieval pointers deterministic and put hint/index repair in a dedicated serving-state lane.

## Consequences

The design adds a retrieval-maintenance surface, but avoids confusing memory-content curation with serving-state repair and keeps SQLite/vector rows rebuildable from canonical markdown.

Fallback markdown lookup remains a bootstrap and diagnostic path. Creation-mode writes may use fallback lookup as context when direct candidate/source evidence supports the write, but maintenance-mode writes that depend on fallback lookup require review and must not auto-apply.

Canonical markdown/state writes can succeed even when derived retrieval indexing is still pending. Such runs should report `completed_with_pending_index` rather than `completed` until mandatory hint generation, embedding, and index refresh for new pages/entries have finished.
