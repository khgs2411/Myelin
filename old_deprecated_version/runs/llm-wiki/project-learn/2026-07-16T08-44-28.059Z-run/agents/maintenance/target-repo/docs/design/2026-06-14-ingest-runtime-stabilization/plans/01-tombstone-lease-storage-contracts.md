# Chunk 01: Tombstone Lease Storage Contracts

**Plan Set:** `../plan.md`
**Spec:** `../spec.md`
**Status:** Ready For Implementation
**Depends on:** None
**Enables:** `02-worker-commit-lifecycle.md`, `04-ingest-status-readback.md`, `05-docs-validation-and-retest.md`

## Goal

Add tombstone-backed lease helpers beside the current claim/delete storage contract. Pulling a row through the new helpers should create or reuse a non-terminal tombstone stub while leaving the source `experience_events` row present. Terminal helpers should populate/finalize tombstones and delete source rows only after accepted output or explicit no-output terminalization.

This chunk must leave the existing worker integration-safe before Chunk 02 runs. Do not change the observable behavior of `claimExperienceEvents`, `finalizeClaimedExperienceEventsInOpenTransaction`, or `finalizeRemainingClaimedExperienceEvents` in this chunk; those compatibility APIs must continue to support the current worker until Chunk 02 migrates it to the new lease helpers.

## Source Artifacts

- `../spec.md`: Tombstone-Backed Lease Then Commit Model; Data / State; Error Handling.
- `../agenda.md`: Questions 1, 6, and 7.
- `../../../../CONTEXT.md`: **Experience Log Tombstone**.
- `../../../adr/0056-use-detached-target-repo-agents-for-experience-log-ingest.md`.
- Code paths: `src/memory/experience.ts`, `src/memory/experience.test.ts`, `src/memory/ingest-types.ts`, `src/memory/migrations.ts`, `src/memory/db.test.ts`.

## Relationships

- **Depends on:** Current migration state and tombstone unique indexes.
- **Enables:** Worker lifecycle migration can call stable lease/commit helpers without owning schema semantics.
- **Shared contracts:** tombstone state `claimed`; one tombstone per `original_event_id` / `dedupe_key`; retry history stored in tombstone metadata; source row remains present until terminal commit; concurrent lease conflicts are skipped for the current lease call and remain visible to the next status/worker pass rather than failing the batch.
- **Integration points:** worker prompt construction, output application, ingest status aggregation, migration tests.

## File Responsibility Map

**Modify:**
- `src/memory/ingest-types.ts` - add row/type shapes for leased tombstones and completion layers if needed by later chunks.
- `src/memory/migrations.ts` - add tombstone metadata needed for retry/job history if not stored safely in existing JSON.
- `src/memory/experience.ts` - add lease-stub and terminal commit helpers beside the existing claim/delete compatibility helpers.

**Test:**
- `src/memory/experience.test.ts` - lease selection, raw-row retention, duplicate prevention, retry reuse, terminal commit deletion.
- `src/memory/db.test.ts` - migration/schema expectations for any new tombstone column or JSON contract.

## Implementation Tasks

### Task 1: Add lease-stub tests before changing helpers

**Files:**
- Modify: `src/memory/experience.test.ts`

- [ ] **Step 1: Add tests for raw-row retention and duplicate prevention**

Add tests with this shape:

```ts
test("leaseExperienceEvents creates tombstone stubs without deleting source rows", () => {
  recordExperienceEvent(db, {
    id: "evt_1",
    project_key: "demo",
    occurred_at: "2026-06-15T09:00:00.000Z",
    provider: "codex",
    raw_text: "useful evidence",
    raw_payload_json: JSON.stringify({ message: "useful evidence" }),
    source: "codex-hook",
    status: "valid",
  });

  const leased = leaseExperienceEvents(db, {
    ingest_job_id: "job_1",
    project_key: "demo",
    provider_session_id: "sess_1",
    limit: 10,
    max_prompt_chars: 100_000,
    prompt_chars_for_lease: (lease) => JSON.stringify(lease.prompt_evidence).length,
    claimed_at: "2026-06-15T09:01:00.000Z",
    tombstone_id_for: (event) => `tomb_job_1_${event.id}`,
  });

  expect(leased).toHaveLength(1);
  expect(listExperienceEvents(db, "demo").map((row) => row.id)).toEqual(["evt_1"]);
  expect(
    db.query("SELECT id, original_event_id, state, finalized_at, retained_evidence_json FROM experience_event_tombstones").all(),
  ).toEqual([
    {
      id: "tomb_job_1_evt_1",
      original_event_id: "evt_1",
      state: "claimed",
      finalized_at: null,
      retained_evidence_json: JSON.stringify({}),
    },
  ]);

  const second = leaseExperienceEvents(db, {
    ingest_job_id: "job_2",
    project_key: "demo",
    limit: 10,
    claimed_at: "2026-06-15T09:02:00.000Z",
    tombstone_id_for: (event) => `tomb_job_2_${event.id}`,
  });
  expect(second).toEqual([]);
});
```

