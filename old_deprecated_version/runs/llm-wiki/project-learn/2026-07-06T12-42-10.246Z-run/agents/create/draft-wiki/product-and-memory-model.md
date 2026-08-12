# Product And Memory Model

Myelin is a local-first project memory system for software repositories: it keeps curated project knowledge close to the repo, preserves evidence and provenance, and serves that memory back to coding agents through queryable runtime state.

## Product Purpose

Myelin exists so a new agent session can start from maintained project memory instead of rediscovering the repository from scratch. The product is rooted in the LLM Wiki Pattern: raw sources are preserved, durable knowledge is synthesized into markdown wiki pages, and a schema/instruction layer teaches agents how to maintain that wiki. `README.md` describes the current operator surface as a Bun/TypeScript CLI named `myelin`; `MYELIN.md` is the canonical product design; `CONTEXT.md` is the product-language glossary.

The product is not a generic RAG system, a code summarizer, or a SQLite-first notes database. Myelin captures what code does not cheaply reveal: product behavior, feature intent, operating workflows, decisions, setup gotchas, manual QA flows, current work state, provenance, and known uncertainty. The core operating rule from `MYELIN.md` and `docs/IMPLEMENTATION_ALIGNMENT.md` is: capture cheaply, reason rarely, promote with judgment.

ADR 0050 establishes **Myelin** as the product name and `myelin` as the CLI/config vocabulary. The older `LLM_WIKI_*` environment variables and `mcp__llm-wiki__*` MCP namespace remain compatibility contracts, not current product naming.

## Memory Types

Project Memory is the root memory scope. It is curated per-project knowledge that captures durable facts, behavior, decisions, runbooks, setup, current state, and provenance. In the target layout, it lives under `projects/<key>/wiki/` with supporting metadata/state beside it.

Session Memory is project-scoped continuity: recent work, decisions, findings, next actions, blockers, verification state, and "do not redo this" notes. `CONTEXT.md` says trusted agent-written Session Memory from Experience Log ingest lives in `session_memories`; the older `sessions` and `session_events` tables remain a manual session surface until later current-briefing integration.

Practice Memory is canonical cross-project guidance derived from project evidence. Project examples are provenance, not instructions to copy blindly.

Personal Memory is durable guidance about Liad's working preferences and agent behavior. It is promoted from repeated corrections, observed behavior, or explicit guidance.

Experience Log is raw captured agent activity used as evidence, not truth. It can feed Session Memory, Project Memory updates, and Practice or Personal candidates, but it does not directly repair curated memory.

Memory Candidates are routed proposals for later curation. A candidate targets exactly one scope: Project, Session, Practice, or Personal. ADR 0006 keeps candidate routing fields structured while leaving `payload_json` flexible until real examples prove which scope-specific fields are useful.

## Truth Hierarchy

Myelin separates implementation truth, evidence, curated understanding, and generated serving state.

1. `repo/` is implementation truth. Agents still read code when correctness or verification requires it.
2. `sources/` and Experience Log evidence preserve source material. They are evidence, not synthesized truth, and should not be rewritten during ingestion.
3. `wiki/` is synthesized, human-readable Project Memory. This is the curated truth layer.
4. `state/` and repo-root `state/memory.db` hold machine-readable metadata, routing, provenance, freshness, queues, events, session continuity, embeddings, and retrieval indexes.

The default read path in `MYELIN.md` is `state/`, then `index.md`, then `changelog` or `log/`, then relevant `wiki/` pages, then preserved sources/evidence, then repo files when verification requires them. This is a retrieval priority, not a claim that `state/` is more canonical than markdown; `state/` helps route the agent to the right curated and evidentiary material.

## Curated Markdown Boundary

ADR 0021 is the central boundary: curated Project Memory remains human-readable markdown pages plus metadata JSON. SQLite belongs to serving, recall, session continuity, event capture, queues, and vector metadata until a future design explicitly changes that boundary.

ADR 0067 updates the creation workflow without changing that truth boundary. First-create Project Memory should be agent-authored markdown documentation, not a structured JSON page-curation output. Myelin owns orchestration, write boundaries, artifacts, state, candidate lifecycle, promotion, and derived retrieval state. File-authoring agents write only run-local draft wiki files; Myelin promotes accepted drafts atomically into canonical wiki/state.

This means structured data is allowed for orchestration and lifecycle reports, but it must not become a hidden source of documentation shape. Subject manifests, subject reports, promotion journals, and state metadata can coordinate work; canonical product understanding belongs in curated markdown.

## Candidates And Inbox Boundary

Runtime Durable-Memory Inbox items are source/proposal records submitted by operators, runtime agents, or future tools before curation. The CLI reference says `myelin memory inbox create` writes immutable preserved source JSON under `projects/<project-key>/sources/inbox/` and creates source indexes when needed; it does not create memory candidate rows by itself.

`myelin memory inbox intake <project-key>` deterministically normalizes valid inbox source records into Project Memory candidates without invoking a provider. In the current slice it creates or reuses `memory_candidates` rows with `scope="project"`, `candidate_type="project.inbox"`, and `status="needs_review"`, and it does not rewrite inbox source files.

Top-level `myelin ingest <project-key>` is a different pipeline. It processes queued Experience Log rows into trusted Session Memory, Memory Candidates, layer handoff instructions, and tombstone-backed lease/finalization records. It is not the Project Memory refresh command.

## Serving State Boundary

ADR 0001 puts V2 memory in one repo-root SQLite database at `state/memory.db`, partitioned by `project_key`. That database is generated serving, event, queue, and session substrate. It is not the durable human-reviewable project artifact.

Generated project state under `projects/<key>/state/` includes metadata such as schema context, freshness, routing, provenance, and run state. `README.md` explicitly describes root `state/` as generated SQLite serving state and not curated truth.

ADR 0062 keeps Project Memory retrieval derived from canonical markdown. Structural section metadata can be extracted deterministically from markdown; semantic hints, embeddings, and vector rows are serving state. Retrieval repair belongs in a retrieval-maintenance lane, not in Project Memory candidates, because poor retrieval is not the same problem as incorrect durable knowledge.

Canonical markdown writes can succeed while derived retrieval indexing remains pending. The CLI reflects that with `completed_with_pending_index`: canonical Project Memory writes succeeded, but hint generation or indexing still needs follow-up.

## Product Non-Goals

Myelin should not mirror repository structure or spend tokens summarizing code an agent can read directly. It should not treat SQLite, conversation history, Experience Log rows, retrieval hints, embeddings, or candidates as canonical Project Memory. It should not ingest non-repo content as canonical project memory. It should not make the detached MCP server own product logic; core query behavior lives in the Myelin runtime and is consumed through CLI/JSON contracts.

The durable shape is therefore deliberately narrow: real project work produces evidence; evidence can become Session Memory and candidates; candidates are promoted with judgment into curated markdown; generated state then makes that curated markdown and continuity searchable.
