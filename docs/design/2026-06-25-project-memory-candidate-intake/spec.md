# Runtime Durable Memory Candidate Inbox Design

Status: Design finalized. Ready for implementation planning after user review.

## Goal

Add the V2 runtime durable-memory inbox and Project Memory intake boundary.

The feature gives operators, runtime agents, and future tools an explicit way to
propose durable memory outside the automated Session Memory ingest path:

```text
Runtime CLI / runtime agent / future tool
  -> runtime durable-memory inbox item
  -> candidate intake
  -> memory_candidates
  -> project learn
  -> durable Project Memory
```

Session Memory remains a separate automated producer:

```text
Experience Log ingest / auto-maintenance
  -> session-derived candidate or handoff
  -> memory_candidates / handoff tables
  -> project learn
  -> durable Project Memory
```

## Current Context

- `project learn <key>` is the authoritative Project Memory command.
- `ProjectMemoryCuratorService.runProjectLearn` already performs apply recovery,
  source-consumption reconciliation, packet construction, curator invocation,
  validation, and deterministic markdown apply.
- `buildProjectMemoryPacket` already reads pending and needs-review
  `scope="project"` candidates from root SQLite `memory_candidates`.
- `src/memory/candidates.ts` owns candidate row insertion, listing, and lifecycle
  helpers.
- `memory candidates` and `memory candidate show` already expose candidate
  inspection.
- Project Memory remains canonical markdown plus state JSON. SQLite is queue,
  serving, session, event, and recall state.
- The current `src/inbox/items.ts` shape is producer-specific and should not
  define this V2 runtime inbox boundary.

## User-Facing Behavior

The user should be able to explicitly create a project-scoped durable-memory
proposal from the CLI.

The first CLI grammar is:

```text
myelin memory inbox create <project-key> --layer project --body ...
```

The command belongs under the broader `memory inbox` namespace so it can later
support Practice and Personal proposals without creating separate command
families. The first slice may default or constrain `--layer project`.

The runtime inbox item is preserved source material. It is not canonical memory
and is not yet a normalized candidate.

Product shape note: runtime inbox review is curator/agent review against the
relevant evidence layer, not operator/manual review. This distinction is
foundational. The product should remain self-maintaining: operators create or
trigger proposals, while Myelin reviews, verifies, reconciles, supersedes,
rejects, or applies memory through the relevant memory-layer curator.

`project learn <key>` should automatically run candidate intake before packet
construction so that a newly created project runtime inbox item can appear in
the curator packet without requiring a separate manual drain command.

The same intake unit should also be exposed directly:

```text
myelin memory inbox intake <project-key>
```

This command is deterministic and provider-free. It exists so operators and
tests can exercise the source-to-candidate boundary without invoking the
Project Memory Curator, while `project learn` composes the same service for the
self-maintaining product loop.

Candidate inspection remains available through existing memory-candidate
commands after intake creates or reuses the normalized candidate.

## Technical Design

### Runtime Inbox Contract

Runtime durable-memory inbox items carry explicit proposal metadata:

- stable id
- schema version
- created timestamp
- creator identity
- target durable layer: `project | practice | personal`
- layer-specific scope
- title
- body/source text
- rationale
- evidence refs
- target hint
- risk
- confidence

The first implementation slice accepts `layer: "project"` and project scope.
The contract still names Practice and Personal as native durable-memory layers
so the runtime inbox does not become project-only by accident.
Practice and Personal runtime inbox proposals should be rejected with an
explicit unsupported-layer result until their consumers exist. See ADR 0061.

### Creation Boundary

The creation command should write a runtime inbox item, not a candidate row.

It should accept inline text for the proposal body and may accept file-backed
body input when that remains a small extension of the same validation path.
It should not expose a lifecycle status option. `confidence` and `risk` are
required proposal metadata and should be shown in default command output rather
than hidden behind an opt-in display flag.

The creation boundary owns:

- validating the operator/tool supplied proposal envelope;
- assigning a stable id;
- writing source material atomically;
- preserving provenance and evidence refs;
- returning enough output for the operator or tool to inspect what was created.

The creation boundary does not own:

- candidate dedupe;
- Project Memory packet construction;
- Project Memory curation;
- markdown apply;
- Session Memory ingest or maintenance.

### Intake Boundary

The intake service reads project-layer runtime inbox items and normalizes them
into `memory_candidates`.

The service is a standalone logical unit. The CLI command
`memory inbox intake <project-key>` and `project learn <key>` should both call
this same service rather than duplicating source reads, validation, candidate id
generation, or dedupe behavior.

For a project runtime inbox item, the candidate should use:

- `scope: "project"`
- `candidate_type: "project.inbox"`
- `source_event_refs: ["inbox:<item-id>"]`
- deterministic candidate id derived from the runtime inbox item id
- evidence/proposed payload that preserves the source body, rationale,
  evidence refs, target hint, creator, risk, confidence, and created timestamp

Runtime inbox candidates always normalize to `status: "needs_review"` in this
slice. "Needs review" means the Project Memory Curator must verify the proposal
against the applicable memory layer evidence before it can become durable
memory. It does not mean the operator is expected to manually supervise the
ordinary product loop.

The intake service should be idempotent:

- pending/needs-review existing candidate: report existing
- processed/rejected existing candidate: report terminal duplicate and do not
  recreate
- missing candidate: create one candidate row

### Learn Integration

`project learn` should run runtime inbox intake after source-consumption
reconciliation and before `buildProjectMemoryPacket`.

This ordering keeps already-consumed candidates terminal before the packet is
built, then lets newly-created candidates enter the same existing packet path as
Session Memory outputs and handoffs.

