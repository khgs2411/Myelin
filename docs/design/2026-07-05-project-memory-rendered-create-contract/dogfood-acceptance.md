# Project Memory Create Dogfood Acceptance

## Product Bar

This dogfood has two separate outcomes:

- Foundation pass: the run proves sectioned pages, answer-domain coverage, evidence-map generation, deterministic rendered-quality checks, independent critique plumbing, all-or-nothing promotion, clean reset, and retrieval readiness.
- Vision-quality pass: the canonical wiki is useful living repo documentation that a future agent can query to answer real product and implementation-orientation questions without rediscovering the repo.

A foundation pass is not a vision-quality pass. Do not mark the `llm-wiki` Project Memory baseline as product-satisfactory, or proceed to candidate-driven maintenance as if the baseline is good, unless the vision-quality checks below pass.

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

## Vision-Quality Checks

The dogfood is vision-quality only when all of these are true:

- Required product questions from `MY_VISION.md` are answerable from Project Memory query results or direct canonical wiki reads, without a fresh repo search.
- The answers are specific enough to orient implementation work, including concrete commands, state files, runtime boundaries, and source-owned concepts where applicable.
- Repo-groundable claims cite precise evidence. Coarse file-only or line-1 citations are acceptable only for whole-file facts or when the doc explicitly marks the claim as inference.
- The run distinguishes deterministic fixture success from a live provider dogfood result. A stubbed run can prove mechanics, but it cannot prove live documentation quality.
- Session Memory candidates and runtime inbox items are treated as leads only; accepted Project Memory text is grounded in repo evidence.
- `project-memory.json` and CLI JSON do not imply product-quality success when the output only passes the foundation contract.

Representative required questions include:

- Where is the SQLite database stored for Myelin memory, and which parts of it are canonical versus derived serving state?
- How do Session Memory entries differ from Project Memory wiki pages and Project Memory retrieval rows?
- How can Session Memory or runtime inbox material become a Project Memory candidate, and what must happen before it becomes durable documentation?
- How does `project learn` decide whether to write, reject, or stop before writes?
- How does Project Memory query resolve SQLite/vector hits back to markdown sections or refs?

## Notes

- `completed_with_pending_index` is acceptable only when content quality is trusted; it means retrieval indexing still has pending work.
- `content_quality_status: "trusted"` is a foundation signal until the vision-quality checks pass.
- `project reset` preserves the root memory database and only recreates project-shell material under `projects/<key>/`.
