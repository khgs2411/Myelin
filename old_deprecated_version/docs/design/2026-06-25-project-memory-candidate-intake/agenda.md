# Runtime Durable Memory Candidate Inbox Design Agenda

## Status

- Spec: `spec.md`
- State: Complete
- Completion gate:
  - Live agenda questions resolved: Yes
  - Pressure test complete: Yes
  - Spec finalized: Yes

## Documented Decisions

- The runtime inbox is a V2 product boundary for explicit durable-memory
  proposals, not a compatibility surface.
- Session Memory remains an automated producer path and does not create runtime
  inbox items.
- Runtime inbox items are source/proposal material, not canonical memory and not
  normalized candidates.
- Runtime inbox review means curator/agent review against the relevant evidence
  layer, not operator/manual review; this drives the self-maintaining product
  shape.
- Project-scoped runtime inbox items normalize into root SQLite
  `memory_candidates`.
- `project learn` remains the authoritative command that curates candidates into
  durable Project Memory.
- `project learn` should run intake automatically before packet construction so
  the operator does not need a separate drain step for the product loop.
- The first implementation slice handles Project Memory only, while the runtime
  inbox contract names Project, Practice, and Personal as native durable-memory
  layers.
- Runtime inbox creation/intake accepts only memory layers with implemented
  consumers; see ADR 0061.
- Gap/stale producer routing is a later producer integration that should consume
  this boundary rather than define it.
- The durable source path, source refs, and candidate type use the simple
  product noun `inbox`: `sources/inbox/<id>.json`, `inbox:<id>`, and
  `project.inbox`.

## Questions

### Question 1: CLI command grammar and payload entry mode

- Status: Answered
- Branch type: Initial
- Why it matters: The command name and input shape become the first concrete
  operator-facing API for runtime durable-memory proposals. A weak grammar will
  either leak candidate internals to the operator or make future tool/MCP
  exposure awkward.
- Scenario probe: During this Codex session, the operator wants to create a
  Project Memory proposal: "The runtime inbox is explicit proposal material and
  not canonical memory." The command must capture that text, the project key,
  rationale, evidence refs, and optional target hint without making the user
  hand-author JSON unless they choose to.
- Options:
  - A. `myelin memory inbox create <project-key> --layer project --body ...` —
    keeps durable-memory inbox under the broader memory namespace and leaves
    room for Practice/Personal; project key is still required for this slice.
  - B. `myelin project inbox create <project-key> --body ...` — reads naturally
    for the current Project Memory slice, but may make Practice/Personal feel
    separate later.
  - C. `myelin memory candidate create <project-key> ...` — simple, but it
    blurs source inbox items with normalized `memory_candidates`, which the
    design is explicitly trying to keep separate.
- Recommendation: Option A. Use `memory inbox create` as the durable-memory
  proposal surface and accept `--layer project` only for this slice. Start with
  inline `--body` input; file-backed body input is deferred until the source
  and intake boundary is proven.
- Answer: Confirmed Option A.
- Answer impact: Confirms branch.
- Spec impact: The spec now names `myelin memory inbox create <project-key>
  --layer project --body ...` as the first CLI grammar and records that the
  command writes runtime inbox source material rather than candidate rows.
  Follow-up audit refinement deferred file-backed body input out of the first
  implementation slice.
- Context impact: Updated `CONTEXT.md` with Runtime Durable-Memory Inbox.
- ADR impact: Not needed; this is important product vocabulary, but not a
  hard-to-reverse architecture decision yet.
- Follow-ups: None.

### Question 2: Runtime inbox item persistence path and lifecycle mutation

- Status: Answered
- Branch type: Initial
- Why it matters: The path and lifecycle model decide whether runtime inbox
  source material is immutable evidence, mutable queue state, or both. This
  affects idempotency, recovery, user inspection, and future producers.
- Scenario probe: A valid inbox item is created, `project learn` creates a
  candidate, then the candidate is applied and marked processed through
  source-consumption reconciliation. A later operator inspects the original
  inbox item. Should the file itself show "processed", or should the candidate
  and source-consumption state be the lifecycle record?
