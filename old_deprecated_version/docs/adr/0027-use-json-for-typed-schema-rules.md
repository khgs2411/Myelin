# Use JSON for typed schema rules

Typed schema rules use JSON. Markdown remains the format for prose guidance. JSON is easier to validate deterministically in TypeScript, avoids YAML parsing ambiguity, and aligns with generated `schema-context.json`. YAML should not be used for typed schema rules by default unless a later design identifies a strong authoring need that outweighs deterministic validation simplicity.
