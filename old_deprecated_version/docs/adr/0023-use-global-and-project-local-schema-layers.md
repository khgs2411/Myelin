# Use global and project-local schema layers

LLM Wiki V2 uses a global schema/instructions layer plus project-local schemas. The global schema defines product-wide rules, command vocabulary, source handling, provenance, review gates, and memory-scope semantics. Project-local schemas specialize those rules for domain conventions, workflow preferences, project vocabulary, and maintenance rules. Project schemas should not duplicate global rules unless they intentionally override or narrow them.