- Options:
  - A. Preserve inbox items as immutable source files and rely on deterministic
    candidate ids plus candidate/source-consumption lifecycle state — strongest
    provenance boundary, least source mutation, but source directory does not
    show lifecycle directly.
  - B. Add lifecycle fields to inbox item files when intake creates or terminally
    accounts for candidates — easier manual inspection, but source material
    becomes mutable queue state.
  - C. Preserve source files and add a small derived inbox state index — better
    inspection without mutating sources, but adds another state surface.
- Recommendation: Option A for the first slice. Add an inspection command later
  if lifecycle visibility becomes painful.
- Answer: Confirmed Option A.
- Answer impact: Confirms branch.
- Spec impact: The spec now states that runtime inbox item files are immutable
  source material for this slice and that lifecycle belongs to deterministic
  candidate ids, `memory_candidates`, and Project Memory source-consumption
  state.
- Context impact: Already covered by the Runtime Durable-Memory Inbox glossary
  entry and relationship.
- ADR impact: Not needed; this confirms the existing provenance principle and
  avoids adding a new state surface.
- Follow-ups: None.

### Question 3: Candidate status default for explicit runtime proposals

- Status: Answered
- Branch type: Initial
- Why it matters: `pending` versus `needs_review` changes whether proposals are
  treated as ready curator input or explicitly review-biased. Both statuses are
  visible to `project learn`, but the distinction matters for future operator
  workflows and confidence semantics.
- Scenario probe: An operator runs the command with strong evidence refs and a
  clear rationale. Another agent creates a weaker proposal with only a vague
  body. Should both normalize to the same candidate status?
- Options:
  - A. Default every runtime inbox candidate to `needs_review` — conservative,
    simple, but may make high-confidence explicit operator proposals look less
    actionable.
  - B. Default operator-created proposals to `pending` and agent/tool-created
    proposals to `needs_review` unless marked high confidence — reflects source
    trust, but requires creator/source semantics now.
  - C. Status derives from explicit `--status pending|needs-review` with a safe
    default of `needs_review` — operator can opt in, future tools can be
    explicit, but the command surface grows slightly.
- Recommendation: Option C with default `needs_review`.
- Answer: Runtime inbox candidates should always normalize to `needs_review`.
  The status means the curator/agent must verify the proposal against concrete
  layer evidence; it does not mean the operator will manually review ordinary
  flow. A new inbox item is never accepted as fact or truth and should never be
  treated as automatically approved durable memory.
- Answer impact: Changes model.
- Spec impact: The spec now states that runtime inbox candidates always use
  `status: "needs_review"` in this slice, and that curator review may create,
  amend, supersede, or reject durable memory based on evidence.
- Context impact: Not needed.
- ADR impact: Not needed.
- Follow-ups: Clarify whether any explicit CLI status option should be omitted
  entirely so callers cannot imply pre-approval.

### Question 4: Separate intake command versus automatic learn-only intake

- Status: Answered
- Branch type: Initial
- Why it matters: The product loop should be self-maintaining, but operators
  may still need visibility or a dry-run way to inspect what would become a
  candidate before invoking the curator.
- Scenario probe: The user creates three runtime inbox items and wants to check
  candidate creation without spending a provider-backed `project learn` run.
  Should there be an explicit command for that now?
- Options:
  - A. No separate command in the first slice; `project learn` runs intake and
    existing `memory candidates` commands handle inspection afterward.
  - B. Add `memory inbox intake <project-key>` as a deterministic command and
    also call the same service from `project learn`.
  - C. Add only `memory inbox list/show` inspection commands, with intake still
    automatic inside `project learn`.
- Recommendation: Option A unless the user wants deterministic preflight/dogfood
  ergonomics before invoking the curator; then Option B.
- Answer: Confirmed Option B. The deterministic intake boundary should be a
  smaller logical unit exposed as `memory inbox intake <project-key>`, and
  `project learn` should call that same service. This is a stronger product and
  code shape because the Project Memory learn flow composes intake instead of
  owning source-to-candidate conversion directly.
