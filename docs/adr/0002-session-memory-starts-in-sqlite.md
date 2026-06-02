# Store memory-slice session memory in SQLite before markdown promotion

After the TypeScript runtime foundation exists, Session Memory is canonical in `state/memory.db` for operational continuity. Markdown pages under `projects/<key>/wiki/sessions/` remain curated historical project documentation and are written only through a later project-memory update or promotion flow. This keeps "what did we do last session?" immediate and cheap while preventing every session from automatically becoming durable wiki prose.
