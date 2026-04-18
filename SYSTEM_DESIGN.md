# llm-wiki System Design

## Product Thesis

`llm-wiki` is a local-first second-brain system for codebases.

Its job is not just to summarize a repo once. Its job is to compile durable project memory that future agents and humans can query directly instead of re-reading the same code, docs, and plans every session.

## Scope

- `llm-wiki` targets software repositories: services, applications, libraries, games, SDKs, CLI tools, infrastructure.
- Not targeted: personal journaling, research over non-code sources, book companions, trip planning, general-purpose knowledge management.
- The reference "LLM Wiki" pattern covers a broader space; this implementation narrows to repos deliberately, because that is where token savings compound for the primary user.
- Cross-project knowledge that is non-repo (e.g., notes about LLM architecture patterns that apply across projects) is allowed under `concepts/`.

## Core Claim

A useful project wiki must do more than provide orientation.

It must answer questions like:

- what systems exist
- what features exist
- how the folder and runtime surfaces are shaped
- where a specific concept lives
- which page should an agent read before touching code

That means the system has to produce both:

- an orientation layer
- a deep-dive layer

## Mental Model

- repo = implementation truth
- wiki = compiled understanding
- state = machine-readable routing, provenance, and freshness
- raw = incoming source material
- CLI/MCP = operational surface
- editor = browsing and review surface

The repo remains authoritative. The wiki is durable memory built from it.

## Why The Earlier Model Was Not Enough

A broad bootstrap pass can produce:

- project overview
- architecture overview
- runtime topology
- one backend landing page

That is useful, but it is not yet a second brain.

Without durable subsystem and feature pages, future agents still fall back to raw repo reading for most targeted questions. That defeats the purpose.

## Staged Bootstrap Model

`llm-wiki` now treats bootstrap as a staged compiler pipeline.

### 1. Broad Orientation

Purpose:

- establish project framing
- identify source-of-truth areas
- create the smallest useful top-level canonical pages

Typical outputs:

- `index.md`
- one architecture page under `wiki/architecture/` (filename chosen from repo evidence)
- initial state files and a durable bootstrap session note

### 2. Knowledge Compiler

Purpose:

- build the durable project memory graph
- create subsystem, feature, runtime, tech-stack, and decision-candidate pages

This is the stage that turns the wiki from “overview notes” into an actual second brain.

Good outputs look like durable pages for:

- runtime subsystems
- module boundaries
- integration surfaces
- operational runbooks
- architectural decisions

The exact page set should come from repo and doc evidence, not from a fixed hardcoded list.

### 3. Query Expander

Purpose:

- turn major-domain pages into direct lookup pages
- split out stable, likely query targets that are still buried inside broader pages

This is the stage that makes the wiki answerable at the level of concrete systems and features instead of only at the level of major domains.

### 4. Validation

Purpose:

- check structure
- check coverage
- detect overlap
- reject shallow output

Validation should fail if a complex project only gets overview pages or only gets major-domain pages without query-target depth.

### 5. Reconciliation

Purpose:

- fix the validation findings
- split overloaded pages
- create missing required pages
- repair state and index drift

This stage should converge the wiki, not restart it.

## Data Injection Is Core, Not Secondary

The system must support both:

- initial wiki compilation from a repo
- ongoing digestion of new specs, plans, notes, and references

That is why the architecture includes:

- `raw/inbox/`
- `raw/processed/`
- `raw/rejected/`
- project-local inboxes
- preserved `sources/`

This is what allows the wiki to keep improving instead of becoming stale after bootstrap.

## Filesystem-First, Editor-Friendly

The system is still filesystem-first. Obsidian is not the source of truth and should not define the protocol.

But Obsidian is now an active evaluation surface.

That means the generated wiki should be judged not only on technical correctness, but also on:

- readability
- landing-page quality
- page boundaries
- browseability
- graph and navigation quality

The wiki is failing if it validates technically but still feels bad to use in Obsidian.

## Layer Model

### Source Layer

Raw inputs:

- code repos
- docs
- specs
- plans
- notes
- external references

### Compiled Knowledge Layer

Durable markdown pages:

- landing pages
- architecture pages
- subsystem and module pages
- integrations
- runbooks
- sessions
- decisions

### State Layer

Machine-readable support:

- project identity
- page manifests
- source provenance
- relationships
- freshness

### Tooling Layer

Operational interfaces:

- `make init`
- `make bootstrap`
- `make ingest`
- `scripts/validate.sh`
- future MCP surface

### Presentation Layer

Human-facing browsing and review:

- VS Code
- Obsidian

## Success Condition

`llm-wiki` succeeds when a new agent session can start from the wiki, read a handful of durable pages, and answer targeted project questions without broad repo re-reading.

That is the bar for a real second brain. Not “nice summaries.” Not “clean architecture pages.” Durable, queryable project memory.