- Answer impact: Changes model.
- Spec impact: The spec now requires `memory inbox intake <project-key>` as a
  provider-free deterministic command and states that both the command and
  `project learn` call the same intake service.
- Context impact: Not needed.
- ADR impact: Not needed.
- Follow-ups: None.

### Question 5: First-slice payload scope for Practice and Personal

- Status: Answered
- Branch type: Initial
- Why it matters: The contract should not make Practice/Personal bolt-ons, but
  accepting their items before consumers exist could create dead queues.
- Scenario probe: A runtime agent wants to propose a Personal Memory item today.
  The shared inbox contract can represent it, but no Personal learn/promoter
  path is ready to consume it.
- Options:
  - A. Validate and reject non-project layers in the first slice with a clear
    "unsupported layer" result — honest and bounded.
  - B. Accept and preserve non-project inbox items but do not normalize them —
    future-compatible source capture, but creates unconsumed material.
  - C. Do not expose non-project layer options in CLI yet, but keep them in the
    internal schema/pseudocode contract — simplest UI, less dogfooding of the
    shared shape.
- Recommendation: Option A for service/intake behavior, with CLI initially
  exposing only project unless we need to test cross-layer authoring.
- Answer: Confirmed Option A and promoted to durable architecture context. The
  runtime inbox contract remains layer-shaped for Project, Practice, and
  Personal Memory, but the working product only accepts layers with implemented
  consumers. Practice and Personal inputs are rejected with an explicit
  unsupported-layer result until their consumer paths exist.
- Answer impact: Confirms branch and promotes decision to durable artifact.
- Spec impact: The spec now requires unsupported-layer rejection for
  Practice/Personal in this slice while preserving the shared layer-shaped
  contract.
- Context impact: Updated `CONTEXT.md` relationships.
- ADR impact: Created ADR 0061.
- Follow-ups: None.

### Question 6: Runtime inbox creation should expose no status option

- Status: Answered
- Branch type: Follow-up
- Why it matters: The answer to Question 3 changes the command surface. If all
  runtime inbox candidates require curator review, then `--status pending` would
  incorrectly suggest that the creator can mark a proposal as pre-approved or
  closer to truth.
- Scenario probe: A future agent tool creates a runtime inbox item and sets
  `--status pending` because it is confident. That could teach callers that
  confidence changes the lifecycle state, when the intended model says every
  runtime inbox proposal still needs evidence-based curator review.
- Options:
  - A. Do not expose any status option on runtime inbox creation; intake always
    creates `needs_review` candidates — strongest alignment with the model.
  - B. Keep an internal status field for future use but do not expose it in CLI
    or tool contracts — preserves flexibility but risks unused internal
    complexity.
  - C. Expose only `--confidence` and `--risk`; keep lifecycle status fixed —
    captures signal without implying pre-approval.
- Recommendation: Option A plus Option C's signal fields. No lifecycle status
  option; allow confidence/risk as evidence metadata only.
- Answer: Confirmed A plus C. Runtime inbox creation should expose no lifecycle
  status option. Confidence and risk matter by default and should be part of
  the proposal contract and response rather than opt-in display flags. A future
  flag may hide them if needed, but the default output should expose them.
- Answer impact: Confirms branch.
- Spec impact: The spec now states that runtime inbox creation has no lifecycle
  status option, always normalizes to `needs_review`, and includes confidence
  and risk in default command output.
- Context impact: Not needed.
- ADR impact: Not needed.
- Follow-ups: None.

### Question 7: Runtime inbox source storage path

- Status: Answered
- Branch type: Pressure-test
- Why it matters: The design says runtime inbox items are immutable preserved
  source material, but the exact path is still unresolved. The path determines
  whether future code treats runtime inbox items as source evidence, generated
  state, or a separate queue surface.
- Scenario probe: `memory inbox create llm-wiki --layer project ...` writes a
  source proposal. `memory inbox intake llm-wiki` reads it. A later auditor
  wants to inspect preserved source material separately from generated
  lifecycle state.
