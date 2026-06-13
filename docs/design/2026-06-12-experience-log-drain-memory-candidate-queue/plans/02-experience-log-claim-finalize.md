# Chunk 02: Experience Log Claim And Finalize

**Plan Set:** `../plan.md`
**Spec:** `../spec.md`
**Status:** Ready For Implementation
**Depends on:** `01-storage-schema-contracts.md`
**Enables:** `05-ingest-agent-orchestration.md`

## Goal

Replace terminal-only Experience Log tombstoning with atomic pull/claim and job-completion finalization. Pulling a batch moves rows from `experience_events` into `experience_event_tombstones` with `state='claimed'`; finishing a job updates those tombstones to `output`, `no_output`, `failed`, or `unfinished` without reintroducing raw rows or losing dedupe protection.

## Source Artifacts

- `../spec.md`: Pull-To-Tombstone Lifecycle, Parallelism Boundary, Error Handling
- `../agenda.md`: Questions 20 and 21
- `src/memory/experience.ts`
- `src/memory/experience.test.ts`
- `src/memory/ingest-types.ts` from Chunk 01

## Relationships

- **Depends on:** Chunk 01 tombstone schema fields.
- **Enables:** Chunk 05 can let the ingest agent pull rows through Myelin helpers.
- **Shared contracts:** `claimExperienceEvents`, `finalizeClaimedExperienceEvents`, `listExperienceEvents`.
- **Integration points:** dedupe checks in `recordExperienceEvent` must still reject tombstoned provider identities.

## File Responsibility Map

**Modify:**
- `src/memory/experience.ts` - add claim/finalize helpers and adapt `tombstoneExperienceEvent` to the new schema.

**Test:**
- `src/memory/experience.test.ts` - verify claim removes active rows, tombstones preserve dedupe, finalization updates claimed rows, and malformed partial failure does not delete rows.

## Implementation Tasks

### Task 1: Add Claim Helper

**Files:**
- Modify: `src/memory/experience.ts`
- Test: `src/memory/experience.test.ts`

- [ ] **Step 1: Add types and helper signature**

```ts
import type { TombstoneState } from "./ingest-types.ts";

export type ClaimedExperienceTombstone = {
  id: string;
  original_event_id: string;
  project_key: string;
  ingest_job_id: string;
  provider: string | null;
  provider_session_id: string | null;
  claimed_at: string;
  state: TombstoneState;
  source_metadata_json: string;
  retained_evidence_json: string;
};

export type ClaimExperienceEventsInput = {
  ingest_job_id: string;
  project_key: string;
  provider_session_id?: string | null;
  limit: number;
  claimed_at: string;
  tombstone_id_for: (event: ExperienceEventRow) => string;
};
```

- [ ] **Step 2: Implement atomic claim**

```ts
export function claimExperienceEvents(db: Database, input: ClaimExperienceEventsInput): ClaimedExperienceTombstone[] {
  if (!Number.isInteger(input.limit) || input.limit <= 0) throw new Error("Claim limit must be a positive integer");

  const claim = db.transaction(() => {
    const rows = db
      .query("SELECT * FROM experience_events WHERE project_key = ? ORDER BY occurred_at, id LIMIT ?")
      .all(input.project_key, input.limit) as ExperienceEventRow[];

    const claimed: ClaimedExperienceTombstone[] = [];
    for (const row of rows) {
      const tombstone: ClaimedExperienceTombstone = {
        id: input.tombstone_id_for(row),
        original_event_id: row.id,
        project_key: row.project_key,
        ingest_job_id: input.ingest_job_id,
        provider: row.provider,
        provider_session_id: input.provider_session_id ?? row.provider_session_id,
        claimed_at: input.claimed_at,
        state: "claimed",
        source_metadata_json: JSON.stringify({
          occurred_at: row.occurred_at,
          hook_event_name: row.hook_event_name,
          event_kind: row.event_kind,
          cwd: row.cwd,
          provider: row.provider,
          provider_session_id: row.provider_session_id,
          turn_id: row.turn_id,
          source: row.source,
          status: row.status,
        }),
        retained_evidence_json: JSON.stringify({
          raw_text: row.raw_text,
          raw_payload_json: row.raw_payload_json,
        }),
      };

      db.query(
        `INSERT INTO experience_event_tombstones
          (id, original_event_id, dedupe_key, project_key, ingest_job_id, provider, provider_session_id,
           claimed_at, finalized_at, state, terminal_decision, source_metadata_json, retained_evidence_json,
           output_references_json)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, NULL, 'claimed', NULL, ?, ?, ?)`,
      ).run(
        tombstone.id,
        row.id,
        row.dedupe_key,
        row.project_key,
        input.ingest_job_id,
        tombstone.provider,
        tombstone.provider_session_id,
        input.claimed_at,
        tombstone.source_metadata_json,
        tombstone.retained_evidence_json,
        JSON.stringify([]),
      );
      db.query("DELETE FROM experience_events WHERE id = ?").run(row.id);
      claimed.push(tombstone);
    }
    return claimed;
  });

  return claim();
}
```

