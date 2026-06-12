# Myelin Roadmap Tasks

This folder breaks the Myelin vision into feature areas and implementation-item stubs.

These files describe **what** should exist, not when to build it or how to implement it. They are meant to be easy to grow, shrink, reorder, split, merge, or delete as the product becomes clearer.

The numbered folders are for readability, not build order. Use the dependency map in this README to decide whether an item is ready to plan or should wait for prerequisites.

## Feature Areas

- `01-current-briefing/` — give a new agent a concise, trustworthy starting point for a project.
- `02-session-memory/` — capture and recall project-scoped continuity.
- `03-project-memory/` — maintain durable project knowledge with provenance.
- `04-capture-and-candidates/` — collect raw experience and route possible memory updates.
- `05-semantic-interface/` — expose `query`, `how`, and `status` as the agent-facing surface.
- `06-retrieval-and-indexing/` — make curated memory searchable through structured and vector recall.
- `07-practice-memory/` — promote recurring cross-project workflows into canonical guidance.
- `08-personal-memory/` — promote durable user working preferences into canonical guidance.
- `09-schema-layer/` — evolve the schema layer from Phase 0 into project-local rules and candidates.
- `10-pipeline-and-audit/` — make learning and ingestion reproducible, reviewable, and trustworthy.
- `11-provider-runtime/` — keep model execution provider-pluggable and predictable.
- `12-source-intake-and-layout/` — preserve source material and keep project-owned layout coherent.
- `13-onboarding-and-ops/` — make projects easy to onboard, inspect, repair, and operate.

## File Shape

Each task stub should answer:

- **Outcome** — what capability exists when this item is done.
- **Why it matters** — what product risk or user pain it addresses.
- **Scope** — the boundaries of this item.
- **Dependencies** — prerequisites when they are not obvious; central dependency truth lives in this README.
- **Done means** — observable acceptance checks.
- **Notes** — links to design docs, ADRs, or known constraints.

Avoid turning these stubs into implementation plans unless a task is actively being planned.

## Dependency Types

- **Hard dependency** — do not implement the dependent item until this exists.
- **Soft dependency** — implementation can start, but the final product shape is incomplete without it.
- **Manual bypass** — a human-authored or stubbed version can exist before automation is built.

## Roadmap Flow

This is the preferred reading order for the roadmap. It is chronological where dependencies allow, but it is not a promise that every item in a cluster must be finished before anything in the next cluster starts.

```text
Foundation
  12-source-intake-and-layout
  09-schema-layer
  11-provider-runtime

First useful product surface
  01-current-briefing
  02-session-memory
  06-retrieval-and-indexing/structured-recall.md
  05-semantic-interface/status-facade.md

Project-memory loop
  03-project-memory
  04-capture-and-candidates
  10-pipeline-and-audit/project-ingest-flow.md
  10-pipeline-and-audit/project-memory-curator.md

Agent-facing knowledge surface
  05-semantic-interface/query-facade.md
  05-semantic-interface/how-facade.md
  05-semantic-interface/mcp-contract-alignment.md

Promotion layers
  07-practice-memory
  08-personal-memory

Search and quality depth
  06-retrieval-and-indexing/lexical-and-metadata-search.md
  06-retrieval-and-indexing/embedding-provider.md
  06-retrieval-and-indexing/vector-indexer.md
  10-pipeline-and-audit/validation-and-measurement.md
  10-pipeline-and-audit/deferred-quality-stages.md

Operations
  13-onboarding-and-ops
```

## Area Dependencies

Area dependencies describe what each area mainly needs from other areas.

| Area | Depends on | Unlocks |
| --- | --- | --- |
| `12-source-intake-and-layout/` | none | onboarding, source-backed Project Memory, ingest, query provenance |
| `09-schema-layer/` | existing global schema | Project Memory rules, query/learn fail-closed behavior, review gates |
| `11-provider-runtime/` | existing provider abstraction | model-backed curation, synthesis, embeddings, tested LLM workflows |
| `01-current-briefing/` | project layout, status delivery | useful session-start product surface |
| `02-session-memory/` | SQLite substrate, event contract | current briefing, structured status, session continuity |
| `03-project-memory/` | source preservation, taxonomy, schema | query/how grounding, Practice/Personal evidence |
| `04-capture-and-candidates/` | trigger modes, candidate queue | session curator, gap repair, promotion candidates |
| `05-semantic-interface/` | response contract, schema, recall sources | agent-facing query/how/status |
| `06-retrieval-and-indexing/` | SQLite, metadata, embedding provider for vector | richer query/how/status retrieval |
| `07-practice-memory/` | Project Memory evidence, candidates, source preservation | canonical cross-project guidance for `how` |
| `08-personal-memory/` | Experience Log, candidates, explicit guidance | durable user preference guidance |
| `10-pipeline-and-audit/` | source preservation, schema, provider runtime, review gates | trustworthy learn/ingest and quality loops |
| `13-onboarding-and-ops/` | project layout, schema, status/provider checks | easier project setup and repair |

