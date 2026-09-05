# Codex Automatic-Capture Input Contract — Open Design Issues

> Historical source record. This unit is retired from active design.
> Continue in the [current consolidated unit](../2026-09-03-shared-captured-activity-seam/README.md).
> Its issue list controls unresolved work; this body preserves prior context.

Established provider facts: [Feature Shape](feature-shape.md).

## Issue 1: Native capture unit

**Status:** RESOLVED

We must select what one accepted captured-evidence item represents before we
can define the shared captured-activity seam or make the development fixture
equivalent to automatic Codex capture.

Codex exposes three materially different native units:

1. `UserPromptSubmit` and `Stop` provide exact user and assistant message
   content as separate turn-scoped events.
2. A completed turn can be assembled by correlating those two events through
   `session_id` and `turn_id`.
3. `SessionEnd` can locate a richer transcript snapshot, but it has no turn
   coordinate and its `transcript_path` can be null.

### Accepted decision

Accept the two message events as separate evidence items for the first local
journey:

```text
UserPromptSubmit -> one exact user-message observation
Stop             -> one exact assistant-message observation
```

For the controlled fixture, use `(session_id, turn_id, hook_event_name)` as the
replay coordinate.
Preserve the exact native hook JSON as source material. Keep
`providerOccurredAt` absent because these hook inputs contain no source time.

The development fixture would submit controlled equivalents of these
normalized observations through the shared ingestion service. One fixture
command can submit the ordered pair. It would not need to install a hook or
read a live Codex transcript.

This design gives the fixture deterministic coordinates. It does not require
event correlation state or depend on a nullable transcript path. Its cost is
two evidence items for one completed turn. Automatic delivery and replay
reliability remain deferred to Roadmap Step 7.

### Material alternatives

- Assemble one completed-turn evidence item. This gives a convenient curation
  unit, but capture must hold or persist the user event until `Stop` arrives.
- Accept one transcript snapshot. This preserves the richest source, but
  capture becomes session-end dependent and needs a transcript frontier and
  snapshot replay contract.

The user accepted this decision on 2026-09-03.

## Issue 2: Root and subagent activity

**Status:** RESOLVED

`UserPromptSubmit` can include optional `agent_id` and `agent_type` fields.
Codex also exposes separate `SubagentStart` and `SubagentStop` events. The first
capture slice must decide whether provider-internal activity is Session
evidence or implementation noise.

### Accepted decision

Capture only the top-level conversation in the first slice:

```text
top-level turn inputs and result -> evidence
provider-internal agent prompt   -> ignored
SubagentStart / SubagentStop     -> ignored
```

This keeps Session Memory about the user-visible work contract and result.
Subagent activity can still affect the top-level assistant result. It does not
become separate Session evidence unless a later requirement needs internal
execution provenance.

The user accepted this decision on 2026-09-03.