- [ ] **Step 2: Add test for retry reuse**

```ts
test("recoverStaleTombstoneLease reuses the same tombstone identity and appends attempt history", () => {
  seedExperienceEvent(db, "demo", "evt_1");
  leaseExperienceEvents(db, {
    ingest_job_id: "job_1",
    project_key: "demo",
    limit: 1,
    claimed_at: "2026-06-15T09:01:00.000Z",
    tombstone_id_for: () => "tomb_evt_1",
  });

  const recovered = recoverStaleTombstoneLease(db, {
    tombstone_id: "tomb_evt_1",
    next_ingest_job_id: "job_2",
    recovered_at: "2026-06-15T09:10:00.000Z",
    reason: "provider_timeout",
  });

  expect(recovered.id).toBe("tomb_evt_1");
  expect(recovered.ingest_job_id).toBe("job_2");
  const source = db.query("SELECT id FROM experience_events WHERE id = ?").get("evt_1");
  expect(source).toEqual({ id: "evt_1" });
  const row = db.query("SELECT source_metadata_json FROM experience_event_tombstones WHERE id = ?").get("tomb_evt_1") as {
    source_metadata_json: string;
  };
  expect(JSON.parse(row.source_metadata_json).attempts).toEqual([
    { ingest_job_id: "job_1", ended_at: "2026-06-15T09:10:00.000Z", reason: "provider_timeout" },
  ]);
});
```

- [ ] **Step 3: Add tests for conflict skip behavior**

Cover two concrete conflict cases. The selected behavior is: `leaseExperienceEvents` skips the conflicted row, does not throw, leaves the existing tombstone as the lease guard when present, and continues to later eligible rows when available.

Already-guarded expectations:

- an already-claimed stub for `evt_1` prevents a new tombstone for `evt_1`;
- the source row remains in `experience_events`;
- if `evt_2` is unleased, the same call may lease `evt_2`;
- `recordExperienceEvent` still returns `null` when a non-terminal tombstone exists for the same event id or dedupe key.

Insert-race expectations:

- seed `evt_1`;
- seed any existing tombstone row with id `tomb_conflict`;
- call `leaseExperienceEvents` with `tombstone_id_for: () => "tomb_conflict"` so the insert is ignored by the unique primary-key conflict;
- assert the call returns `[]`, does not throw, and leaves `evt_1` in `experience_events`.

- [ ] **Step 4: Run the focused test**

Run: `bun test src/memory/experience.test.ts`
Expected: fails because `leaseExperienceEvents` and `recoverStaleTombstoneLease` do not exist yet.

### Task 2: Implement lease-stub helper contracts

**Files:**
- Modify: `src/memory/experience.ts`
- Modify: `src/memory/ingest-types.ts`

- [ ] **Step 1: Add the lease input/output types**

Use these names so later chunks can depend on them:

```ts
export type LeasedExperienceEvent = ClaimedExperienceTombstone & {
  prompt_evidence: {
    raw_text: string | null;
    raw_payload_json: string;
  };
};

export type LeaseExperienceEventsInput = {
  ingest_job_id: string;
  project_key: string;
  provider_session_id?: string | null;
  limit: number;
  max_prompt_chars?: number;
  prompt_chars_for_lease?: (lease: LeasedExperienceEvent) => number;
  claimed_at: string;
  tombstone_id_for: (event: ExperienceEventRow) => string;
};
```

- [ ] **Step 2: Add unleased row selection for the new lease API**

Implement unleased selection by excluding active tombstone stubs:

```ts
function selectUnleasedExperienceEvents(db: Database, projectKey: string, limit: number): ExperienceEventRow[] {
  return db
    .query(
      `SELECT e.*
       FROM experience_events e
       WHERE e.project_key = ?
         AND NOT EXISTS (
           SELECT 1
           FROM experience_event_tombstones t
           WHERE t.project_key = e.project_key
             AND t.state = 'claimed'
             AND (
               t.original_event_id = e.id
               OR (e.dedupe_key IS NOT NULL AND t.dedupe_key = e.dedupe_key)
             )
         )
       ORDER BY e.occurred_at, e.id
       LIMIT ?`,
    )
    .all(projectKey, limit) as ExperienceEventRow[];
}
```

