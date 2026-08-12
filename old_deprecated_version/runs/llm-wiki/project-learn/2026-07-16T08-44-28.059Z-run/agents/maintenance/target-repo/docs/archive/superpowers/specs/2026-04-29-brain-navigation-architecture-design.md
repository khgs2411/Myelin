# Brain Navigation Architecture Design

## Goal

Make `llm-wiki` a structured navigation layer for software-repository brains: expensive compile/update stages build high-quality project knowledge, while cheaper query surfaces traverse that knowledge with minimal token waste.

## Shared Language

- **Application**: this repository, `/Users/liadgoren/Repositories/llm-wiki`.
- **Project / brain**: one maintained knowledge base under `projects/<key>/`.
- **MCP**: the external access layer that exposes application-owned state and workflows to agents.

## Product Thesis

The application is not just a Markdown documentation generator. It is a local, file-backed routing layer for intelligence.

The intended loop is:

1. Compile/update stages read repo truth and maintain each brain.
2. Application state indexes what the brain knows, how fresh it is, and where proof lives.
3. Query surfaces use the index before reading page bodies or source files.
4. Low-confidence, stale, or wrong answers feed gap notes back into update.
5. Human-facing tools such as Obsidian visualize the same structure without becoming the source of truth.

## Layer Boundaries

### Application

The application owns canonical intelligence:

- project identity and operator-owned config
- page catalogs
- semantic metadata
- relationship indexes
- source provenance
- freshness status
- query planning and route selection
- validation rules for generated brain structure

The application may export compatibility formats for humans and tools, but generated exports must remain projections of application state.

### MCP

MCP exposes application intelligence. It does not own or infer canonical brain structure.

MCP responsibilities:

- list available brains
- expose brain metadata and maps
- run query flows through application-owned planners
- return route explanations for agent debugging
- submit gap, stale-answer, and enrichment items into application-owned inboxes

MCP should be powerful because the application is powerful, not because MCP duplicates application logic.

### Obsidian

Obsidian visualizes application intelligence for humans.

Obsidian-facing metadata should improve:

- graph legibility
- search and filtering
- onboarding
- stale/fresh awareness
- project and page-type distinction

Obsidian properties, tags, Bases, graph groups, and canvases should be generated from application state. They are not canonical unless a future design explicitly promotes a field into application-owned state.

## Feature Stack

### 1. Semantic Brain Metadata

Define a canonical metadata model for brains and pages.

This is the base layer for every other feature. Without it, query planning, MCP filtering, and Obsidian visualization all invent their own language.

### 2. Relationship Index

Upgrade `relationships.json` from a loose graph into typed, validated relationships.

The relationship index describes how pages, source paths, domains, decisions, and entrypoints connect.

### 3. Query Planner

Add a metadata-first planner before page-body synthesis.

The planner should reduce token use by selecting candidate pages from metadata and relationships before the weak model reads Markdown bodies.

### 4. MCP Metadata Surface

Expose application-owned metadata, relationships, and route explanations through tools and resources.

The goal is to let agents inspect the brain structure cheaply before they ask broad questions.

### 5. Obsidian Compatibility Layer

Generate human-facing vault metadata and views:

- tags
- aliases
- properties
- Bases
- graph grouping guidance
- optional canvas maps

This layer should make the brain visually navigable without polluting application truth.

## Architectural Invariants

- The application owns canonical state.
- MCP never becomes a second implementation of query planning.
- Obsidian never becomes the source of truth for generated brain metadata.
- Query flows inspect metadata before loading page bodies when possible.
- Source provenance remains traceable from any meaningful answer.
- Freshness is part of routing, not only a status report.
- Human navigation and AI routing should consume the same metadata vocabulary.
- Generated metadata must be validated, not trusted because it was produced by an LLM.

## Expected Benefits

### Token Reduction

Agents can route through metadata and relationships before reading large page bodies or repo files.

### Better Answers

The query surface can distinguish fresh, stale, canonical, related, and source-backed pages before synthesis.

### Self-Improving Brain

Route misses and low-confidence answers become structured maintenance work instead of one-off chat corrections.

### Human Readability

Obsidian can show project boundaries, page types, domains, stale areas, and hubs instead of identical graph clusters.

## Non-Goals

- Do not implement a custom Obsidian plugin in the first pass.
- Do not make MCP mutate canonical metadata directly.
- Do not require Obsidian for the application to work.
- Do not move operator-owned project config into generated frontmatter.
- Do not replace wiki pages with a database-only model.

## Design Sequence

Design and implementation should proceed in this order:

1. Brain metadata schema.
2. Relationship index upgrade.
3. Query planner.
4. MCP metadata surface.
5. Obsidian compatibility layer.

Specs can be designed as a set, but implementation should land iteratively so each layer proves value before the next depends on it.