### Task 2: Add Finalization Helper

**Files:**
- Modify: `src/memory/experience.ts`
- Test: `src/memory/experience.test.ts`

- [ ] **Step 1: Implement finalization by tombstone ids**

```ts
export type FinalizeClaimedExperienceEventsInput = {
  ingest_job_id: string;
  tombstone_ids: string[];
  finalized_at: string;
  state: Exclude<TombstoneState, "claimed">;
  terminal_decision: string;
  output_references: string[];
};

export function finalizeClaimedExperienceEventsInOpenTransaction(
  db: Database,
  input: FinalizeClaimedExperienceEventsInput,
): void {
  if (input.tombstone_ids.length === 0) return;
  if (input.state === "output" && input.output_references.length === 0) {
    throw new Error("Output tombstones require at least one output reference");
  }

  for (const id of input.tombstone_ids) {
    const result = db
      .query(
        `UPDATE experience_event_tombstones
         SET finalized_at = ?, state = ?, terminal_decision = ?, output_references_json = ?
         WHERE id = ? AND ingest_job_id = ? AND state = 'claimed'`,
      )
      .run(
        input.finalized_at,
        input.state,
        input.terminal_decision,
        JSON.stringify(input.output_references),
        id,
        input.ingest_job_id,
      );
    if (result.changes !== 1) throw new Error(`Unable to finalize claimed tombstone: ${id}`);
  }
}

export function finalizeClaimedExperienceEvents(db: Database, input: FinalizeClaimedExperienceEventsInput): void {
  const finalize = db.transaction(() => {
    finalizeClaimedExperienceEventsInOpenTransaction(db, input);
  });
  finalize();
}
```

- [ ] **Step 2: Add job-level finalization helper**

```ts
export function finalizeRemainingClaimedExperienceEvents(
  db: Database,
  input: {
    ingest_job_id: string;
    finalized_at: string;
    state: "no_output" | "failed" | "unfinished";
    terminal_decision: string;
  },
): number {
  const result = db
    .query(
      `UPDATE experience_event_tombstones
       SET finalized_at = ?, state = ?, terminal_decision = ?, output_references_json = ?
       WHERE ingest_job_id = ? AND state = 'claimed'`,
    )
    .run(input.finalized_at, input.state, input.terminal_decision, JSON.stringify([]), input.ingest_job_id);
  return result.changes;
}
```

### Task 3: Preserve Legacy Terminal Tombstone API With Scoped Single-Event Claim

**Files:**
- Modify: `src/memory/experience.ts`

- [ ] **Step 1: Add a single-event claim helper scoped by event id**

