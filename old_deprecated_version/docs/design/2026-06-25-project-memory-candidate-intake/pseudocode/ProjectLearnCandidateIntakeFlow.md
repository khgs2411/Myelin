# ProjectLearnCandidateIntakeFlow

Pseudocode artifact. Non-executable reference shape for planning.

## Draft Shape

`project learn` owns the orchestration boundary. Candidate intake is one pre-packet step in that flow.

### Sequencing

1. Resolve the project and repair the shell if needed.
2. Reuse incomplete apply journals before any new curator work.
3. Run source-consumption reconciliation.
4. Run runtime inbox intake for project-scoped proposal items.
5. Build the Project Memory packet.
6. Invoke the mode-scoped curator.
7. Validate curator output.
8. Apply or stop before writes based on dry-run, review, validation, and risk gates.

### Intake Position

- Intake must happen after source-consumption reconciliation.
- Intake must happen before `buildProjectMemoryPacket`.
- The explicit `memory inbox intake <project-key>` command and `project learn <key>` should both call the same intake unit.
- Intake must not be a separate hidden side effect after packet construction.
- Intake should not require the curator to rediscover runtime inbox source items directly.
- Intake should normalize project inbox items into `needs_review` candidates before packet construction.

### Inputs

- project key
- current time
- project shell and state paths
- runtime inbox source items
- memory DB connection
- project learn flags such as `--dry-run` and `--review`

### Outputs

- intake summary
- candidate ids created or reused
- terminal duplicate ids
- skipped or unsupported source refs
- degraded or blocking reasons
- packet input that includes the normalized candidates

### Terminal States

- `completed`
- `needs_review`
- `failed`
- `blocked`
- `degraded`

### Failure Posture

- Unsafe inbox root or unsafe source path blocks before curator work.
- Missing inbox directory is a noop or degraded result, not a crash.
- Invalid single inbox items should not reach the curator packet.
- Intake should be repeatable without duplicate rows.
- A single malformed item can be skipped while the rest of the intake continues.
- If shell repair is needed to create `sources/` and `sources/inbox/`, that should happen before intake but still after journal recovery.

### Ownership Boundary

`project learn` owns:

- orchestration
- order of operations
- whether intake participates in this run
- recovery before new curator work

The intake service owns:

- normalization
- dedupe
- candidate insertion or reuse
- result aggregation for created, existing, duplicate, skipped, unsupported, and invalid intake rows

The packet builder owns:

- read-only consumption of normalized queue state

The curator owns:

- proposal generation

The applier owns:

- deterministic markdown/state mutation after validation

### Settled Notes

- The explicit `memory inbox intake <project-key>` command is part of this slice and calls the same service as `project learn`.
- Malformed single inbox items are isolated from curator input and reported as degraded; unsafe paths or ambiguous ownership block before curator work.
