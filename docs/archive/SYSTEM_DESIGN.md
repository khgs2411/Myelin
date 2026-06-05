# llm-wiki System Design

## Product Thesis

`llm-wiki` compiles durable project memory for codebases so future sessions can start from maintained wiki pages instead of broad repo scans.

## Core Model

- repo = implementation truth
- wiki = compiled understanding
- state = machine-readable routing, provenance, and freshness
- raw = incoming source material

## Unified Pipeline

The system now uses one update operation instead of separate bootstrap and ingest workflows.

`make update PROJECT=<key>` runs:

1. sense
2. impact
3. propose
4. apply
5. validate
6. reconcile on failure
7. apply commit after validate passes

The pipeline is intentionally gated:

- `apply` mutates wiki and state
- `validate` is the correctness gate
- `reconcile` is a bounded repair loop, not an open-ended rewrite engine
- `apply_commit` advances freshness only after validation succeeds

## Stable Products And Audit Runs

Human-readable and machine-readable stable outputs live under `projects/<key>/state/latest/`.

Timestamped run artifacts live under `artifacts/<key>/runs/` for debugging and provenance.

## Measurement

`make measure PROJECT=<key>` scores the wiki against `acceptance-questions.md` using per-question LLM judgments. This measures whether the maintained wiki can answer the questions a cold session should be able to answer.

## Success Condition

The system succeeds when an agent can answer targeted project questions from `index.md`, a small number of wiki pages, and `state/latest/` outputs without broad repo re-reading.