- [ ] **Step 3: Add `leaseExperienceEvents` with skip-on-conflict semantics**

```ts
export function leaseExperienceEvents(db: Database, input: LeaseExperienceEventsInput): LeasedExperienceEvent[] {
  if (!Number.isInteger(input.limit) || input.limit <= 0) {
    throw new Error("Lease limit must be a positive integer");
  }

  return db.transaction(() => {
    const rows = selectUnleasedExperienceEvents(db, input.project_key, input.limit);
    const leased: LeasedExperienceEvent[] = [];
    let promptChars = 0;

    for (const row of rows) {
      const lease = buildLeasedExperienceEvent(row, {
        id: input.tombstone_id_for(row),
        ingest_job_id: input.ingest_job_id,
        provider_session_id: input.provider_session_id,
        claimed_at: input.claimed_at,
      });
      const leasePromptChars = input.prompt_chars_for_lease?.(lease) ?? JSON.stringify(lease, null, 2).length;
      if (input.max_prompt_chars !== undefined && leased.length > 0 && promptChars + leasePromptChars > input.max_prompt_chars) {
        break;
      }
      const inserted = insertTombstoneLeaseStub(db, lease, row.dedupe_key);
      if (!inserted) continue;
      leased.push(lease);
      promptChars += leasePromptChars;
    }

    return leased;
  })();
}
```

- [ ] **Step 4: Implement lease object and idempotent stub insert**

```ts
function buildLeasedExperienceEvent(
  row: ExperienceEventRow,
  input: { id: string; ingest_job_id: string; provider_session_id?: string | null; claimed_at: string },
): LeasedExperienceEvent {
  return {
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
      attempts: [],
    }),
    retained_evidence_json: JSON.stringify({}),
    prompt_evidence: {
      raw_text: row.raw_text,
      raw_payload_json: row.raw_payload_json,
    },
  };
}

function insertTombstoneLeaseStub(db: Database, lease: LeasedExperienceEvent, dedupeKey: string | null): boolean {
  const result = db.query(
    `INSERT OR IGNORE INTO experience_event_tombstones
      (id, original_event_id, dedupe_key, project_key, ingest_job_id, provider, provider_session_id,
       claimed_at, finalized_at, state, terminal_decision, source_metadata_json, retained_evidence_json,
       output_references_json)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, NULL, 'claimed', NULL, ?, ?, ?)`,
  ).run(
    lease.id,
    lease.original_event_id,
    dedupeKey,
    lease.project_key,
    lease.ingest_job_id,
    lease.provider,
    lease.provider_session_id,
    lease.claimed_at,
    lease.source_metadata_json,
    JSON.stringify({}),
    JSON.stringify([]),
  );
  return result.changes === 1;
}
```

- [ ] **Step 5: Preserve existing claim/delete APIs unchanged**

Existing callers still import `claimExperienceEvents` before Chunk 02 runs. Keep the old functions in place with their current claim/delete behavior so the current worker can still build prompts from `retained_evidence_json` and existing worker tests keep passing after this chunk. Do not turn `claimExperienceEvents` into a wrapper around `leaseExperienceEvents`.

Chunk 02 must stop using the old claim/delete APIs in worker code and call `leaseExperienceEvents` directly.

### Task 3: Add stale-stub recovery helper

**Files:**
- Modify: `src/memory/experience.ts`

- [ ] **Step 1: Implement retry-history append**

```ts
export function recoverStaleTombstoneLease(
  db: Database,
  input: {
    tombstone_id: string;
    next_ingest_job_id: string;
    recovered_at: string;
    reason: string;
  },
): ClaimedExperienceTombstone {
  return db.transaction(() => {
    const existing = db
      .query("SELECT * FROM experience_event_tombstones WHERE id = ? AND state = 'claimed'")
      .get(input.tombstone_id) as ClaimedExperienceTombstone | null;
    if (!existing) throw new Error(`Unknown claimed tombstone lease: ${input.tombstone_id}`);

    const source = db
      .query("SELECT id FROM experience_events WHERE id = ? AND project_key = ?")
      .get(existing.original_event_id, existing.project_key);
    if (!source) throw new Error(`Cannot recover tombstone lease without source row: ${input.tombstone_id}`);

    const metadata = JSON.parse(existing.source_metadata_json) as Record<string, unknown>;
    const attempts = Array.isArray(metadata.attempts) ? metadata.attempts : [];
    metadata.attempts = [
      ...attempts,
      { ingest_job_id: existing.ingest_job_id, ended_at: input.recovered_at, reason: input.reason },
    ];

    db.query(
      `UPDATE experience_event_tombstones
       SET ingest_job_id = ?, claimed_at = ?, source_metadata_json = ?
       WHERE id = ? AND state = 'claimed'`,
    ).run(input.next_ingest_job_id, input.recovered_at, JSON.stringify(metadata), input.tombstone_id);

    return db.query("SELECT * FROM experience_event_tombstones WHERE id = ?").get(input.tombstone_id) as ClaimedExperienceTombstone;
  })();
}
```

