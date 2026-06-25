# MemoryInboxCreateCommandShape

Pseudocode artifact. Non-executable reference shape for planning.

## Draft Shape

`memory inbox create` is the write-only producer surface for runtime durable-memory source records.

Intended destination: `src/commands/memory.ts` or a narrow inbox command module.

### Command Grammar

- `myelin memory inbox create <project-key> --layer project --body ...`
- `--file <path>` is deferred out of the first implementation slice.
- `--title`, `--rationale`, `--evidence-ref`, `--confidence`, `--risk`, and `--target-hint` are proposal metadata, not lifecycle controls.
- `--confidence` and `--risk` are required `low | medium | high` values and are part of the default-visible proposal contract.
- No `--status` option is exposed.
- The first write should create or maintain `projects/<key>/sources/index.md` and `projects/<key>/sources/inbox/index.md`.

### Flow

1. Parse the project key and proposal metadata.
2. Validate that `--layer` is `project` in this slice.
3. Build the source-record payload.
4. Assign a stable id and timestamp.
5. Write the runtime inbox source file atomically.
6. Return the created item shape or JSON output for inspection.

### Inputs

- project key
- layer
- body text or future file-backed body source
- proposal metadata
- current time
- creator identity

### Outputs

- created source id
- created path or path hint
- source record summary
- validation or write error

### Terminal States

- `created`
- `invalid_input`
- `unsupported_layer`
- `blocked_path`
- `write_failed`

### Ownership Boundary

This command owns:

- source-record validation
- id generation
- atomic write of the runtime inbox file

This command does not own:

- candidate creation
- queue dedupe
- `project learn`
- packet construction
- curation
- markdown apply

### Failure Posture

- Invalid input must fail before any source file is written.
- Unsafe paths must block.
- Unsupported layers must reject in the first slice.
- Source creation should not mutate candidate rows.
- First-write repair of the `sources/` tree should stay local to the inbox writer, not leak into `project learn`.

### Settled Notes

- The command lives under `memory inbox`, not `project inbox` or `memory candidate`.
- The concrete source path is `projects/<key>/sources/inbox/<id>.json`.
- The first slice accepts project-layer creation only; unsupported layers fail explicitly.
