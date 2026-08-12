# Obsidian Compatibility Layer Design

## Goal

Generate Obsidian-friendly projections of application-owned brain metadata so humans can visually browse, filter, and understand project brains without making Obsidian the canonical source of truth.

## Position In The Stack

The Obsidian compatibility layer consumes:

- brain metadata
- page metadata
- relationship index
- freshness state
- optional query/planner route products

It should not define canonical metadata fields. It renders application state into Obsidian conventions.

## Current Problem

Obsidian graph views currently show similar-looking clusters. A human cannot reliably tell which project, page type, freshness state, or domain a cluster represents from the graph alone.

The wiki is readable as Markdown, but it does not yet use Obsidian-native affordances such as structured properties, nested tags, aliases, Bases, graph groups, or canvases.

## Design Principle

Obsidian support is an export/projection layer.

Canonical truth remains in:

- `projects/<key>/state/*.json`
- project wiki pages
- source provenance
- freshness state

Generated Obsidian metadata can be regenerated and should not be manually edited as project truth.

## Projection Options

### Option A: Write Properties Into Canonical Pages

Add YAML properties directly to project wiki pages.

Benefits:

- Obsidian works immediately.
- Tags and aliases live on the page users read.
- Graph and property views become richer with no duplicate files.

Costs:

- Conflicts with the current wiki-writing rule that page bodies should not include YAML frontmatter.
- Risks mixing UI metadata with LLM-facing Markdown.
- Harder to regenerate safely if humans edit properties.

### Option B: Generate An Obsidian Export View

Create a separate generated vault/projection for Obsidian consumption.

Benefits:

- Keeps canonical wiki pages clean.
- Allows richer Obsidian-specific files.
- Safe to regenerate.
- Can include `.base`, `.canvas`, and view helper files.

Costs:

- Humans may need to open the export path instead of the raw project folder.
- Links must map cleanly back to canonical pages.
- Additional sync/export command is needed.

### Recommendation

Start with Option B.

Keep canonical pages clean and generate an Obsidian projection from application state. Revisit direct frontmatter only if the projection creates too much friction.

## Obsidian Properties

Generated page properties should include:

- `project`
- `brain`
- `kind`
- `domains`
- `topics`
- `tags`
- `aliases`
- `freshness`
- `canonical`
- `source_paths`
- `last_verified_commit`
- `last_verified_at`

Properties should be compact and machine-readable. Long provenance remains in application state and page content.

## Tags

Use nested tags generated from metadata:

- `#project/<key>`
- `#kind/<page_kind>`
- `#domain/<domain>`
- `#status/fresh`
- `#status/stale`
- `#status/needs-review`
- `#role/entrypoint`
- `#role/source-backed`

These tags help both graph coloring and Obsidian search.

## Aliases

Generate aliases for canonical pages:

- acronyms
- subsystem names
- common user phrases
- durable class/service names
- alternate product names

Aliases improve Obsidian link suggestions, unlinked mentions, and human recall.

## Bases

Generate Obsidian Bases for common human workflows:

- all pages by kind and domain
- stale pages
- open questions
- source-backed pages
- runbooks
- decisions
- entrypoints

Bases should be generated files. They should not be required by the application.

## Graph Support

Generate guidance or helper files for graph grouping:

- project groups
- page-kind groups
- freshness groups
- domain groups

If Obsidian configuration cannot be safely generated, provide documented group search filters that users can paste into graph settings.

## Canvas Maps

Optional generated canvases can show high-level architecture:

- project entrypoint
- major domains
- architecture/system/module pages
- stale or open-question nodes

Canvas maps should be onboarding aids, not complete graphs.

The first pass should include wiki pages only. Source files may appear as metadata on page cards, but they should not become graph/canvas nodes until the relationship model proves source-node traversal is useful.

## Export Layout

Recommended generated path:

- `projects/<key>/obsidian/`

Possible structure:

- `pages/` projected Markdown pages
- `bases/` generated `.base` files
- `canvas/` generated `.canvas` maps
- `README.md` with usage notes

The export should preserve links back to canonical wiki paths where possible.

## Export Lifecycle

Obsidian exports are generated on demand.

Initial policy:

- exports are not required for compile/update
- exports are not canonical brain state
- exports should be ignored by default unless the operator explicitly opts into committing them
- export validation runs as part of the export command, not normal brain validation

Rationale: the application and MCP should not depend on human visualization artifacts. Keeping exports generated and ignorable prevents Obsidian-specific files from polluting normal wiki maintenance.

If a future project wants committed Obsidian artifacts, that should be a per-brain operator setting rather than the default.

## Application Commands

Future commands may include:

- `make obsidian PROJECT=<key>`
- `make obsidian-all`

These commands generate projections only. They do not alter canonical brain truth.

## MCP Interaction

MCP does not need Obsidian-specific tools in the first pass.

MCP may expose the same metadata that powers Obsidian, but Obsidian export remains application-owned.

## Validation

Validation should check:

- generated tags are Obsidian-compatible
- aliases are lists
- projected pages map back to canonical pages
- Bases syntax is valid YAML
- canvas JSON is valid when generated
- stale/fresh properties match application freshness state

These checks belong to the export command. Normal compile/update validation should only check the application-owned metadata that the export consumes.

## Non-Goals

- No custom Obsidian plugin.
- No manual editing workflow for generated projection files.
- No requirement that agents read Obsidian projection files.
- No replacement of canonical wiki pages.
- No graph layout guarantee in the first pass.

## Open Questions

- How should links from projected pages back to canonical wiki files be represented?
