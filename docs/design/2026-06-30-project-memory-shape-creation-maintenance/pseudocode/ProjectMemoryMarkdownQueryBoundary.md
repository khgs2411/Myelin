# ProjectMemoryMarkdownQueryBoundary

Pseudocode artifact. Non-executable reference shape for planning.

## Intended Destination

Likely touches:

- `src/query/memory-query-service.ts`
- `src/query/engine.ts`
- `src/commands/memory.ts`
- `src/memory/project-memory-retrieval-storage.ts`
- `src/memory/sqlite-vec.ts`
- `src/project/project-memory-markdown-sections.ts`

## Owns

- Project Memory query return shape for markdown-backed retrieval.
- Layer distinction between Session Memory row retrieval and Project Memory markdown retrieval.
- Content-or-reference response behavior.

## Does Not Own

- Session Memory query matching semantics.
- Answer synthesis with an LLM.
- Retrieval hint generation.
- Canonical markdown authoring.
- Candidate promotion.

## Current Implementation Boundary

Today `memory query` uses `MemoryQueryService` to query Session Memory vectors and returns trusted SQLite Session Memory rows. Project Memory retrieval rows already exist as derived pointers into markdown, but they are not yet the query facade's source for Project Memory answers.

The target shape adds Project Memory as a markdown-backed retrieval layer without making Project Memory rows canonical memory.

## Input Shape

Conceptual query input:

```text
memory_query:
  project_key
  question
  limit
  include_route/debug
  branch?                 # applies to Session Memory where relevant
  layers?: session | project | auto
  project_memory_return:
    max_inline_chars
    prefer_section_first: true
```

## Project Memory Layer Flow

1. Normalize question.
2. Embed question with retrieval-query contract.
3. Search Project Memory retrieval vector rows for the project.
4. Rank hits by vector distance plus structural metadata and hint freshness.
5. For each hit:
   - resolve retrieval row to canonical `wiki_path` and `section_id`;
   - verify section hash still matches current markdown;
   - read canonical markdown section/page from disk;
   - if section text is under `max_inline_chars`, return content;
   - if too large or stale, return canonical reference with reason.
6. Report degraded state if vector table, embeddings, retrieval rows, or markdown resolution are unavailable.

## Output Shape

Conceptual response extension:

```text
query_response:
  answer: deterministic text summary or "Project Memory matches found"
  confidence
  memory_scope: project_memory | session_memory | mixed | none
  citations:
    - project_memory:wiki/path.md#section_id
  project_memory_matches:
    - wiki_path
      section_id
      heading_path
      return_kind: inline_content | reference
      content?              # only when under threshold
      reference_reason?     # too_large | stale_hash | missing_markdown | degraded
      score
      source_tools
  layers:
    - layer: project_memory
      degraded
      degraded_reason
      indexed_count
      stale_count
      match_count
```

## Layer Relationship

- Session Memory layer returns trusted SQLite memory rows directly.
- Project Memory layer returns canonical markdown content or refs resolved from derived retrieval rows.
- Mixed query facade may route across both later, but each layer must preserve its own truth source.

## Terminal Outcomes

- `matches_inline`: one or more markdown sections returned inline.
- `matches_reference_only`: one or more hits found, but content too large or policy says refs only.
- `no_matches`: retrieval available but no relevant Project Memory sections.
- `degraded`: retrieval unavailable, stale, or cannot resolve rows to markdown.

## Idempotency And Freshness

- Query may cache query embeddings.
- Query must not write canonical Project Memory.
- Query may enqueue retrieval maintenance feedback only through the retrieval maintenance queue, not through Project Memory candidates unless user/tool explicitly asks to curate content.
- Stale retrieval row hashes must resolve to degraded/reference outcome, not stale content.

## Failure Posture

- Missing markdown wins over SQLite row: return degraded/stale ref, not row text.
- Too-large markdown returns refs rather than truncating silently.
- Missing Project Memory index should not fall back to treating Session Memory as Project Memory.

## Review Points

- Planning should choose exact `max_inline_chars` and whether it is configurable.
- Planning should decide whether this is a new command mode, a new layer inside `memory query`, or an MCP-only query path first.
- Planning should decide whether mixed Session+Project results are in the first slice or deferred.
