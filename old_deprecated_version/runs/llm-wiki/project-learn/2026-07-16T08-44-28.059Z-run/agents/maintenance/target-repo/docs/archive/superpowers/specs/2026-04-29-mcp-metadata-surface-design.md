# MCP Metadata Surface Design

## Goal

Expose application-owned brain metadata, relationships, and query route explanations through MCP so agents can inspect and traverse a project brain cheaply before asking broad questions.

## Position In The Stack

MCP consumes:

- brain metadata
- page metadata
- relationship index
- query planner route outputs
- existing gap and stale-answer workflows

MCP does not own metadata generation, relationship inference, query planning, freshness policy, or validation.

## Current Problem

The MCP surface already provides useful tools and resources, but the main read path is still centered on asking a question or reading a page.

Agents need a cheaper discovery path:

- What brains exist?
- What domains does this brain cover?
- Which pages are canonical entrypoints?
- Which pages are stale?
- Which tags and aliases exist?
- Why did a query route to these pages?

Without that surface, agents either call `query_wiki` immediately or inspect raw pages manually.

## Resource Strategy

Use resources for cheap, read-only, structured facts.

Recommended resource templates:

- `llm-wiki://project/{project_key}/metadata`
- `llm-wiki://project/{project_key}/pages`
- `llm-wiki://project/{project_key}/tags`
- `llm-wiki://project/{project_key}/aliases`
- `llm-wiki://project/{project_key}/relationships`
- `llm-wiki://project/{project_key}/map`

Resources should read application state directly.

Default resource responses should be JSON because agents consume them as routing inputs. Markdown views can be added through an explicit `format=md` parameter or a separate latest-product style resource when human terminal readability matters.

The first pass should expose per-brain metadata only. Cross-brain aggregate metadata can be added later after per-brain contracts stabilize.

## Tool Strategy

Use tools when input parameters or dynamic decisions are needed.

Recommended tools:

- `list_brain_pages(project_key, kind=None, tag=None, domain=None, freshness=None)`
- `find_brain_pages(project_key, query, limit=None)`
- `get_page_neighbors(project_key, page_path, relationship_type=None, depth=1)`
- `plan_query(project_key, question, debug=False)`

Existing tools remain:

- `query_wiki`
- `get_wiki_page`
- `list_wiki_projects`
- `enrich_gap`
- `flag_stale_answer`
- `create_inbox_item`

## `query_wiki` Evolution

`query_wiki` should eventually include planner metadata in its response.

Always-returned additional response fields:

- `route_confidence`
- `selected_pages`
- `freshness_warnings`

Debug-only fields, available through `plan_query(debug=True)` or an explicit debug mode:

- `matched_aliases`
- `matched_tags`
- `matched_domains`
- `candidate_pages`
- `excluded_pages`
- `relationship_hops`
- `route_reason`
- per-candidate scores

The existing answer-last response ordering should remain so terminal usage stays readable.

Backward compatibility rule: existing fields keep their names and ordering semantics. New metadata fields are additive and appear before `answer`.

`plan_query` is the first dedicated route-inspection tool. A separate `explain_query_route` tool is deferred unless the structured route object proves too hard for humans to read.

## Read Flow For Agents

Recommended MCP guidance:

1. `list_wiki_projects`
2. project metadata resource
3. `plan_query` or `query_wiki`
4. `get_wiki_page` only for selected pages
5. `enrich_gap` or `flag_stale_answer` when verified context shows a miss

The capabilities resource should advertise this flow.

## Human Debugging Use

The MCP metadata surface should help a human understand the brain:

- list stale pages
- list unaliased pages
- list orphan pages
- list entrypoints
- show page neighborhoods
- inspect why a query routed where it did through `plan_query(debug=True)`

This supports review and trust in the routing layer.

## Boundary Rules

- MCP reads application state; it does not repair state.
- MCP may write inbox items through existing correction flows.
- MCP route explanations must come from the application planner.
- MCP resources should not perform LLM calls.
- MCP tools that call the planner may use LLM-backed planning only through application code.

## Error Handling

MCP should distinguish:

- project not found
- metadata not generated yet
- metadata stale
- route planner unavailable
- ambiguous alias
- invalid page path

Errors should tell the caller which application command or workflow can refresh the brain when appropriate.

## Validation

Add MCP tests that prove:

- metadata resources are registered
- page/tag/alias resources read generated state
- relationship resource blocks traversal outside the project
- tools filter pages by kind/tag/domain/freshness
- route explanation delegates to application planner
- missing metadata returns a clear degraded response

## Non-Goals

- No MCP-side metadata generation.
- No direct MCP mutation of page metadata.
- No broad dump of every page body through a single metadata call.
- No Obsidian-specific logic in MCP.
- No replacement of existing correction tools.

## Open Questions

No open MCP contract questions remain for the first planning pass.
