# Allow runtime layout redesign during the TypeScript migration

The TypeScript migration is a major refactor, not a small parity-only port. The current Python/Bash directory structure is a reference for behavior, not a constraint on the new runtime shape. The migration may redesign core code and data layout for pipeline stages, runtime modules, schemas, and generated artifacts when the new layout has a clear purpose, preserves project knowledge and provenance, and includes migration or compatibility handling for existing data that still matters.