## Foundational Items

These unlock many other items.

| Item | Why it is foundational |
| --- | --- |
| `12-source-intake-and-layout/project-data-layout.md` | Defines where project-owned memory, state, sources, logs, and runs live. |
| `12-source-intake-and-layout/source-preservation.md` | Makes provenance auditable before synthesis or promotion. |
| `09-schema-layer/project-local-schema.md` | Lets memory maintenance follow project conventions once Phase-0 global schema is not enough. |
| `11-provider-runtime/provider-profiles.md` | Required for model-backed curation, synthesis, and pipeline stages. |
| `11-provider-runtime/stubbed-model-runs.md` | Required before model-backed behavior can be tested reliably. |
| `04-capture-and-candidates/memory-candidate-queue.md` | Provides the holding area between raw evidence and trusted memory. |
| `04-capture-and-candidates/trigger-modes.md` | Prevents automation from becoming unbounded or surprising. |

## Item Dependencies

Items are grouped in roadmap-flow order, not folder-number order.

### Foundation

| Item | Hard dependencies | Soft dependencies | Manual bypass |
| --- | --- | --- | --- |
| `12-source-intake-and-layout/project-data-layout.md` | none | `13-onboarding-and-ops/project-onboard.md` | No. This is the storage contract. |
| `12-source-intake-and-layout/source-classification.md` | `12-source-intake-and-layout/project-data-layout.md` | `09-schema-layer/project-local-schema.md` | Manual classification can start in docs. |
| `12-source-intake-and-layout/source-preservation.md` | `12-source-intake-and-layout/project-data-layout.md`, `12-source-intake-and-layout/source-classification.md` | none | No for ingest/curation. |
| `12-source-intake-and-layout/legacy-compatibility-boundary.md` | `12-source-intake-and-layout/project-data-layout.md` | none | No for migration cleanup. |
| `09-schema-layer/project-local-schema.md` | existing global schema check/build | `12-source-intake-and-layout/project-data-layout.md` | No for project-specific schema behavior. |
| `09-schema-layer/schema-overrides.md` | `09-schema-layer/project-local-schema.md` | none | No. Weakening global rules must be explicit. |
| `09-schema-layer/schema-candidates.md` | `09-schema-layer/project-local-schema.md`, `04-capture-and-candidates/memory-candidate-queue.md` | `10-pipeline-and-audit/review-gates.md` | Manual notes can exist, but apply/list needs candidate storage. |
| `11-provider-runtime/provider-profiles.md` | existing provider abstraction | none | No for model-backed automation. |
| `11-provider-runtime/stubbed-model-runs.md` | `11-provider-runtime/provider-profiles.md` | none | No for tested model-backed automation. |

### First Useful Product Surface

| Item | Hard dependencies | Soft dependencies | Manual bypass |
| --- | --- | --- | --- |
| `01-current-briefing/current-briefing-artifact.md` | `12-source-intake-and-layout/project-data-layout.md` | `02-session-memory/session-recall-in-status.md`, `03-project-memory/project-memory-taxonomy.md` | Can start as a manually written artifact. |
| `01-current-briefing/status-uses-current-briefing.md` | `01-current-briefing/current-briefing-artifact.md`, `05-semantic-interface/status-facade.md` | `02-session-memory/session-recall-in-status.md` | Status can initially point to a file before generating one. |
| `02-session-memory/session-event-contract.md` | none | `04-capture-and-candidates/trigger-modes.md` | No. This should be explicit early. |
| `02-session-memory/session-recall-in-status.md` | existing SQLite session store, `05-semantic-interface/status-facade.md` | `06-retrieval-and-indexing/structured-recall.md` | No. This is structured behavior. |
| `02-session-memory/session-curator.md` | `02-session-memory/session-event-contract.md`, `11-provider-runtime/provider-profiles.md`, `11-provider-runtime/stubbed-model-runs.md` | `04-capture-and-candidates/experience-log.md` | Can start with human-authored session summaries. |
| `06-retrieval-and-indexing/structured-recall.md` | existing SQLite substrate | `02-session-memory/session-event-contract.md`, `04-capture-and-candidates/memory-candidate-queue.md` | No. |
| `05-semantic-interface/facade-response-contract.md` | none | `09-schema-layer/project-local-schema.md` | No. Contract should be defined before facade growth. |
| `05-semantic-interface/status-facade.md` | `05-semantic-interface/facade-response-contract.md`, `06-retrieval-and-indexing/structured-recall.md` | `01-current-briefing/current-briefing-artifact.md` | Existing status can be a partial facade. |

