# Project Memory Index

Project Memory orientation and product model

## Overview

Project Memory in Myelin is the repository documentation layer: curated markdown under projects/<key>/wiki that future agents can read before rediscovering the codebase.

Session Memory is separate continuity from captured conversations; it can produce candidates and handoffs, but those records are leads until project learn verifies repo evidence.

Canonical Project Memory truth stays in markdown plus project state, while SQLite and vector rows are serving indexes that point back to current markdown sections.

Provenance:

- Evidence: repo_citation:MYELIN.md
- Evidence: repo_citation:MY_VISION.md
- Repo: MYELIN.md:1 - product model
- Repo: MY_VISION.md:1 - user product vision

## Operational Details

The create path starts with project learn, writes input-packet.json and project-memory-evidence-map.json, asks the curator for sectioned pages, validates rendered markdown, then applies only trusted output.

The index page should orient an agent to the major answer domains: product model, storage and retrieval, command workflows, curation and apply lifecycle, evidence boundaries, and current roadmap decisions.

A useful page names the actual commands and artifacts, including memory query, memory index project, curator-validation.json, retrieval sections, and the project-memory changeset.

Provenance:

- Evidence: repo_citation:MYELIN.md
- Evidence: repo_citation:MY_VISION.md
- Repo: MYELIN.md:1 - product model
- Repo: MY_VISION.md:1 - user product vision

## Evidence And Boundaries

MYELIN.md, MY_VISION.md, README.md, AGENTS.md, docs/ROADMAP.md, and ADRs are durable sources for the product shape and repository operating contract.

Candidates, handoffs, and Session Memory should be cited as source leads only; durable claims need repo docs, source files, tests, or ADR evidence.

The boundary prevents a conversation summary from silently becoming documentation without the target repository being inspected from its own cwd.

Provenance:

- Evidence: repo_citation:MYELIN.md
- Evidence: repo_citation:MY_VISION.md
- Repo: MYELIN.md:1 - product model
- Repo: MY_VISION.md:1 - user product vision

Page provenance:

- Evidence: repo_citation:MYELIN.md
- Evidence: repo_citation:MY_VISION.md
- Repo: MYELIN.md:1 - product model
- Repo: MY_VISION.md:1 - user product vision
