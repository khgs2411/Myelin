# Evidence Provenance And Candidates

Candidate, handoff, session, and provenance boundaries

## Overview

Project Memory candidates and handoffs are leads created by producers such as Session Memory, runtime inbox intake, or future maintenance flows.

A lead can explain why something is worth documenting, but project learn must inspect target-repo evidence before writing a durable Project Memory page.

The evidence map bridges the lead to repo truth by listing answer domains, representative questions, inspected paths, search terms, search results, and evidence refs.

Provenance:

- Evidence: repo_citation:src/project/project-memory-evidence-map.ts
- Evidence: repo_citation:src/memory/candidates.ts
- Repo: src/project/project-memory-evidence-map.ts:1 - evidence map
- Repo: src/memory/candidates.ts:1 - memory candidates

## Operational Details

The evidence-map builder starts from default orientation surfaces and answer-domain path hints, then runs bounded rg searches with generated-path exclusions and result caps.

Runtime inbox items become normalized candidates through memory inbox intake, while source-consumption reconciliation marks candidates and handoffs processed only after terminal apply or accepted no-op disposition.

Producer priority can weight candidates during maintenance, but producer metadata never grants write authority without deterministic validation.

Provenance:

- Evidence: repo_citation:src/project/project-memory-evidence-map.ts
- Evidence: repo_citation:src/memory/candidates.ts
- Repo: src/project/project-memory-evidence-map.ts:1 - evidence map
- Repo: src/memory/candidates.ts:1 - memory candidates

## Evidence And Boundaries

src/project/project-memory-candidate-intake-service.ts owns runtime inbox to candidate normalization.

src/project/project-memory-source-consumption-reconciler.ts owns terminal candidate and handoff consumption after apply/no-op decisions.

src/project/project-memory-producer-boundary.ts documents producer-kind weighting without turning candidates into canonical truth.

Provenance:

- Evidence: repo_citation:src/project/project-memory-evidence-map.ts
- Evidence: repo_citation:src/memory/candidates.ts
- Repo: src/project/project-memory-evidence-map.ts:1 - evidence map
- Repo: src/memory/candidates.ts:1 - memory candidates

Page provenance:

- Evidence: repo_citation:src/project/project-memory-evidence-map.ts
- Evidence: repo_citation:src/memory/candidates.ts
- Repo: src/project/project-memory-evidence-map.ts:1 - evidence map
- Repo: src/memory/candidates.ts:1 - memory candidates
