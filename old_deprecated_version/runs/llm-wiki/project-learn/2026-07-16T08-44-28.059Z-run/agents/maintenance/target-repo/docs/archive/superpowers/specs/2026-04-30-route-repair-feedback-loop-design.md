# Route Repair Feedback Loop Design

## Goal

Close the route-quality loop for project brains: `make measure-routes` identifies bad routes, `make update` repairs the knowledge that caused them, relationship metadata becomes cleaner, and `make status` shows whether the brain is getting easier to traverse.

## Context

The brain-navigation stack now has:

- generated page metadata, tags, aliases, and relationships
- metadata-aware query planning
- route-only MCP discovery tools
- route measurement through `make measure-routes`
- default route-miss gap-note emission, suppressible with `NO_EMIT=1`

The remaining weakness is that route misses are only queued as generic measurement gap notes. The update pipeline can consume them, but it is not explicitly guided to repair routing vocabulary, tags, summaries, and relationships rather than only editing prose pages.

## Product Loop

The intended loop is:

1. Operator runs `make measure-routes PROJECT=<key>`.
2. Route misses and low-confidence routes emit `measure-auto` inbox items.
3. Operator runs `make update PROJECT=<key> AUTO=1`.
4. Ingest recognizes route-repair evidence and proposes targeted page/metadata repairs.
5. Apply regenerates metadata products and dedupes relationship state.
6. Operator runs `make measure-routes PROJECT=<key>` again.
7. `make status PROJECT=<key>` surfaces the latest route health.

## Scope

This design covers three connected features:

- Route repair update loop
- Relationship quality upgrade
- Route evaluation status integration

It intentionally drops MCP route-measurement tools and Obsidian canvas polish.

## Route Gap Contract

Route-measurement inbox items already use `source: "measure-auto"`. Route-repair notes are identified by `operator_notes` JSON containing:

- `failure_reasons`
- `route_confidence`
- `route_reason`
- `expected_page`
- `expected_page_selected`
- `selected_pages`
- `freshness_warning_count`
- `metadata_available`
- `router_prompt_chars`

`failure_reasons` may include:

- `low_route_confidence`
- `expected_page_not_selected`

The update pipeline should treat these as route-repair evidence, not as a normal answer-quality miss.

## Route Repair Behavior

When ingest sees route-repair evidence, it should ask the model for a narrow repair:

- improve route vocabulary through page summaries and linked topics when the question uses terms not represented in metadata
- improve linked topics/domains where the expected page is semantically relevant but not selected
- improve page summaries when the summary does not contain the question vocabulary
- add or strengthen relationships between selected pages and expected pages when traversal should bridge them
- update canonical wiki prose only when the route miss reflects a real documentation gap

Route repair should prefer existing canonical pages. It should not create new pages unless the route miss reveals a durable missing subject and no existing page is the right target.

## Metadata Repair Boundary

Generated metadata products remain owned by application code. Ingest and proposal stages should not hand-edit:

- `state/page-metadata.json`
- `state/tag-index.json`
- `state/alias-index.json`

Instead, repairs should modify canonical wiki/page catalog inputs that feed metadata generation, or relationship state through a validated relationship repair path.

V1 does not add a new canonical alias field. Alias generation currently derives from page title and path, so route repair must not promise direct alias edits. If a route miss is caused by missing vocabulary, V1 repairs should add supported terminology to canonical page content, summaries, or linked topics so regenerated metadata can route more accurately. A future alias-specific feature may add an explicit page alias source-of-truth.

## Relationship Quality Upgrade

Relationship state should become a cleaner traversal input.

V1 relationship repair requirements:

- dedupe exact duplicate edges
- normalize edge keys to `from`, `to`, and `relationship_type`
- reject edges whose endpoints are unknown pages
- preserve allowed legacy edge shapes by normalizing `source`/`target` and `type`
- cap traversal behavior remains in query/MCP layers; state repair does not create broad graph walks

Relationship dedupe should be deterministic. If duplicate edges have different confidence values, keep the highest confidence value using this order:

`high > medium > low > unknown`

If duplicate edges have extra fields, preserve the first deterministic record after sorting by endpoint and relationship type, then apply the best confidence.

## Route Status Integration

`make status PROJECT=<key>` should surface latest route health when `state/latest/route-measurement.json` exists.

Minimum status fields:

- route questions measured
- average route confidence
- expected-page hit count and ratio
- low-confidence route count
- emitted route gap count
- route measurement timestamp

Status should point to `state/latest/route-measurement.md` when route health has misses or low-confidence routes.

Status should not run measurement. It only reads existing stable products.

## Non-Goals

- No MCP changes.
- No Obsidian changes.
- No automatic background update after route measurement.
- No planner scoring overhaul except where relationship dedupe removes duplicate traversal artifacts.
- No direct hand-editing generated metadata shelves.
- No new inbox source value unless the existing schema becomes insufficient.

## Validation

Implementation should prove:

- route-miss `measure-auto` items are classified into a route-repair path
- ingest prompt payload includes route evidence from `operator_notes`
- relationship dedupe is deterministic and removes duplicate edges
- invalid relationship endpoints are dropped from normalized state and counted in a normalization report returned by the helper/tests
- `make status` renders route health when route measurement exists
- `NO_EMIT=1 make measure-routes` still writes stable route products but no inbox items

## Success Criteria

After implementation:

- Running `make measure-routes PROJECT=llm-wiki` can emit actionable route-repair notes.
- Running `make update PROJECT=llm-wiki AUTO=1` consumes those notes through a route-aware repair contract.
- Relationship state no longer carries duplicate edges that confuse neighbor traversal.
- `make status PROJECT=llm-wiki` shows route quality without inspecting JSON manually.
- The core query and MCP surfaces keep using application-owned metadata and relationships.
