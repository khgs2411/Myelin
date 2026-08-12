# Brain Metadata And Relationship Index Design

## Goal

Create the application-owned foundation for cheaper, more accurate brain traversal by defining canonical semantic metadata for project pages and typed relationships between pages, source paths, domains, and entrypoints.

This design covers the first two feature buckets:

1. Semantic brain metadata.
2. Relationship index upgrade.

They are designed together because relationships are only useful when the endpoints have stable metadata, and metadata only becomes a strong routing layer when relationships explain how to traverse it.

## Current Problem

Today the application can route through `pages.json`, `index.md`, and ranking snapshots, but page metadata is too thin for high-quality traversal.

The query path still has to rely heavily on page summaries and body text. Obsidian graph views also show visually similar clusters because pages do not carry enough consistent project, type, domain, status, and relationship information for humans to distinguish them.

## Design Principles

- Application state is canonical.
- Metadata is generated and validated by the application pipeline.
- Operator-owned project config remains separate from generated metadata.
- Markdown pages remain readable brain pages, not metadata dumps.
- Obsidian-facing properties are projections, not the source of truth.
- Query routing should be able to use metadata before reading page bodies.

## Canonical Metadata Model

### Brain Metadata

Each project / brain should expose a canonical metadata record derived from `state/project.json` plus generated state.

Recommended fields:

- `project_key`
- `display_name`
- `repo_paths`
- `brain_tags`
- `primary_domains`
- `entry_pages`
- `freshness_status`
- `last_reviewed_commit`
- `last_update_at`
- `page_count`
- `stale_page_count`
- `open_question_count`

Operator-owned fields continue to live in `state/project.json`. Generated fields should live in application-owned state products.

### Page Metadata

Each page should have a normalized metadata record.

Recommended fields:

- `path`
- `title`
- `project_key`
- `page_kind`
- `domains`
- `topics`
- `aliases`
- `tags`
- `source_paths`
- `freshness_status`
- `confidence`
- `last_verified_at`
- `last_verified_commit`
- `summary`
- `entrypoint_rank`
- `canonical`

### Page Kinds

Use a controlled vocabulary so routing and visualization do not drift:

- `index`
- `architecture`
- `system`
- `module`
- `integration`
- `runbook`
- `decision`
- `session`
- `glossary`
- `open_question`
- `source_reference`

### Tags

Tags should be generated from canonical metadata, not hand-authored prose.

Recommended tag families:

- `project/<key>`
- `kind/<page_kind>`
- `domain/<domain>`
- `status/fresh`
- `status/stale`
- `status/needs-review`
- `role/entrypoint`
- `role/source-backed`
- `role/generated`

Tags should remain Obsidian-compatible: lowercase, no spaces, use `/` for hierarchy.

### Aliases

Aliases should capture terms users and agents may ask for:

- acronyms
- subsystem names
- alternate product names
- class/module/service names when they are durable
- common user-facing phrases

Aliases are useful for both Obsidian unlinked mentions and query routing.

Aliases do not need to be globally unique inside a brain. Ambiguous aliases are allowed, but `alias-index.json` must represent ambiguity explicitly by mapping an alias to multiple candidates and requiring the query planner to lower route confidence or ask the weak model to choose from the candidate set.

## Relationship Index Model

`relationships.json` should become a typed graph over pages and source anchors.

### Node Types

Recommended node types:

- `page`
- `source_path`
- `domain`
- `topic`
- `project`
- `concept`

### Relationship Types

Use explicit relationship types:

- `links_to`
- `related_to`
- `depends_on`
- `documents`
- `implemented_by`
- `source_backed_by`
- `entrypoint_for`
- `supersedes`
- `contradicts`
- `stale_due_to`
- `answers`

### Relationship Record Shape

Each relationship should be traceable and machine-readable:

- `from`
- `from_type`
- `to`
- `to_type`
- `relationship_type`
- `confidence`
- `evidence`
- `created_by`
- `updated_at`

`evidence` should point to page paths, source paths, or state artifacts. Relationships created only by inference should have lower confidence and clear evidence.

## State Placement

Recommended application-owned files:

- `projects/<key>/state/page-metadata.json`
- `projects/<key>/state/relationships.json`
- `projects/<key>/state/tag-index.json`
- `projects/<key>/state/alias-index.json`

`pages.json` can remain the compact catalog used by existing query flow, but it should either include a minimal routing subset or point to `page-metadata.json`.

## Schema Versioning And Backcompat

This feature must be migration-safe for existing brains.

All new generated metadata files should include:

- `schema_version`
- `generated_at`
- `project_key`

Initial version:

- `schema_version: 1`

`pages.json` remains the primary compatibility catalog for existing readers in the first implementation. `page-metadata.json` becomes the richer routing metadata source, but it must not replace `pages.json` until query, MCP, status, and tests are migrated.

### `pages.json` Type Mapping

Current `pages.json` entries use a shelf-derived `type` field. The metadata layer should map that field into normalized `page_kind`.

