# Project Memory Create Dogfood Acceptance

## Preconditions

- Root `state/memory.db` exists when preserving Session Memory and candidates matters.
- The operator accepts deleting and recreating `projects/llm-wiki/`.

## Commands

1. `bun src/cli.ts project reset llm-wiki --clean --confirm llm-wiki --json`
   - Expected: JSON reports `reset_scope: "project_shell"` and `preserved_memory_db` ending in `state/memory.db`.
2. `bun src/cli.ts project learn llm-wiki --json`
   - Expected on success: `content_quality_status: "trusted"` and either `status: "completed"` or `status: "completed_with_pending_index"`.
   - Expected on insufficient docs: `status: "needs_review"` or `status: "failed"` and `stopped_before_writes: true`.
3. Inspect `projects/llm-wiki/runs/project-learn/<run>/project-memory-evidence-map.json`.
   - Expected: all required answer domains are present.
4. Inspect canonical wiki pages only when result content quality is trusted.
   - Expected: pages contain real `##` sections and repo citations.

## Notes

- `completed_with_pending_index` is acceptable only when content quality is trusted; it means retrieval indexing still has pending work.
- `project reset` preserves the root memory database and only recreates project-shell material under `projects/<key>/`.
