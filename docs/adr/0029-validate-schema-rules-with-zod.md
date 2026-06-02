# Validate schema rules with Zod

Hand-authored schema JSON should be validated with Zod validators in TypeScript. Zod keeps runtime validation close to the implementation and provides inferred TypeScript types for schema-rule consumers. JSON Schema export can be added later if external tooling needs it, but JSON Schema is not the primary validator in this slice.