Initial mapping:

- `index` -> `index`
- `architecture` -> `architecture`
- `systems` -> `system`
- `modules` -> `module`
- `integrations` -> `integration`
- `runbooks` -> `runbook`
- `decisions` -> `decision`
- `sessions` -> `session`
- `glossary` -> `glossary`
- `open-questions` -> `open_question`

Unknown or future shelves should map to `source_reference` only when they are preserved source material; otherwise validation should mark them `needs-review` rather than inventing a kind.

### Legacy Relationships

Existing `relationships.json` entries using `relationship_type: "references"` remain valid during migration.

Initial migration rule:

- Preserve `references` as a legacy relationship type.
- Generate new typed relationships beside existing entries when confidence is high.
- Do not delete or rewrite legacy relationships until validation proves equivalent typed relationships exist.

The controlled vocabulary should therefore include both:

- current typed relationships
- `references` as a legacy-compatible relationship type

### Confidence Scale

Use named confidence levels for generated metadata and relationships:

- `high`
- `medium`
- `low`

Rationale: existing relationship state already uses string confidence values. Numeric confidence can be added later if route scoring needs it, but the first implementation should avoid a dual representation.

## Generation Flow

Metadata generation should be owned by the application pipeline, not MCP or Obsidian.

The first implementation should place generation in `04-apply` after page writes and existing `pages.json` / `relationships.json` updates are complete. That keeps generated metadata synchronized with the files that apply already owns.

Validation should remain in `06-validate`.

Stable publication should happen through the existing stable-products path after validation passes.

The pipeline should:

1. Read current page catalog and changed pages.
2. Extract deterministic metadata from paths, headings, source citations, and state.
3. Ask the model only for semantic fields that cannot be derived deterministically.
4. Normalize tags, aliases, domains, and page kinds.
5. Update relationship records.
6. Validate the result.
7. Publish stable metadata products under `state/latest/` for readers.

### Compile And Update Behavior

Both `make compile` and `make update` should run the same metadata generation path because both flows apply wiki changes.

`make update` should regenerate metadata for affected pages and any relationship neighbors that can be impacted by changed aliases, tags, source paths, or freshness status.

`make compile` may regenerate the whole metadata set because it already represents a full project-brain refresh.

### Reconcile Behavior

Reconcile should treat metadata validation failures like other validation findings:

- if a finding can be repaired by changing wiki/page state, reconcile may propose a patch
- if a finding requires schema migration or operator config changes, stop and surface the finding

Reconcile should not directly mutate `page-metadata.json`, `tag-index.json`, or `alias-index.json`; those files should be regenerated from canonical page and state inputs.

### Stable Products

After validation passes, stable products should include:

- `state/latest/page-metadata.json`
- `state/latest/tag-index.json`
- `state/latest/alias-index.json`
- `state/latest/relationships.json`

These are read surfaces for query, MCP, and Obsidian export. Canonical writable state remains under `state/`.

## Validation Rules

Validation should prevent metadata from becoming decorative or misleading.

Required checks:

- every page has one valid `page_kind`
- every page has `project/<key>` and `kind/<page_kind>` tags
- stale pages expose stale status consistently
- aliases are unique enough to route safely or marked ambiguous
- source-backed pages have source paths
- relationship endpoints exist
- relationship types belong to the controlled vocabulary
- canonical entry pages are represented
- no generated Obsidian-only field is required for query routing

Validator registration should follow the existing structural-validator pattern:

- deterministic checks live in `agents/update/06-validate/structural.py`
- rules are listed in `agents/update/06-validate/config.json`
- `agents/update/06-validate/run.sh` includes the findings in the same validation loop as existing structural rules

## Query Planner Use

The future query planner should be able to:

- resolve aliases before page-body reads
- filter candidate pages by page kind, domain, tag, freshness, and source coverage
- traverse relationships from entry pages to specific modules or runbooks
- avoid stale pages unless the question asks about stale or historical behavior
- return route explanations for debugging

## MCP Use

MCP should later expose this metadata without owning it.

Potential future surfaces:

- list brain metadata
- list page metadata
- search pages by tag/domain/kind
- get page neighbors
- explain a query route
- expose stale pages and open questions

## Obsidian Use

The Obsidian compatibility layer should derive from the same metadata.

Potential projections:

- YAML properties
- nested tags
- aliases
- Bases for stale pages, modules, decisions, and open questions
- graph grouping presets
- canvas maps for high-level architecture

The projection can be regenerated. It should not be manually edited as canonical project knowledge.

Generated Obsidian properties should not be written into canonical wiki pages in the first implementation. They belong in the generated Obsidian projection layer.

## Non-Goals

- No custom Obsidian plugin in this phase.
- No MCP tool implementation in this phase.
- No query planner implementation in this phase.
- No migration of operator-owned config into generated metadata.
- No requirement that every source file becomes a graph node.

## Open Questions

- Which metadata fields should be deterministic-only in the first implementation to avoid LLM drift?
