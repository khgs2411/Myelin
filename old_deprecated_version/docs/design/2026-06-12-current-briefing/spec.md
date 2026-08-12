# Current Briefing Design

Status: Working draft. Not approved for implementation planning yet.

## Goal

Current Briefing gives an agent a concise, trustworthy session-start answer for a project: what this project is, what is current, what is stale or missing, what was recently verified, and what the next useful action probably is.

The first useful product surface is `myelin status <project>`, backed by a Current Briefing artifact. The slice should prove the product promise that a new coding session can start from maintained memory instead of re-discovering context.

## Current Context

The canonical design in `MYELIN.md` defines Myelin as a project-rooted memory system for coding agents. Project Memory is the root, Session Memory provides project-scoped continuity, and the Status Facade should answer structured current-state questions.

The roadmap tasks point at this as the first useful product surface:

- `.tasks/01-current-briefing/current-briefing-artifact.md`
- `.tasks/01-current-briefing/status-uses-current-briefing.md`
- `.tasks/05-semantic-interface/facade-response-contract.md`
- `.tasks/05-semantic-interface/status-facade.md`
- `.tasks/12-source-intake-and-layout/project-data-layout.md`

The current implementation already has useful foundations:

- `src/commands/status.ts` reports project identity, freshness state, latest run, and a latest-session pointer.
- `src/runtime/layout.ts` defines the V2 project layout: `sources/`, `wiki/`, `schema/`, `state/`, `log/`, and `runs/`.
- `README.md` and `docs/IMPLEMENTATION_ALIGNMENT.md` describe the JSON facade envelope already used by query-like commands.

The mismatch is that `status` currently returns low-level state and reads latest sessions from `wiki/sessions/*.md`; it does not yet present a durable "what should I know now?" briefing.

## User-Facing Behavior

For v0, `myelin status <project>` should make Current Briefing the primary human-facing answer. Urgent stale or degraded state should appear above or inside the briefing header so important operational alerts are not buried.

Human-readable output should:

- identify the project
- show the current briefing when one exists
- clearly report missing, stale, or degraded briefing state
- include short freshness and latest-run/session signals
- point to the briefing artifact and key cited sources
- suggest the next useful action only when the artifact has enough evidence

The v0 briefing artifact should contain:

- project identity
- current state
- recent work
- verified facts
- blockers and uncertainties
- next useful action
- citations to project memory, state, or repo evidence

JSON output should preserve a stable facade-like contract so MCP and future agents can consume it deterministically.

## Technical Design

The design has three separable parts:

1. Current Briefing artifact
   A project-owned markdown artifact records session-start context in a predictable shape. It is curated memory, not generated serving state.

2. Status facade delivery
   `status` reads the artifact if present and reports explicit degraded state when missing, stale, or incomplete.

3. Response contract
   Human output can be compact prose, but `--json` should return structured state first with briefing metadata and degradation fields.

The first version should use the existing provider infrastructure to generate a Current Briefing, while still avoiding vector search, background agents, Practice Memory, Personal Memory, or a redesigned `project learn` pipeline. Generation should be a bounded explicit action, not automatic background learning.

## Data / State

The open design decision is the artifact's exact path. The leading candidates are:

- `projects/<key>/wiki/current-briefing.md`
- `projects/<key>/state/current-briefing.md`
- `projects/<key>/state/current-briefing.json` plus a markdown companion

Working decision: the human-readable briefing belongs in `wiki/` because it is curated project memory. Any machine-readable state about the briefing must be derived automatically from the canonical markdown or omitted. v0 must not require maintaining two files by hand.

Likely metadata to expose through `status`:

- artifact path
- updated timestamp or source freshness marker
- cited project memory or state files
- degraded flag and degraded reason
- next action, if known

## Integrations

`status` should build on the existing command in `src/commands/status.ts` rather than creating a new command. Detached MCP status can later consume the same JSON contract, but MCP work is out of scope for v0 unless the design later requires it.

The design should preserve the V2 project layout from `src/runtime/layout.ts` and `MYELIN.md section 12`.

Current Briefing generation should use the existing provider abstraction rather than adding a new model runner. The generation path should be explicit and bounded: it may invoke Codex through the configured provider, but it should not become a general `project learn` redesign or an always-on background worker.

The first proof should use two projects in sequence:

- `wizepal` at `/Users/liadgoren/Wizepal/droplet-bot` as the stable fixture for generation quality and artifact shape.
- `class-kit` at `/Users/liadgoren/Repositories/class-kit` as the active-work fixture for freshness, drift, and degraded-state behavior.

## Error Handling

Missing briefing is not an error. It is degraded state:

- human output should say no Current Briefing exists and name the expected path
- JSON output should set `degraded: true` and include an actionable `degraded_reason`
- status should still return project identity and any available freshness/run/session state

Stale briefing should also degrade explicitly rather than pretending the artifact is fresh.

`status` should not silently fall back to the old output shape when the briefing is missing. The command should succeed with degraded state so onboarding remains possible and repair is obvious.

## Testing Strategy

Future implementation plans should verify:

- `status <project>` includes briefing content or a pointer when the artifact exists
- `status <project> --json` includes briefing metadata in a stable envelope
- missing briefing produces degraded JSON and actionable human output
- existing project identity, freshness, and latest-run behavior does not regress
- generated briefing behavior is testable with provider stubs
- live provider use is bounded and optional during tests
- the generated briefing is first validated against a stable project, then pressure-tested against an actively changing project

## Planning Boundary Guidance

Later implementation should be split into smaller chunks:

- Artifact contract: define the Current Briefing markdown shape and canonical path.
- Generation action: create or refresh the canonical markdown briefing through the existing provider abstraction.
- Status read path: teach `status` to detect and report the briefing.
- JSON contract: extend status JSON without breaking existing facade fields.
- Freshness/degraded checks: make missing/stale briefing explicit and actionable.

Do not bundle session-curator automation, vector retrieval, MCP facade reshaping, or learn/ingest redesign into the first implementation plan.

## Acceptance Criteria

The design is ready for implementation planning when:

- the canonical artifact path and ownership are decided
- the v0 briefing fields are decided
- the degraded/missing/stale behavior is decided
- the status JSON shape is decided at the level needed for planning
- model-generation scope and test strategy are explicit

## Assumptions

- Current Briefing v0 should be generated by a bounded explicit provider-backed action, with manual edits still possible because markdown remains canonical.
- Project data layout is already sufficiently established for this slice.
- `status` is the right first delivery mechanism because it already exists and is closest to the future Status Facade.
- The first slice should prove product value before adding agentic curation.

## Open Questions

The live design agenda is in `agenda.md`.

Current scope decision: after choosing provider-backed generation, Current Briefing v0 depends on too many unsettled surfaces to be the first implementation slice. This design is paused as a discovery/north-star artifact while a smaller prerequisite slice is selected.
