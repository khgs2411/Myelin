import { expect, test } from "bun:test";
import type { Database } from "bun:sqlite";
import { createIngestJob, updateIngestJobStatus } from "../../src/ingest/jobs.ts";
import { openMemoryDbAt } from "../../src/memory/db.ts";
import { recordExperienceEvent } from "../../src/memory/experience.ts";
import type { SessionMemoryKind, TombstoneState } from "../../src/memory/ingest-types.ts";
import { withCompatibilityEventLeaseAdmission } from "../../src/memory/session-memory-write-firewall.ts";
import { selectSessionCurrentContinuity } from "../../src/memory/session-current-continuity.ts";
import type { SessionContinuityExclusionReason } from "../../src/memory/session-current-continuity-types.ts";
import {
  createSessionMemory,
  createSessionMemoryContexts,
  supersedeSessionMemory,
} from "../helpers/session-mutation-authority.ts";

const PROJECT = "demo";

test("anchors on the newest eligible ingest job and selects the approved continuity channels", () => {
  const db = openMemoryDbAt(":memory:");
  try {
    seedJob(db, "job_prior", "2026-08-09T09:00:00.000Z");
    seedMemory(db, {
      id: "mem_state",
      jobId: "job_prior",
      kind: "continuity",
      now: "2026-08-09T09:01:00.000Z",
      summary: "The reliability slice is implementing the approved status contract.",
    });
    seedMemory(db, {
      id: "mem_blocker",
      jobId: "job_prior",
      kind: "blocker",
      now: "2026-08-09T09:02:00.000Z",
      summary: "A stale-looking blocker still requires lifecycle review.",
    });
    seedMemory(db, {
      id: "mem_action",
      jobId: "job_prior",
      kind: "next_action",
      now: "2026-08-09T09:03:00.000Z",
      summary: "Finish the focused reliability verification.",
    });
    seedMemory(db, {
      id: "mem_decision",
      jobId: "job_prior",
      kind: "decision",
      now: "2026-08-09T09:04:00.000Z",
      summary: "Session Memory reliability remains ahead of Project Memory reliability.",
    });
    createSessionMemoryContexts(db, [{
      session_memory_id: "mem_state",
      project_key: PROJECT,
      repo_path: "/repo",
      git_branch: "master",
      source_event_ref: "tomb_mem_state",
    }]);

    seedJob(db, "job_anchor", "2026-08-09T10:00:00.000Z");
    seedMemory(db, {
      id: "mem_verification",
      jobId: "job_anchor",
      kind: "verification",
      now: "2026-08-09T10:01:00.000Z",
      summary: "The focused selector checks passed.",
    });
    seedMemory(db, {
      id: "mem_superseded",
      jobId: "job_anchor",
      kind: "blocker",
      now: "2026-08-09T10:02:00.000Z",
      summary: "This resolved blocker must not appear.",
    });
    supersedeSessionMemory(db, {
      id: "mem_superseded",
      projectKey: PROJECT,
      supersededBy: "mem_verification",
      reason: "resolved",
      now: "2026-08-09T10:03:00.000Z",
    });

    const result = selectSessionCurrentContinuity(db, PROJECT);

    expect(result.state).toBe("ready");
    expect(result.integrity.state).toBe("valid");
    expect(result.anchor_job).toMatchObject({
      ingest_job_id: "job_anchor",
      memory_ids: ["mem_verification"],
      provenance_state: "content_only",
    });
    expect(result.current_state.selected_ingest_job_id).toBe("job_prior");
    expect(result.current_state.items[0]).toMatchObject({
      id: "mem_state",
      relation_to_anchor: "prior_job",
      contexts: [{ repo_path: "/repo", git_branch: "master" }],
    });
    expect(result.completed_outcomes.items).toMatchObject([
      { id: "mem_verification", relation_to_anchor: "anchor_job" },
    ]);
    expect(result.active_blockers.items.map((item) => item.id)).toEqual(["mem_blocker"]);
    expect(result.next_actions.items.map((item) => item.id)).toEqual(["mem_action"]);
    expect(result.recent_decisions.items.map((item) => item.id)).toEqual(["mem_decision"]);
  } finally {
    db.close();
  }
});

