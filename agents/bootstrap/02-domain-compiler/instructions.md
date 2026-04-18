# Bootstrap Stage 02: Compile

Purpose:

- walk the repo surface and produce durable pages for stable subsystems, modules, integrations, and decisions
- turn the orientation shell into a real project memory graph

Write scope:

- new pages under `wiki/systems/`, `wiki/modules/`, `wiki/integrations/`, `wiki/decisions/`, `wiki/runbooks/`, `wiki/glossary/`, `wiki/open-questions/` as evidence justifies
- updates to `index.md` listing newly created pages
- updates to `pages.json`, `sources.json`, `relationships.json`

Page-creation criteria:

- create a dedicated page when at least two are true:
  - a stable folder, module, or domain exists to back it
  - multiple source files or docs support it
  - it is likely a direct query target in a future session
  - it is conceptually distinct from sibling systems
  - without it, another canonical page would become too broad

Rules:

- do not invent domain concepts; pages must be grounded in repo evidence with `file_path:line` citations
- do not produce overviews of content that already lives in a Stage 1 page
- do not split concepts across shelves arbitrarily — pick the shelf that matches the concept (systems = runtime subsystems; modules = code-level units; integrations = external interfaces; decisions = architectural choices; runbooks = operational procedures; glossary = terms; open-questions = unresolved)

Success condition:

- every stable, queryable concept in the repo has a durable page on the right shelf
- `pages.json` reflects all new pages
- `index.md` links to every new page