```ts
function claimSingleExperienceEvent(
  db: Database,
  input: {
    id: string;
    original_event_id: string;
    project_key: string;
    ingest_job_id: string;
    provider_session_id?: string | null;
    claimed_at: string;
  },
): ClaimedExperienceTombstone {
  const row = db
    .query("SELECT * FROM experience_events WHERE id = ? AND project_key = ?")
    .get(input.original_event_id, input.project_key) as ExperienceEventRow | null;
  if (!row) throw new Error(`Unknown experience event: ${input.original_event_id}`);

  const tombstone: ClaimedExperienceTombstone = {
    id: input.id,
    original_event_id: row.id,
    project_key: row.project_key,
    ingest_job_id: input.ingest_job_id,
    provider: row.provider,
    provider_session_id: input.provider_session_id ?? row.provider_session_id,
    claimed_at: input.claimed_at,
    state: "claimed",
    source_metadata_json: JSON.stringify({
      occurred_at: row.occurred_at,
      hook_event_name: row.hook_event_name,
      event_kind: row.event_kind,
      cwd: row.cwd,
      provider: row.provider,
      provider_session_id: row.provider_session_id,
      turn_id: row.turn_id,
      source: row.source,
      status: row.status,
    }),
    retained_evidence_json: JSON.stringify({
      raw_text: row.raw_text,
      raw_payload_json: row.raw_payload_json,
    }),
  };

  db.query(
    `INSERT INTO experience_event_tombstones
      (id, original_event_id, dedupe_key, project_key, ingest_job_id, provider, provider_session_id,
       claimed_at, finalized_at, state, terminal_decision, source_metadata_json, retained_evidence_json,
       output_references_json)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, NULL, 'claimed', NULL, ?, ?, ?)`,
  ).run(
    tombstone.id,
    row.id,
    row.dedupe_key,
    row.project_key,
    input.ingest_job_id,
    tombstone.provider,
    tombstone.provider_session_id,
    input.claimed_at,
    tombstone.source_metadata_json,
    tombstone.retained_evidence_json,
    JSON.stringify([]),
  );
  db.query("DELETE FROM experience_events WHERE id = ?").run(row.id);
  return tombstone;
}
```

- [ ] **Step 2: Rewrite `tombstoneExperienceEvent` as a terminal convenience wrapper**

```ts
export function tombstoneExperienceEvent(
  db: Database,
  input: {
    id: string;
    original_event_id: string;
    project_key: string;
    processed_at: string;
    terminal_decision: string;
    output_references: string[];
  },
): void {
  if (input.output_references.length === 0) throw new Error("Tombstone requires at least one output reference");

  const apply = db.transaction(() => {
    claimSingleExperienceEvent(db, {
      id: input.id,
      original_event_id: input.original_event_id,
      project_key: input.project_key,
      ingest_job_id: "legacy-terminal",
      claimed_at: input.processed_at,
    });
    finalizeClaimedExperienceEventsInOpenTransaction(db, {
      ingest_job_id: "legacy-terminal",
      tombstone_ids: [input.id],
      finalized_at: input.processed_at,
      state: "output",
      terminal_decision: input.terminal_decision,
      output_references: input.output_references,
    });
  });
  apply();
}
```

- [ ] **Step 3: Add a regression test for scoped legacy tombstoning**

```ts
test("legacy terminal tombstone targets the requested event id, not the oldest project event", () => {
  const base = {
    project_key: "class-kit",
    provider: "codex",
    raw_payload_json: "{}",
    source: "codex-hook",
    status: "valid" as const,
  };
  recordExperienceEvent(db, { ...base, id: "evt_old", occurred_at: "2026-06-12T09:00:00.000Z" });
  recordExperienceEvent(db, { ...base, id: "evt_target", occurred_at: "2026-06-12T10:00:00.000Z" });

  tombstoneExperienceEvent(db, {
    id: "tomb_target",
    original_event_id: "evt_target",
    project_key: "class-kit",
    processed_at: "2026-06-12T10:05:00.000Z",
    terminal_decision: "session_memory",
    output_references: ["session_memories/mem_1"],
  });

  expect(listExperienceEvents(db, "class-kit").map((event) => event.id)).toEqual(["evt_old"]);
  const tombstone = db
    .query("SELECT original_event_id, state FROM experience_event_tombstones WHERE id = ?")
    .get("tomb_target") as { original_event_id: string; state: string };
  expect(tombstone).toEqual({ original_event_id: "evt_target", state: "output" });
});
```

### Task 4: Add Claim/Finalize Tests

**Files:**
- Modify: `src/memory/experience.test.ts`

- [ ] **Step 1: Add atomic claim test**

