# Curation And Apply Lifecycle

Project learn curation, validation, apply, and retrieval lifecycle

## Overview

The project learn create lifecycle builds an input packet, writes a deterministic evidence map, invokes the curator, validates the returned JSON, critiques usefulness, and only then applies markdown.

Deterministic validation owns schema shape, sectioned rendered markdown, answer-domain coverage, orientation-surface inspection, evidence-map support, citations, answerability, and shallow-content detection.

The independent usefulness critique is a model-backed second gate that can return pass, review_only, or fail after reading rendered markdown and the evidence map.

Provenance:

- Evidence: repo_citation:src/project/project-memory-curator-service.ts
- Evidence: repo_citation:src/project/project-memory-markdown-applier.ts
- Repo: src/project/project-memory-curator-service.ts:1 - curator orchestration
- Repo: src/project/project-memory-markdown-applier.ts:1 - canonical markdown apply

## Operational Details

Markdown apply stages canonical writes, records project-memory-apply-journal.json, produces project-memory-changeset.json, and finalizes project-memory.json only after safe promotion.

First-create is all-or-nothing: shallow, blocked, review-only, or failed output remains in run artifacts and must not become trusted wiki state.

A completed_with_pending_index result means content quality was trusted and markdown was applied, but retrieval hints or vector indexing still need follow-up work.

Provenance:

- Evidence: repo_citation:src/project/project-memory-curator-service.ts
- Evidence: repo_citation:src/project/project-memory-markdown-applier.ts
- Repo: src/project/project-memory-curator-service.ts:1 - curator orchestration
- Repo: src/project/project-memory-markdown-applier.ts:1 - canonical markdown apply

## Evidence And Boundaries

src/project/project-memory-curator-service.ts orchestrates packet creation, evidence-map writing, provider calls, validation, critique, apply, and retrieval lifecycle results.

src/project/project-memory-curator-validator.ts and project-memory-rendered-quality.ts enforce the create-mode quality contract before canonical writes.

src/project/project-memory-markdown-applier.ts owns staged markdown mutation and recovery semantics.

Provenance:

- Evidence: repo_citation:src/project/project-memory-curator-service.ts
- Evidence: repo_citation:src/project/project-memory-markdown-applier.ts
- Repo: src/project/project-memory-curator-service.ts:1 - curator orchestration
- Repo: src/project/project-memory-markdown-applier.ts:1 - canonical markdown apply

Page provenance:

- Evidence: repo_citation:src/project/project-memory-curator-service.ts
- Evidence: repo_citation:src/project/project-memory-markdown-applier.ts
- Repo: src/project/project-memory-curator-service.ts:1 - curator orchestration
- Repo: src/project/project-memory-markdown-applier.ts:1 - canonical markdown apply
