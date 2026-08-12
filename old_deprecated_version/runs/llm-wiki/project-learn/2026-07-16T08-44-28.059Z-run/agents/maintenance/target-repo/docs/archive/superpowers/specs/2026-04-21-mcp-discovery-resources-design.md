# MCP Discovery Resources Design

## Goal

Make blind MCP discovery against `llm-wiki` useful by exposing a small read-only resource surface in addition to the existing tool surface.

## Scope

Add a discovery-first resource layer to the FastMCP server:

- one static capabilities resource
- one project index resource template
- one stable latest-product resource template
- one wiki-page resource template

Keep all LLM-backed behavior as tools.

## Resource surface

### Static resource

- `llm-wiki://capabilities`

Returns structured discovery metadata:

- server purpose
- available tools
- available resource templates
- recommended call order for generic agents

### Resource templates

- `llm-wiki://project/{project_key}/index`
- `llm-wiki://project/{project_key}/latest/{product}{?format}`
- `llm-wiki://project/{project_key}/page/{page_path*}`

`page_path*` uses FastMCP wildcard URI matching so nested wiki paths remain addressable.

## Semantics

### Project index

Returns the raw markdown content of `projects/<key>/index.md`.

### Latest product

Allowed `product` values:

- `ranking`
- `validation`
- `measurement`
- `ingest`

Allowed `format` values:

- `md` (default)
- `json`

The template maps logical product names to the existing stable files under `projects/<key>/state/latest/`.

### Wiki page

Returns raw markdown for a project-relative page path.

Traversal outside the project directory remains blocked.

## Non-goals

- no LLM-backed resources
- no broad resource dump of all pages
- no replacement of `query_wiki`, `list_wiki_projects`, or `get_wiki_page`

## Validation

Add MCP server tests that prove:

- the capabilities resource is registered
- the three templates are registered
- index/latest/page readers return the expected content
- invalid latest product or format is rejected
- wiki-page traversal remains blocked