### Task 4: Add terminal population helpers for accepted terminal outcomes

**Files:**
- Modify: `src/memory/experience.ts`
- Modify: `src/memory/experience.test.ts`

- [ ] **Step 1: Add test for terminal commit**

```ts
test("finalizeLeasedExperienceEvents populates tombstone evidence and deletes source rows", () => {
  seedExperienceEvent(db, "demo", "evt_1");
  leaseExperienceEvents(db, {
    ingest_job_id: "job_1",
    project_key: "demo",
    limit: 1,
    claimed_at: "2026-06-15T09:01:00.000Z",
    tombstone_id_for: () => "tomb_evt_1",
  });

  finalizeLeasedExperienceEventsInOpenTransaction(db, {
    ingest_job_id: "job_1",
    tombstone_ids: ["tomb_evt_1"],
    finalized_at: "2026-06-15T09:05:00.000Z",
    state: "output",
    terminal_decision: "output",
    output_references: ["session_memories/mem_1"],
  });

  expect(listExperienceEvents(db, "demo")).toEqual([]);
  const tombstone = db.query("SELECT state, retained_evidence_json, output_references_json FROM experience_event_tombstones WHERE id = ?").get("tomb_evt_1") as {
    state: string;
    retained_evidence_json: string;
    output_references_json: string;
  };
  expect(tombstone.state).toBe("output");
  expect(JSON.parse(tombstone.retained_evidence_json)).toEqual({ raw_text: null, raw_payload_json: "{}" });
  expect(JSON.parse(tombstone.output_references_json)).toEqual(["session_memories/mem_1"]);
});
```

- [ ] **Step 2: Implement `finalizeLeasedExperienceEventsInOpenTransaction`**

This helper is only for accepted terminal processing that is allowed to remove the source row: `state: "output"` with output references, or `state: "no_output"` after accepted provider output explicitly leaves a lease without generated memory. It must reject `failed` and `unfinished`; provider failure before accepted output must leave source rows present and the lease stub recoverable.

```ts
export function finalizeLeasedExperienceEventsInOpenTransaction(
  db: Database,
  input: FinalizeClaimedExperienceEventsInput & { state: "output" | "no_output" },
): void {
  if (input.tombstone_ids.length === 0) return;
  if (input.state === "output" && input.output_references.length === 0) {
    throw new Error("Output tombstones require at least one output reference");
  }

  for (const id of input.tombstone_ids) {
    const tombstone = db
      .query("SELECT * FROM experience_event_tombstones WHERE id = ? AND ingest_job_id = ? AND state = 'claimed'")
      .get(id, input.ingest_job_id) as ClaimedExperienceTombstone | null;
    if (!tombstone) throw new Error(`Unable to finalize claimed tombstone: ${id}`);

    const source = db
      .query("SELECT * FROM experience_events WHERE id = ? AND project_key = ?")
      .get(tombstone.original_event_id, tombstone.project_key) as ExperienceEventRow | null;
    if (!source) throw new Error(`Unable to finalize tombstone without source row: ${id}`);

    db.query(
      `UPDATE experience_event_tombstones
       SET finalized_at = ?, state = ?, terminal_decision = ?, retained_evidence_json = ?, output_references_json = ?
       WHERE id = ? AND ingest_job_id = ? AND state = 'claimed'`,
    ).run(
      input.finalized_at,
      input.state,
      input.terminal_decision,
      JSON.stringify({ raw_text: source.raw_text, raw_payload_json: source.raw_payload_json }),
      JSON.stringify(input.output_references),
      id,
      input.ingest_job_id,
    );
    db.query("DELETE FROM experience_events WHERE id = ? AND project_key = ?").run(source.id, source.project_key);
  }
}
```

Do not alias `finalizeClaimedExperienceEventsInOpenTransaction` to this helper in Chunk 01. Existing worker failure paths still import the old name and must retain old behavior until Chunk 02 replaces those paths.

- [ ] **Step 3: Implement remaining-lease finalization**

