# Current Work Roadmap And Decisions

Current roadmap, ADRs, and implementation decisions

## Overview

docs/ROADMAP.md is the workload guide for Myelin, and the current Step 5/6 work focuses on making Project Memory first-create useful before Step 7 maintenance automation.

The July 5 design records the product correction: Project Memory must be living repo documentation organized by answer domains, not six shallow role pages.

The roadmap intentionally places MCP wrapping near the end because dogfood inside Myelin should use CLI commands until the behavior is stable.

Provenance:

- Evidence: repo_citation:docs/ROADMAP.md
- Evidence: repo_citation:docs/adr/0064-use-two-pass-project-memory-evidence-workflow.md
- Repo: docs/ROADMAP.md:1 - current roadmap
- Repo: docs/adr/0064-use-two-pass-project-memory-evidence-workflow.md:1 - evidence workflow ADR

## Operational Details

ADR 0063 chooses answer-domain documentation, ADR 0064 chooses the two-pass evidence workflow, ADR 0065 requires independent usefulness critique, and ADR 0066 allows clean project-shell rebootstrap preserving state/memory.db.

The execution plan splits renderer, answer domains, rendered quality, evidence map, schema validation, writer flow, critique, promotion state, reset, and dogfood regression into separate chunks.

Current dogfood acceptance requires clean reset preservation, trusted content before canonical writes, real markdown sections, repo citations, evidence-map artifacts, and clear separation from retrieval readiness.

Provenance:

- Evidence: repo_citation:docs/ROADMAP.md
- Evidence: repo_citation:docs/adr/0064-use-two-pass-project-memory-evidence-workflow.md
- Repo: docs/ROADMAP.md:1 - current roadmap
- Repo: docs/adr/0064-use-two-pass-project-memory-evidence-workflow.md:1 - evidence workflow ADR

## Evidence And Boundaries

docs/design/2026-07-05-project-memory-rendered-create-contract/spec.md and agenda.md capture the settled design and answered questions.

docs/design/2026-06-30-project-memory-shape-creation-maintenance/dogfood-validation.md records the failed trusted-but-shallow output that this slice must prevent.

Future practice and personal memory work should wait until Project Memory create and maintenance behavior can dogfood Myelin itself.

Provenance:

- Evidence: repo_citation:docs/ROADMAP.md
- Evidence: repo_citation:docs/adr/0064-use-two-pass-project-memory-evidence-workflow.md
- Repo: docs/ROADMAP.md:1 - current roadmap
- Repo: docs/adr/0064-use-two-pass-project-memory-evidence-workflow.md:1 - evidence workflow ADR

Page provenance:

- Evidence: repo_citation:docs/ROADMAP.md
- Evidence: repo_citation:docs/adr/0064-use-two-pass-project-memory-evidence-workflow.md
- Repo: docs/ROADMAP.md:1 - current roadmap
- Repo: docs/adr/0064-use-two-pass-project-memory-evidence-workflow.md:1 - evidence workflow ADR