test("accepts mixed content provenance as degraded and counts only queued content events", () => {
  const db = openMemoryDbAt(":memory:");
  try {
    seedJob(db, "job_anchor", "2026-08-09T10:00:00.000Z");
    seedMemory(db, {
      id: "mem_mixed",
      jobId: "job_anchor",
      kind: "continuity",
      now: "2026-08-09T10:01:00.000Z",
      eventKinds: ["assistant.response", "session.start"],
      summary: "Content remains usable even though its ingest job also preserved a control event.",
    });
    seedJob(db, "job_control_only", "2026-08-09T11:00:00.000Z");
    seedMemory(db, {
      id: "mem_control_only",
      jobId: "job_control_only",
      kind: "decision",
      now: "2026-08-09T11:01:00.000Z",
      eventKinds: ["session.start"],
      summary: "Control-only output is not eligible continuity evidence.",
    });
    seedJob(db, "job_running", "2026-08-09T12:00:00.000Z", "running");
    seedQueuedEvent(db, "event_control", "session.start", "2026-08-09T12:01:00.000Z");
    seedQueuedEvent(db, "event_leased", "assistant.response", "2026-08-09T12:02:00.000Z");
    seedQueuedEvent(db, "event_unleased", "user.prompt", "2026-08-09T12:03:00.000Z");
    seedTombstone(db, {
      id: "tomb_leased",
      originalEventId: "event_leased",
      jobId: "job_running",
      eventKind: "assistant.response",
      state: "claimed",
      outputReferences: [],
    });

    const result = selectSessionCurrentContinuity(db, PROJECT);

    expect(result.state).toBe("degraded");
    expect(result.integrity.state).toBe("degraded");
    expect(result.anchor_job).toMatchObject({
      ingest_job_id: "job_anchor",
      provenance_state: "mixed_control_content",
    });
    expect(result.reason_codes).toEqual([
      "content_events_unleased",
      "content_events_leased",
      "ingest_running",
      "mixed_control_content_provenance",
      "newer_ineligible_ingest_job",
      "channel_memory_excluded",
    ]);
    expect(result.freshness).toEqual({
      state: "lagging",
      queued_content_events: 2,
      unleased_content_events: 1,
      leased_content_events: 1,
      running_ingest_jobs: 1,
    });
    expect(result.exclusions).toContainEqual({
      memory_id: "mem_control_only",
      channel: "anchor_job",
      reason: "control_only_provenance",
    });
    expect(result.exclusions).toContainEqual({
      memory_id: "mem_control_only",
      channel: "recent_decisions",
      reason: "control_only_provenance",
    });
  } finally {
    db.close();
  }
});

test("fails closed for every structural provenance invariant", () => {
  const cases: Array<{
    reason: SessionContinuityExclusionReason;
    arrange: (db: Database) => void;
  }> = [
    {
      reason: "missing_ingest_job_id",
      arrange: (db) => seedMemory(db, { id: "mem", jobId: null, kind: "continuity" }),
    },
    {
      reason: "missing_ingest_job",
      arrange: (db) => {
        db.exec("PRAGMA foreign_keys = OFF");
        seedMemory(db, { id: "mem", jobId: "unknown", kind: "continuity" });
        db.exec("PRAGMA foreign_keys = ON");
      },
    },
    {
      reason: "missing_source_reference",
      arrange: (db) => {
        seedJob(db, "job");
        seedMemory(db, { id: "mem", jobId: "job", kind: "continuity", eventKinds: [] });
      },
    },
    {
      reason: "missing_tombstone",
      arrange: (db) => {
        seedJob(db, "job");
        createBareMemory(db, "mem", "job", ["missing"]);
      },
    },
    {
      reason: "foreign_project_tombstone",
      arrange: (db) => {
        seedJob(db, "job");
        seedCustomMemory(db, { tombstoneProject: "other" });
      },
    },
    {
      reason: "cross_job_tombstone",
      arrange: (db) => {
        seedJob(db, "job");
        seedJob(db, "other_job");
        seedCustomMemory(db, { tombstoneJobId: "other_job" });
      },
    },
    {
      reason: "non_output_tombstone",
      arrange: (db) => {
        seedJob(db, "job");
        seedCustomMemory(db, { tombstoneState: "no_output" });
      },
    },
    {
      reason: "missing_output_backreference",
      arrange: (db) => {
        seedJob(db, "job");
        seedCustomMemory(db, { outputReferences: [] });
      },
    },
    {
      reason: "malformed_source_metadata",
      arrange: (db) => {
        seedJob(db, "job");
        seedCustomMemory(db, { sourceMetadata: "{" });
      },
    },
    {
      reason: "control_only_provenance",
      arrange: (db) => {
        seedJob(db, "job");
        seedCustomMemory(db, { eventKind: "session.start" });
      },
    },
  ];

  for (const scenario of cases) {
    const db = openMemoryDbAt(":memory:");
    try {
      scenario.arrange(db);
      const result = selectSessionCurrentContinuity(db, PROJECT);
      expect(result.state, scenario.reason).toBe("unavailable");
      expect(result.reason_codes, scenario.reason).toContain("no_eligible_anchor_job");
      expect(result.exclusions, scenario.reason).toContainEqual({
        memory_id: "mem",
        channel: "anchor_job",
        reason: scenario.reason,
      });
    } finally {
      db.close();
    }
  }
});

