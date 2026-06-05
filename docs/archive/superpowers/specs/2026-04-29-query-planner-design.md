# Query Planner Design

## Goal

Add an application-owned query planner that reduces token use and improves answer consistency by routing through brain metadata and relationships before loading Markdown page bodies or repo source files.

## Position In The Stack

The query planner depends on:

- brain metadata
- page metadata
- typed relationships
- freshness state
- existing query router and synthesizer contracts

It becomes the application-owned read-side brain traversal layer. MCP may expose it, but MCP does not own it.

## Current Problem

The current query path reads the page catalog, index, and ranking snapshot, then asks a weak model router to choose pages. This is useful, but still text-heavy and underspecified:

- aliases are not resolved before routing
- page type and domain filters are limited
- freshness is not a first-class routing constraint
- relationship traversal is not explicit
- users and agents cannot inspect why a route was selected

## Planner Responsibilities

The planner should turn a user question into a structured route plan before synthesis.

Responsibilities:

- resolve project / brain scope
- normalize query terms
- match aliases and canonical topics
- select candidate pages from metadata
- expand candidates through typed relationships
- score freshness and source coverage
- choose the smallest useful page set
- explain the route in machine-readable form

## Planner Inputs

Recommended inputs:

- `project_key`
- `question`
- `raw` mode flag
- `page-metadata.json`
- `relationships.json`
- `tag-index.json`
- `alias-index.json`
- `freshness.json`
- `pages.json`
- `state/latest/ranking-snapshot.json`

The planner should not require source file reads. Source files are only consulted later when verification or enrichment requires repo truth.

## Planner Output

The planner should produce a route object:

- `question`
- `project_key`
- `normalized_terms`
- `matched_aliases`
- `matched_tags`
- `matched_domains`
- `candidate_pages`
- `selected_pages`
- `excluded_pages`
- `relationship_hops`
- `freshness_warnings`
- `route_confidence`
- `route_reason`
- `debug`

`selected_pages` should include enough metadata for downstream synthesis:

- `path`
- `title`
- `page_kind`
- `domains`
- `freshness_status`
- `selection_reason`
- `score`

## Stable Query Contract

`query_wiki` and the application query API should preserve the current answer-last response shape while adding route metadata before the answer.

Always-returned fields:

- `confidence`
- `route_confidence`
- `pages_read`
- `pages_considered`
- `selected_pages`
- `freshness_warnings`
- `router_model`
- `synthesizer_model`
- `tokens_consumed`
- `emitted_gap_id`
- `citations`
- `answer`

`answer` remains last for terminal readability.

Debug-only fields:

- `candidate_pages`
- `excluded_pages`
- `relationship_hops`
- `matched_aliases`
- `matched_tags`
- `matched_domains`
- `route_reason`
- per-candidate scores

Backward compatibility rule: existing callers that read `confidence`, `pages_read`, `citations`, and `answer` must continue to work.

## Routing Strategy

### Phase 1: Deterministic Narrowing

Use metadata indexes before any model call:

1. Resolve aliases.
2. Match domains and tags.
3. Prefer entry pages when the question is broad.
4. Prefer source-backed pages when the question asks how something works.
5. Penalize stale pages unless the question asks about stale state.

### Phase 2: Relationship Expansion

Use typed relationships to expand the candidate set:

- from architecture page to related modules
- from module page to source-backed paths
- from decision page to superseded or contradicted pages
- from stale page to impacted pages
- from open question to pages that partially answer it

Expansion should be bounded. The planner should avoid graph walks that recreate broad repo scans inside the brain.

### Phase 3: Weak-Model Selection

Only after deterministic narrowing should a weak model choose between close candidates.

The weak model should receive:

- the original question
- compact page metadata
- relationship hints
- freshness warnings
- a page limit

It should not receive full page bodies until after page selection.

### Phase 4: Synthesis

The existing synthesizer can remain page-body grounded, but it should receive planner context so it knows:

- why pages were selected
- whether any page is stale
- whether important aliases were ambiguous
- whether route confidence is weak

## Confidence Semantics

Separate route confidence from answer confidence.

- **Route confidence**: did the planner find the right page set?
- **Answer confidence**: did the synthesizer answer well from those pages?

Low route confidence should trigger a gap note even if the synthesizer writes plausible prose.

## Stale Handling

Freshness should affect routing.

Rules:

- Fresh canonical pages are preferred.
- Stale pages can be selected, but the route must include a freshness warning.
- If all relevant pages are stale, the answer should say so and suggest compile/update.
- If a stale page contradicts a fresh page, fresh wins unless the question is historical.

## Query Modes

Recommended planner modes:

- `answer`: current default behavior, route then synthesize.
- `raw`: route and return selected page bodies.
- `route`: return route plan only, no page bodies.
- `debug`: return route plan plus candidate scoring.

`route` and `debug` are especially useful for MCP and development workflows.

Mode behavior:

- `answer` returns the stable query contract with synthesized answer.
- `raw` returns the stable query contract plus `pages_content`, with `answer` empty and `synthesizer_model` null.
- `route` returns planner metadata only and does not invoke the synthesizer.
- `debug` includes debug-only fields and may be noisier; it is not the default MCP response.

Low route confidence and low answer confidence should be tracked separately. A gap note should record which confidence failed so ingest can distinguish missing routing metadata from missing page content.

Gap-note emission should distinguish:

- `route_confidence_low`: the planner could not find a strong page set
- `answer_confidence_low`: the synthesizer could not answer well from selected pages

Both may occur on one query, but they are different maintenance signals.

## Token Budget Rules

The planner should target the smallest useful context.

Initial limits:

- page metadata can be broad
- page bodies should remain limited
- relationship expansion should have a hop limit
- source file reads remain outside normal query flow

The goal is to avoid replacing codebase scanning with full-brain scanning.

## MCP Exposure

MCP can later expose planner outputs through:

- `plan_query`
- extra fields on `query_wiki`
- route-only resources

The underlying planner remains application-owned.

`plan_query` should be the first public route-only tool. `explain_query_route` can be deferred unless human wording proves more useful than returning the structured route object.

Route-only mode should also be exposed through the application CLI after the planner exists, but it is not required for the first metadata/relationship implementation.

## Validation

Planner behavior should be tested against fixture brains:

- broad question routes to entry pages
- specific alias routes to canonical page
- stale page emits warning
- ambiguous alias returns multiple candidates or low route confidence
- unrelated question returns low confidence and emits a gap
- raw mode skips synthesis but still returns planner metadata

## Non-Goals

- No vector database in this design.
- No source-code search in normal query planning.
- No MCP-owned planner logic.
- No replacement of gap-note workflows.
- No guarantee that planner confidence equals factual correctness.

## Open Questions

- What is the default max relationship hop count?