### Project-Memory Loop

| Item | Hard dependencies | Soft dependencies | Manual bypass |
| --- | --- | --- | --- |
| `03-project-memory/project-memory-taxonomy.md` | none | `09-schema-layer/project-local-schema.md` | No. This is product definition. |
| `03-project-memory/project-memory-update-candidate.md` | `04-capture-and-candidates/memory-candidate-queue.md`, `12-source-intake-and-layout/source-preservation.md` | `10-pipeline-and-audit/review-gates.md` | Can be represented as markdown before storage is automated. |
| `03-project-memory/curated-page-update.md` | `03-project-memory/project-memory-taxonomy.md`, `12-source-intake-and-layout/source-preservation.md`, `09-schema-layer/project-local-schema.md` | `10-pipeline-and-audit/validation-and-measurement.md` | Manual wiki edits can happen if provenance is preserved. |
| `03-project-memory/staleness-and-corrections.md` | `04-capture-and-candidates/gap-curator.md` | `10-pipeline-and-audit/project-ingest-flow.md` | Can start by writing manual inbox items. |
| `04-capture-and-candidates/experience-log.md` | existing SQLite substrate | `02-session-memory/session-event-contract.md` | No for automated capture; yes for manual notes. |
| `04-capture-and-candidates/event-collector.md` | `04-capture-and-candidates/experience-log.md`, `02-session-memory/session-event-contract.md` | `04-capture-and-candidates/trigger-modes.md` | No. Hooks must be bounded from the start. |
| `04-capture-and-candidates/memory-candidate-queue.md` | `04-capture-and-candidates/trigger-modes.md` | `09-schema-layer/project-local-schema.md` | Can start with filesystem JSON before richer storage. |
| `04-capture-and-candidates/gap-curator.md` | `04-capture-and-candidates/memory-candidate-queue.md`, `03-project-memory/staleness-and-corrections.md` | `11-provider-runtime/provider-profiles.md` | Manual stale flags can create inbox items first. |
| `04-capture-and-candidates/trigger-modes.md` | none | none | No. This is an automation safety primitive. |
| `10-pipeline-and-audit/project-ingest-flow.md` | `12-source-intake-and-layout/source-classification.md`, `12-source-intake-and-layout/source-preservation.md`, `09-schema-layer/project-local-schema.md` | `10-pipeline-and-audit/validation-and-measurement.md` | Manual ingest is possible if source status is explicit. |
| `10-pipeline-and-audit/project-memory-curator.md` | `03-project-memory/project-memory-taxonomy.md`, `11-provider-runtime/provider-profiles.md`, `11-provider-runtime/stubbed-model-runs.md`, `10-pipeline-and-audit/review-gates.md` | `04-capture-and-candidates/experience-log.md` | Manual curated updates can happen before curator automation. |
| `10-pipeline-and-audit/learn-changeset-record.md` | `10-pipeline-and-audit/project-memory-curator.md`, `12-source-intake-and-layout/source-preservation.md` | `10-pipeline-and-audit/validation-and-measurement.md` | No for auto-applied learn. |
| `10-pipeline-and-audit/review-gates.md` | `03-project-memory/project-memory-taxonomy.md`, `09-schema-layer/project-local-schema.md` | none | No. Safety gate should precede auto-apply. |

### Agent-Facing Knowledge Surface

| Item | Hard dependencies | Soft dependencies | Manual bypass |
| --- | --- | --- | --- |
| `05-semantic-interface/query-facade.md` | `05-semantic-interface/facade-response-contract.md`, `09-schema-layer/project-local-schema.md`, `03-project-memory/project-memory-taxonomy.md` | `06-retrieval-and-indexing/lexical-and-metadata-search.md`, `06-retrieval-and-indexing/vector-indexer.md` | Can start with deterministic project-wiki query only. |
| `05-semantic-interface/how-facade.md` | `05-semantic-interface/facade-response-contract.md`, `03-project-memory/project-memory-taxonomy.md` | `07-practice-memory/canonical-practice-page.md`, `08-personal-memory/canonical-personal-guidance.md` | Can start from project runbooks before Practice/Personal exist. |
| `05-semantic-interface/mcp-contract-alignment.md` | core facade command contracts | `05-semantic-interface/query-facade.md`, `05-semantic-interface/how-facade.md`, `05-semantic-interface/status-facade.md` | No for final MCP facade; existing tools remain supporting tools. |