function seedJob(
  db: Database,
  id: string,
  now = "2026-08-09T10:00:00.000Z",
  status: "completed" | "running" = "completed",
): void {
  createIngestJob(db, { id, project_key: PROJECT, provider: "codex", input: {}, now });
  updateIngestJobStatus(db, {
    id,
    status,
    updated_at: now,
    started_at: now,
    finished_at: status === "completed" ? now : null,
  });
}

function seedMemory(
  db: Database,
  input: {
    id: string;
    jobId: string | null;
    kind: SessionMemoryKind;
    now?: string;
    summary?: string;
    eventKinds?: string[];
  },
): void {
  const eventKinds = input.eventKinds ?? ["assistant.response"];
  const refs = eventKinds.map((eventKind, index) => `tomb_${input.id}_${index}`);
  for (const [index, eventKind] of eventKinds.entries()) {
    seedTombstone(db, {
      id: refs[index],
      originalEventId: `event_${input.id}_${index}`,
      jobId: input.jobId,
      eventKind,
      outputReferences: [`session_memories/${input.id}`],
    });
  }
  createBareMemory(db, input.id, input.jobId, refs, input.kind, input.now, input.summary);
}

function createBareMemory(
  db: Database,
  id: string,
  jobId: string | null,
  sourceEventRefs: string[],
  kind: SessionMemoryKind = "continuity",
  now = "2026-08-09T10:01:00.000Z",
  summary = `Summary for ${id}`,
): void {
  createSessionMemory(db, {
    id,
    project_key: PROJECT,
    ingest_job_id: jobId,
    source_event_refs: sourceEventRefs,
    memory_kind: kind,
    title: id,
    summary,
    payload: {},
    confidence: "high",
    risk: "low",
    now,
    embedding_contract: null,
  });
}

function seedCustomMemory(
  db: Database,
  options: {
    tombstoneProject?: string;
    tombstoneJobId?: string;
    tombstoneState?: TombstoneState;
    outputReferences?: string[];
    sourceMetadata?: string;
    eventKind?: string;
  },
): void {
  seedTombstone(db, {
    id: "tomb_mem",
    originalEventId: "event_mem",
    projectKey: options.tombstoneProject,
    jobId: options.tombstoneJobId ?? "job",
    state: options.tombstoneState,
    outputReferences: options.outputReferences ?? ["session_memories/mem"],
    sourceMetadata: options.sourceMetadata,
    eventKind: options.eventKind,
  });
  createBareMemory(db, "mem", "job", ["tomb_mem"]);
}

function seedTombstone(
  db: Database,
  input: {
    id: string;
    originalEventId: string;
    jobId: string | null;
    projectKey?: string;
    eventKind?: string;
    sourceMetadata?: string;
    state?: TombstoneState;
    outputReferences: string[];
  },
): void {
  const projectKey = input.projectKey ?? PROJECT;
  withCompatibilityEventLeaseAdmission(db, projectKey, () => db.query(
    `INSERT INTO experience_event_tombstones
      (id, original_event_id, dedupe_key, project_key, ingest_job_id, provider, provider_session_id,
       claimed_at, finalized_at, state, terminal_decision, source_metadata_json, retained_evidence_json,
       output_references_json)
     VALUES (?, ?, NULL, ?, ?, 'codex', NULL, ?, ?, ?, ?, ?, '{}', ?)`,
  ).run(
    input.id,
    input.originalEventId,
    projectKey,
    input.jobId,
    "2026-08-09T10:00:00.000Z",
    input.state === "claimed" ? null : "2026-08-09T10:01:00.000Z",
    input.state ?? "output",
    input.state === "claimed" ? null : input.state ?? "output",
    input.sourceMetadata ?? JSON.stringify({ event_kind: input.eventKind ?? "assistant.response" }),
    JSON.stringify(input.outputReferences),
  ));
}

function seedQueuedEvent(db: Database, id: string, eventKind: string, occurredAt: string): void {
  recordExperienceEvent(db, {
    id,
    project_key: PROJECT,
    occurred_at: occurredAt,
    event_kind: eventKind,
    provider: "codex",
    raw_text: id,
    raw_payload_json: "{}",
    source: "test",
    status: "valid",
  }, new Date(occurredAt));
}
