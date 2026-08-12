# Use learn, ingest, query, and session CLI verbs

V2 CLI commands should use product-language verbs instead of V1 pipeline mechanics. `project learn <key>` replaces broad `compile` semantics by refreshing Project Memory from evidence. `project ingest <key>` replaces narrow `update` semantics by processing queued source or inbox material. `memory query <key> "<question>"` replaces `ask`, and `session close <key>` records continuity and next actions. These verbs are provisional but should guide the TypeScript migration unless implementation reveals a clearer vocabulary.