Normal worker completion after accepted provider output needs to terminalize any leased rows that the provider explicitly left without output. Add:

```ts
export function finalizeRemainingLeasedExperienceEvents(
  db: Database,
  input: {
    ingest_job_id: string;
    finalized_at: string;
    state: "no_output";
    terminal_decision: string;
  },
): number {
  const rows = db
    .query("SELECT id FROM experience_event_tombstones WHERE ingest_job_id = ? AND state = 'claimed' ORDER BY claimed_at, id")
    .all(input.ingest_job_id) as Array<{ id: string }>;

  for (const row of rows) {
    finalizeLeasedExperienceEventsInOpenTransaction(db, {
      ingest_job_id: input.ingest_job_id,
      tombstone_ids: [row.id],
      finalized_at: input.finalized_at,
      state: input.state,
      terminal_decision: input.terminal_decision,
      output_references: [],
    });
  }

  return rows.length;
}
```

Do not replace `finalizeRemainingClaimedExperienceEvents` in this chunk. Existing runtime/status code still imports that name and Chunk 02 owns removing old failure-time finalization behavior. This chunk adds the new helper beside the old one.

### Task 5: Update counts for status consumers

**Files:**
- Modify: `src/memory/experience.ts`
- Test: `src/memory/experience.test.ts`

- [ ] **Step 1: Add count helpers**

```ts
export function countLeasedExperienceEvents(db: Database, projectKey: string): number {
  const row = db
    .query(
      `SELECT count(*) AS count
       FROM experience_event_tombstones t
       JOIN experience_events e ON e.id = t.original_event_id AND e.project_key = t.project_key
       WHERE t.project_key = ? AND t.state = 'claimed'`,
    )
    .get(projectKey) as { count: number };
  return row.count;
}

export function countUnleasedExperienceEvents(db: Database, projectKey: string): number {
  const row = db
    .query(
      `SELECT count(*) AS count
       FROM experience_events e
       WHERE e.project_key = ?
         AND NOT EXISTS (
           SELECT 1 FROM experience_event_tombstones t
           WHERE t.project_key = e.project_key
             AND t.state = 'claimed'
             AND (t.original_event_id = e.id OR (e.dedupe_key IS NOT NULL AND t.dedupe_key = e.dedupe_key))
         )`,
    )
    .get(projectKey) as { count: number };
  return row.count;
}
```

### Verification

Before running tests, add this local test helper if `src/memory/experience.test.ts` does not already have an equivalent:

```ts
function seedExperienceEvent(db: MemoryDb, projectKey: string, id: string): void {
  recordExperienceEvent(db, {
    id,
    project_key: projectKey,
    occurred_at: "2026-06-15T09:00:00.000Z",
    provider: "codex",
    raw_text: null,
    raw_payload_json: "{}",
    source: "codex-hook",
    status: "valid",
  });
}
```

Run: `bun test src/memory/experience.test.ts src/memory/db.test.ts`
Expected: all tests pass, including lease-stub raw-row retention and terminal commit deletion.

Run: `bun test src/ingest/worker.test.ts`
Expected: still passes, proving Chunk 01 did not break current worker behavior before Chunk 02 migrates it.

Run: `bun run typecheck`
Expected: typecheck exits 0.

Run: `git diff --check`
Expected: no output.

## Acceptance Criteria Covered

- Tombstone-backed lease stubs keep raw rows present until accepted terminal processing.
- One tombstone identity per source row is preserved.
- Stale-stub recovery reuses the same tombstone and appends attempt/job history.
- Terminal commit populates retained evidence and deletes the source row atomically.

## Risks And Rollback

- Risk: changing `recordExperienceEvent` dedupe behavior around non-terminal tombstones could drop legitimate retries. Keep current insert dedupe unless tests prove a gap.
- Risk: storing retry history in `source_metadata_json` can make metadata multi-purpose. If implementation finds the shape noisy, add a migration column such as `attempts_json` in this chunk and update tests before dependent chunks.
- Rollback: helpers are isolated in `src/memory/experience.ts`; revert this chunk before worker migration if lease semantics fail tests.

## Non-Goals

- No provider invocation changes.
- No CLI/status output changes.
- No Session Memory embedding/query work.
- No scheduler or retry daemon.

## Type And Name Consistency

Use the exact exported names `leaseExperienceEvents`, `LeasedExperienceEvent`, `recoverStaleTombstoneLease`, `finalizeLeasedExperienceEventsInOpenTransaction`, `countLeasedExperienceEvents`, and `countUnleasedExperienceEvents` in later chunks.