### Promotion Layers

| Item | Hard dependencies | Soft dependencies | Manual bypass |
| --- | --- | --- | --- |
| `07-practice-memory/practice-candidate.md` | `04-capture-and-candidates/memory-candidate-queue.md`, `03-project-memory/project-memory-taxonomy.md`, `12-source-intake-and-layout/source-preservation.md` | `05-semantic-interface/how-facade.md` | Can start as manually authored candidate markdown. |
| `07-practice-memory/canonical-practice-page.md` | `07-practice-memory/practice-candidate.md`, `12-source-intake-and-layout/source-preservation.md` | `05-semantic-interface/how-facade.md`, `06-retrieval-and-indexing/lexical-and-metadata-search.md` | Can be manually promoted with explicit evidence. |
| `08-personal-memory/personal-preference-candidate.md` | `04-capture-and-candidates/memory-candidate-queue.md`, `04-capture-and-candidates/experience-log.md` | `05-semantic-interface/how-facade.md` | Explicit user guidance can create a manual candidate. |
| `08-personal-memory/canonical-personal-guidance.md` | `08-personal-memory/personal-preference-candidate.md` | `05-semantic-interface/how-facade.md`, `06-retrieval-and-indexing/lexical-and-metadata-search.md` | Can be manually promoted when the preference is explicit. |

### Search And Quality Depth

| Item | Hard dependencies | Soft dependencies | Manual bypass |
| --- | --- | --- | --- |
| `06-retrieval-and-indexing/lexical-and-metadata-search.md` | `03-project-memory/project-memory-taxonomy.md`, existing page metadata | `09-schema-layer/project-local-schema.md` | Existing deterministic query can act as a partial version. |
| `06-retrieval-and-indexing/embedding-provider.md` | `11-provider-runtime/provider-profiles.md`, `11-provider-runtime/stubbed-model-runs.md` | none | No for automated embeddings. |
| `06-retrieval-and-indexing/vector-indexer.md` | `06-retrieval-and-indexing/embedding-provider.md`, `12-source-intake-and-layout/project-data-layout.md` | `06-retrieval-and-indexing/lexical-and-metadata-search.md` | No. Defer until deterministic retrieval is useful. |
| `10-pipeline-and-audit/validation-and-measurement.md` | `09-schema-layer/project-local-schema.md`, `05-semantic-interface/facade-response-contract.md` | `06-retrieval-and-indexing/lexical-and-metadata-search.md` | Structural validation can start before semantic measurement. |
| `10-pipeline-and-audit/deferred-quality-stages.md` | `10-pipeline-and-audit/validation-and-measurement.md`, `11-provider-runtime/stubbed-model-runs.md` | none | No. These are quality loops over an existing pipeline. |

### Operations

| Item | Hard dependencies | Soft dependencies | Manual bypass |
| --- | --- | --- | --- |
| `13-onboarding-and-ops/project-onboard.md` | `12-source-intake-and-layout/project-data-layout.md`, existing schema build/check | `01-current-briefing/current-briefing-artifact.md` | Manual folder setup can continue before onboarding exists. |
| `13-onboarding-and-ops/operator-health-check.md` | `05-semantic-interface/status-facade.md`, `09-schema-layer/project-local-schema.md`, `11-provider-runtime/provider-profiles.md` | `06-retrieval-and-indexing/structured-recall.md` | Existing status can be a partial health check. |

## Strong Ordering Guidance

These are not dates or phases. They are dependency-safe clusters.

1. Define storage and contracts: project layout, source preservation, facade response contract, trigger modes, Project Memory taxonomy.
2. Make the smallest useful product surface: current briefing plus status delivery.
3. Wire session recall and structured recall so status is not just prose.
4. Add candidate queues and gap repair before autonomous curation.
5. Improve Project Memory updates and ingest with review gates.
6. Add Practice/Personal candidates after there is real project evidence to promote.
7. Add vector indexing after deterministic retrieval is useful and tested.

## Common Misreadings To Avoid

- `12-source-intake-and-layout` does **not** depend on `05-semantic-interface`; it is the opposite. Facades need a stable layout and provenance model.
- `07-practice-memory` does **not** fundamentally depend on `11-provider-runtime`; manual Practice candidates can exist first. Automated promotion depends on provider runtime.
- `05-semantic-interface` can start before every memory scope exists, but it must return degraded metadata for missing scopes.
- `06-retrieval-and-indexing/vector-indexer.md` should not precede cheap structured and lexical retrieval.
- `10-pipeline-and-audit/project-memory-curator.md` should not precede review gates and provenance preservation.