- Options:
  - A. `projects/<key>/sources/inbox/<id>.json` — strongest alignment with
    "preserved source material" and the clear product noun.
  - B. `projects/<key>/inbox/<id>.json` — shortest and most discoverable for
    the inbox concept, but it creates another top-level project folder outside
    the V2 source/state/wiki/log/runs layout vocabulary.
  - C. `projects/<key>/state/inbox/<id>.json` — easy for machine reads,
    but incorrectly frames immutable source proposals as generated state.
- Recommendation: Option A. Runtime inbox items are source proposals, so store
  them under `sources/inbox/`.
- Answer: Confirmed Option A. Store runtime inbox source items under
  `projects/<key>/sources/inbox/`. The command should create and maintain
  `sources/index.md` and `sources/inbox/index.md` because bootstrap creates
  `sources/` lazily only when preserved source material exists.
- Answer impact: Confirms branch.
- Spec impact: The spec now names `projects/<key>/sources/inbox/` as the inbox
  source path and states that `memory inbox create` owns the lazy source index
  files.
- Context impact: Not needed; this is path-level implementation language, while
  CONTEXT already records the product concept.
- ADR impact: Covered by ADR 0061 and existing source/canonical memory
  principles; no new ADR needed.
- Follow-ups: Decide whether inbox items are `.json`, `.md`, or paired
  source/metadata files.

### Question 8: Runtime inbox item file format

- Status: Answered
- Branch type: Pressure-test
- Why it matters: The storage path is settled, but the file format determines
  validation, human inspection, future tool writes, and how much source text is
  preserved as authored material versus structured metadata.
- Scenario probe: An operator creates a proposal with a multiline body,
  rationale, confidence, risk, evidence refs, and target hint. Intake needs to
  validate the envelope deterministically, and a human should still be able to
  inspect the preserved source without special tooling.
- Options:
  - A. Store one JSON file per item, `sources/inbox/<id>.json` — easiest to
    validate and normalize deterministically; human-readable enough with pretty
    JSON, but less pleasant for long prose.
  - B. Store one Markdown file per item, `sources/inbox/<id>.md` — nicest for
    human-authored prose, but requires frontmatter or embedded metadata parsing
    for validation and future tools.
  - C. Store paired files, `sources/inbox/<id>.md` plus
    `sources/inbox/<id>.json` — best human and machine separation, but doubles
    file lifecycle and atomic-write complexity.
- Recommendation: Option A for the first slice. Use pretty JSON with a multiline
  `body` field and maintain `index.md` files for human navigation. Revisit
  Markdown if hand-authored long-form proposals become painful.
- Answer: Confirmed Option A. Runtime inbox items are stored as pretty JSON
  under `projects/<key>/sources/inbox/<id>.json`; accepted durable memory is
  rendered to markdown only after curator review and apply.
- Answer impact: Confirms branch.
- Spec impact: The spec now names JSON as the runtime inbox source/proposal
  format and records that durable `.md` output appears downstream, not in the
  inbox item itself.
- Context impact: Not needed.
- ADR impact: Not needed unless Markdown or paired files are chosen for a
  deeper source/metadata split.
- Follow-ups: None.

## Pressure-Test Result

- Status: Complete
- Checked categories: lifecycle and interruption; state persistence; handoff
  boundaries; verification evidence; scope control; recovery paths; sequencing;
  user review points.
- Result: The pressure test added and resolved the source path and file-format
  questions. A follow-up external audit found and the design now resolves the
  old inbox-schema reference, confidence/risk validation semantics, and
  pseudocode synchronization bookkeeping. No live material branches remain.
- Remaining non-blocking risks:
  - None.

## External Audit Refinement

- Auditor: Maxwell (`019eff23-17cd-76c2-8af1-cf6554ae3dfb`)
- Status before refinement: Needs Refinement
- Corrections applied:
  - Marked the current top-level inbox schema/code as non-authoritative V2
    context instead of source authority.
  - Resolved `confidence` and `risk` as required `low | medium | high` enum
    values.
  - Deferred file-backed `--file` body input out of the first implementation
    slice.
  - Cleared stale pseudocode synchronization risk after updating pseudocode
    artifacts to `sources/inbox/<id>.json`, `inbox:<id>`, and `project.inbox`.
