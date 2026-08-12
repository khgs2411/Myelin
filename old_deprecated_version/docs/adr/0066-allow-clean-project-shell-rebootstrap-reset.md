# Allow clean Project Memory shell rebootstrap reset

For untrusted dogfood or first-create reset, Myelin may explicitly delete and recreate the project shell under `projects/<key>/` while preserving the repo-root SQLite memory database at `state/memory.db`. Project shell files such as wiki pages, project-local state, sources, runs, and retrieval state are replaceable during a clean reset; Session Memory, Memory Candidates, handoffs, Experience Log rows, embeddings, and other root SQLite memory-layer rows keyed by project are preserved unless the operator explicitly asks for a memory wipe.

Considered options: archive existing wiki/retrieval files, keep untrusted markdown as read-only evidence, or selectively adopt useful untrusted sections. We choose clean rebootstrap for the untrusted dogfood/create path because it gives first-create a clean canonical surface without losing the Session Memory and candidate continuity already stored in SQLite.