If implementation evidence shows shell repair must run before intake to create
the project directory, that ordering is acceptable as long as recovery and
source-consumption reconciliation still run before new curator work.

## Data / State

Runtime inbox items are preserved source records under:

```text
projects/<key>/sources/inbox/
```

`memory inbox create` owns creating this lazy source tree because bootstrap only
creates the base Project Memory shell. When the command first creates preserved
inbox source material, it should also create or maintain:

```text
projects/<key>/sources/index.md
projects/<key>/sources/inbox/index.md
```

The folder name is `inbox`, not `runtime-inbox`; the runtime aspect is the
producer boundary, while the filesystem path should use the clear product noun.
Each inbox item is stored as pretty JSON:

```text
projects/<key>/sources/inbox/<id>.json
```

JSON is the source/proposal format because intake needs deterministic
validation, future tools need a simple write contract, and durable human
reviewable markdown is produced later only after memory-layer curation.

Candidate source refs for these items should use the same clear product noun:

```text
inbox:<item-id>
```

Root SQLite `memory_candidates` remains the normalized candidate queue consumed
by `project learn`.

The first slice should avoid adding a separate source-to-candidate index unless
deterministic candidate ids prove insufficient during design review.

Runtime inbox item files are immutable source material in this slice. Intake
must not rewrite them to add lifecycle fields. Lifecycle lives in deterministic
candidate ids, `memory_candidates` rows, and Project Memory source-consumption
state after apply.

## Error Handling

Default posture:

- missing runtime inbox directory: clean noop
- malformed single runtime inbox item: skip and report degraded
- path escape or unsafe source directory state: block
- missing memory DB: degrade consistently with packet construction
- unsupported layer in first slice: skip and report unsupported layer
- project-scope mismatch: skip and report unsupported scope

No malformed runtime inbox item should reach the curator packet.

## Testing Strategy

Tests should prove:

- CLI creation writes a valid runtime inbox item with stable id and provenance.
- CLI creation creates and maintains `sources/index.md` and
  `sources/inbox/index.md` when it creates the lazy inbox source tree.
- CLI creation writes pretty JSON inbox items under `sources/inbox/<id>.json`.
- Invalid CLI input fails before writing source material.
- `memory inbox intake <project-key>` deterministically converts valid runtime
  inbox items into candidates without invoking a provider.
- Intake creates exactly one project memory candidate for a valid project inbox
  item.
- Runtime inbox candidates are created as `needs_review`, not as accepted truth
  or operator-approved pending facts.
- Creation output includes confidence and risk by default.
- Repeated intake does not create duplicates.
- Existing terminal candidates are not recreated.
- `project learn` runs intake before packet construction.
- Malformed single inbox item degrades/skips without feeding the curator.
- Existing `memory candidates` inspection can see created candidates.

## Planning Boundary Guidance

Future implementation planning should split this design into small chunks:

1. Runtime inbox item contract and writer.
   - Depends on current project path/id/json helpers.
   - Verifies schema validation, id generation, and atomic writes.
2. CLI command for explicit project runtime inbox creation.
   - Depends on the writer.
   - Verifies operator-facing usage and JSON output.
3. Project candidate intake service.
   - Depends on inbox item validation and memory candidate helpers.
   - Verifies idempotent normalization into `memory_candidates`.
4. Deterministic intake command.
   - Depends on the intake service.
   - Verifies direct operator/test access to source-to-candidate conversion.
5. `project learn` integration.
   - Depends on intake service and existing source-consumption reconciliation.
   - Verifies ordering before packet construction and curator packet visibility.

The next roadmap item, gap/stale producer routing, should not be planned in this
same slice. It should consume the runtime inbox/intake boundary after this
foundation exists.

## Acceptance Criteria

- A project-scoped runtime inbox proposal can be created explicitly.
- The creation command is exposed as `memory inbox create`, not as direct
  candidate creation.
- Runtime inbox item files are preserved without intake lifecycle rewrites.
- `memory inbox intake <project-key>` exposes the deterministic intake boundary,
  and `project learn <key>` calls the same service.
- Running `project learn <key>` can normalize valid runtime inbox items into
  needs-review Project Memory candidates before packet construction.
- Re-running `project learn <key>` does not duplicate candidates.
- The curator still only sees normalized packet candidates, not raw source
  files.
- Session Memory remains a separate automated producer path.
- Practice and Personal layers are named in the contract but not implemented as
  candidate creation paths in this slice; attempts to use them return an
  explicit unsupported-layer result.

## Assumptions

- The first runtime inbox layer to implement is Project Memory.
- The runtime inbox contract is layer-shaped across Project, Practice, and
  Personal Memory, but the working product accepts only layers with implemented
  consumers.
- CLI creation belongs in the foundation slice because it is the first concrete
  producer-facing API.
- The operator-facing creation namespace is `memory inbox create`.
- Runtime inbox items are immutable source material for this slice.
- Runtime inbox candidates always require curator review and verification before
  durable memory writes.
- Runtime inbox creation exposes no lifecycle status option. Confidence and risk
  are always part of the proposal contract and default output.
- `memory inbox intake` and `project learn` should compose the same intake
  service; `project learn` still runs intake automatically for the product loop.
- Runtime inbox source items live under `projects/<key>/sources/inbox/`.
- Runtime inbox source items are JSON; accepted durable memory becomes markdown
  only after curator review and apply.
- Runtime inbox items are source material and should not be treated as trusted
  memory.

## Decision Ledger

See `agenda.md` for the resolved decision ledger and pressure-test result.