```ts
test("claiming experience events moves rows into claimed tombstones", () => {
  recordExperienceEvent(db, {
    id: "evt_1",
    project_key: "class-kit",
    occurred_at: "2026-06-12T10:00:00.000Z",
    provider: "codex",
    provider_session_id: "sess_1",
    turn_id: "turn_1",
    hook_event_name: "UserPromptSubmit",
    raw_text: "remember this",
    raw_payload_json: "{}",
    source: "codex-hook",
    status: "valid",
  });

  const claimed = claimExperienceEvents(db, {
    ingest_job_id: "job_1",
    project_key: "class-kit",
    limit: 10,
    claimed_at: "2026-06-12T10:01:00.000Z",
    tombstone_id_for: (event) => `tomb_${event.id}`,
  });

  expect(claimed.map((row) => row.original_event_id)).toEqual(["evt_1"]);
  expect(listExperienceEvents(db, "class-kit")).toEqual([]);
  const tombstones = db.query("SELECT state, ingest_job_id FROM experience_event_tombstones").all() as Array<{
    state: string;
    ingest_job_id: string;
  }>;
  expect(tombstones).toEqual([{ state: "claimed", ingest_job_id: "job_1" }]);
});
```

- [ ] **Step 2: Add finalization and dedupe tests**

```ts
test("finalizing claimed tombstones records output references and keeps replay dedupe", () => {
  const input = {
    project_key: "class-kit",
    occurred_at: "2026-06-12T10:00:00.000Z",
    provider: "codex",
    provider_session_id: "sess_1",
    turn_id: "turn_1",
    hook_event_name: "UserPromptSubmit",
    raw_payload_json: "{}",
    source: "codex-hook",
    status: "valid" as const,
  };
  recordExperienceEvent(db, { ...input, id: "evt_1" });
  claimExperienceEvents(db, {
    ingest_job_id: "job_1",
    project_key: "class-kit",
    limit: 1,
    claimed_at: "2026-06-12T10:01:00.000Z",
    tombstone_id_for: () => "tomb_1",
  });

  finalizeClaimedExperienceEvents(db, {
    ingest_job_id: "job_1",
    tombstone_ids: ["tomb_1"],
    finalized_at: "2026-06-12T10:02:00.000Z",
    state: "output",
    terminal_decision: "session_memory",
    output_references: ["session_memories/mem_1"],
  });

  const replay = recordExperienceEvent(db, { ...input, id: "evt_2" });
  expect(replay).toBeNull();
  const tombstone = db.query("SELECT state, terminal_decision FROM experience_event_tombstones WHERE id = ?").get("tomb_1") as {
    state: string;
    terminal_decision: string;
  };
  expect(tombstone).toEqual({ state: "output", terminal_decision: "session_memory" });
});
```

## Verification

- Run: `bun test src/memory/experience.test.ts`
  - Expected: claim/finalize tests pass and existing dedupe tests pass after adapting assertions to new tombstone fields.
- Run: `bun test src/memory/db.test.ts src/memory/experience.test.ts`
  - Expected: schema and Experience Log lifecycle tests pass together.
- Run: `bun run typecheck`
  - Expected: passes.
- Run: `git diff --check`
  - Expected: no whitespace errors.

## Acceptance Criteria Covered

- Pulling rows atomically moves them out of `experience_events`.
- Tombstones remain as audit trail with retained bounded evidence.
- Job completion can finalize claimed rows.
- Dedupe protection still blocks replayed provider identities.
- The pull API is partition-safe for future multiple agents.

## Risks And Rollback

- Risk: legacy `tombstoneExperienceEvent` compatibility can drift from the batch claim path. Keep the scoped regression test so the helper cannot claim an unintended row.
- Risk: retaining full raw payload in tombstones may exceed privacy intent. Keep retention bounded to the current schema policy and revisit in Chunk 05 if prompt payloads duplicate transcripts.
- Rollback: revert `src/memory/experience.ts` and tests to the Chunk 01 schema-only state.

## Non-Goals

- No detached provider job execution.
- No agent prompt.
- No Session Memory writes.
- No candidate or handoff writes.
- No CLI.

## Type And Name Consistency

Verify helper names, tombstone states, and stored enum strings match `src/memory/ingest-types.ts` and `../spec.md`.
