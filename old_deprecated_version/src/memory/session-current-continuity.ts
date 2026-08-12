import type { Database } from "bun:sqlite";
import type {
  ExperienceEventRow,
} from "./experience.ts";
import type {
  ExperienceEventTombstoneRow,
  IngestJobRow,
  SessionMemoryKind,
  SessionMemoryRow,
} from "./ingest-types.ts";
import { listSessionMemoryContexts } from "./session-memory-contexts.ts";
import { isSessionMemoryControlEventKind } from "./session-memory-policy.ts";
import {
  SESSION_CONTINUITY_REASON_CODES,
  type SessionContinuityChannel,
  type SessionContinuityChannelName,
  type SessionContinuityExclusion,
  type SessionContinuityExclusionReason,
  type SessionContinuityItem,
  type SessionContinuityProvenance,
  type SessionContinuityReasonCode,
  type SessionCurrentContinuityV1,
} from "./session-current-continuity-types.ts";

type EligibleMemory = {
  row: SessionMemoryRow;
  job: IngestJobRow;
  provenance: SessionContinuityProvenance;
  contexts: ReturnType<typeof listSessionMemoryContexts>;
};

type IneligibleMemory = {
  row: SessionMemoryRow;
  reason: SessionContinuityExclusionReason;
};

type IngestJobGroup = {
  ingest_job_id: string;
  latest_memory_created_at: string;
  memories: EligibleMemory[];
};

type TombstoneCache = Map<string, ExperienceEventTombstoneRow | null>;
type JobCache = Map<string, IngestJobRow | null>;

export function selectSessionCurrentContinuity(
  db: Database,
  projectKey: string,
): SessionCurrentContinuityV1 {
  const rows = db
    .query(
      `SELECT *
       FROM session_memories
       WHERE project_key = ?
         AND status = 'active'
       ORDER BY created_at DESC, id ASC`,
    )
    .all(projectKey) as SessionMemoryRow[];
  const jobs: JobCache = new Map();
  const tombstones: TombstoneCache = new Map();
  const eligible: EligibleMemory[] = [];
  const ineligible: IneligibleMemory[] = [];

  for (const row of rows) {
    const result = classifyMemory(db, row, jobs, tombstones);
    if ("reason" in result) ineligible.push(result);
    else eligible.push(result);
  }

  const anchorGroup = latestIngestJobGroup(eligible);
  const selectedGroups = {
    current_state: latestIngestJobGroup(eligible.filter((item) => item.row.memory_kind === "continuity")),
    completed_outcomes: latestIngestJobGroup(eligible.filter((item) => item.row.memory_kind === "verification")),
    recent_decisions: latestIngestJobGroup(eligible.filter((item) => item.row.memory_kind === "decision")),
  };
  const exclusions = relevantExclusions(ineligible, anchorGroup, selectedGroups);
  const anchorJobId = anchorGroup?.ingest_job_id ?? null;
  const currentState = latestJobChannel(selectedGroups.current_state, anchorJobId);
  const completedOutcomes = latestJobChannel(selectedGroups.completed_outcomes, anchorJobId);
  const recentDecisions = latestJobChannel(selectedGroups.recent_decisions, anchorJobId);
  const activeBlockers = allActiveChannel(
    eligible.filter((item) => item.row.memory_kind === "blocker"),
    anchorJobId,
  );
  const nextActions = allActiveChannel(
    eligible.filter((item) => item.row.memory_kind === "next_action"),
    anchorJobId,
  );
  const freshness = inspectFreshness(db, projectKey);
  const selectedItems = [
    ...currentState.items,
    ...completedOutcomes.items,
    ...activeBlockers.items,
    ...nextActions.items,
    ...recentDecisions.items,
  ];
  const mixedProvenance = selectedItems.some((item) => item.provenance.state === "mixed_control_content")
    || anchorGroup?.memories.some((item) => item.provenance.state === "mixed_control_content") === true;
  const integrity = mixedProvenance || exclusions.length > 0 ? "degraded" : "valid";
  const reasonCodes = buildReasonCodes({
    anchorAvailable: Boolean(anchorGroup),
    freshness,
    mixedProvenance,
    newerIneligibleIngestJob: exclusions.some((item) => item.channel === "anchor_job"),
    channelMemoryExcluded: exclusions.some((item) => item.channel !== "anchor_job"),
  });
  const state = !anchorGroup
    ? "unavailable"
    : integrity === "degraded"
      ? "degraded"
      : freshness.state === "lagging"
        ? "lagging"
        : "ready";

  return {
    contract_version: "myelin.session_continuity.v1",
    kind: "session_current_continuity",
    state,
    reason_codes: reasonCodes,
    freshness,
    integrity: { state: integrity },
    anchor_job: anchorGroup
      ? {
          ingest_job_id: anchorGroup.ingest_job_id,
          latest_memory_created_at: anchorGroup.latest_memory_created_at,
          job_status: anchorGroup.memories[0].job.status,
          provenance_state: anchorGroup.memories.some((item) => item.provenance.state === "mixed_control_content")
            ? "mixed_control_content"
            : "content_only",
          memory_ids: anchorGroup.memories.map((item) => item.row.id).sort(),
        }
      : null,
    current_state: currentState,
    completed_outcomes: completedOutcomes,
    active_blockers: activeBlockers,
    next_actions: nextActions,
    recent_decisions: recentDecisions,
    exclusions,
  };
}

export function unavailableSessionCurrentContinuity(): SessionCurrentContinuityV1 {
  const emptyLatest = emptyChannel("latest_eligible_ingest_job");
  return {
    contract_version: "myelin.session_continuity.v1",
    kind: "session_current_continuity",
    state: "unavailable",
    reason_codes: ["no_eligible_anchor_job"],
    freshness: {
      state: "current",
      queued_content_events: 0,
      unleased_content_events: 0,
      leased_content_events: 0,
      running_ingest_jobs: 0,
    },
    integrity: { state: "valid" },
    anchor_job: null,
    current_state: emptyLatest,
    completed_outcomes: emptyChannel("latest_eligible_ingest_job"),
    active_blockers: emptyChannel("all_eligible_active"),
    next_actions: emptyChannel("all_eligible_active"),
    recent_decisions: emptyChannel("latest_eligible_ingest_job"),
    exclusions: [],
  };
}

function classifyMemory(
  db: Database,
  row: SessionMemoryRow,
  jobs: JobCache,
  tombstones: TombstoneCache,
): EligibleMemory | IneligibleMemory {
  if (!row.ingest_job_id) return { row, reason: "missing_ingest_job_id" };
  const job = cachedJob(db, row.ingest_job_id, jobs);
  if (!job || job.project_key !== row.project_key) return { row, reason: "missing_ingest_job" };
  const sourceRefs = parseStringArray(row.source_event_refs_json);
  if (!sourceRefs || sourceRefs.length === 0) return { row, reason: "missing_source_reference" };

  const contentRefs: string[] = [];
  const controlRefs: string[] = [];
  for (const sourceRef of sourceRefs) {
    const tombstone = cachedTombstone(db, sourceRef, tombstones);
    if (!tombstone) return { row, reason: "missing_tombstone" };
    if (tombstone.project_key !== row.project_key) return { row, reason: "foreign_project_tombstone" };
    if (tombstone.ingest_job_id !== row.ingest_job_id) return { row, reason: "cross_job_tombstone" };
    if (tombstone.state !== "output") return { row, reason: "non_output_tombstone" };
    const outputReferences = parseStringArray(tombstone.output_references_json);
    if (!outputReferences?.includes(`session_memories/${row.id}`)) {
      return { row, reason: "missing_output_backreference" };
    }
    const eventKind = parseEventKind(tombstone.source_metadata_json);
    if (!eventKind) return { row, reason: "malformed_source_metadata" };
    if (isSessionMemoryControlEventKind(eventKind)) controlRefs.push(sourceRef);
    else contentRefs.push(sourceRef);
  }

  if (contentRefs.length === 0) return { row, reason: "control_only_provenance" };
  return {
    row,
    job,
    contexts: listSessionMemoryContexts(db, row.id),
    provenance: {
      state: controlRefs.length > 0 ? "mixed_control_content" : "content_only",
      source_event_refs: [...sourceRefs].sort(),
      content_event_refs: contentRefs.sort(),
      control_event_refs: controlRefs.sort(),
    },
  };
}

function latestIngestJobGroup(memories: EligibleMemory[]): IngestJobGroup | null {
  const groups = new Map<string, EligibleMemory[]>();
  for (const memory of memories) {
    const group = groups.get(memory.row.ingest_job_id as string) ?? [];
    group.push(memory);
    groups.set(memory.row.ingest_job_id as string, group);
  }
  return [...groups.entries()]
    .map(([ingestJobId, items]) => ({
      ingest_job_id: ingestJobId,
      latest_memory_created_at: items.reduce(
        (latest, item) => item.row.created_at > latest ? item.row.created_at : latest,
        items[0].row.created_at,
      ),
      memories: [...items].sort(compareEligibleMemories),
    }))
    .sort(compareIngestJobGroups)[0] ?? null;
}

function latestJobChannel(group: IngestJobGroup | null, anchorJobId: string | null): SessionContinuityChannel {
  if (!group) return emptyChannel("latest_eligible_ingest_job");
  return {
    selection: "latest_eligible_ingest_job",
    selected_ingest_job_id: group.ingest_job_id,
    items: group.memories.map((memory) => continuityItem(memory, anchorJobId)),
  };
}

function allActiveChannel(memories: EligibleMemory[], anchorJobId: string | null): SessionContinuityChannel {
  return {
    selection: "all_eligible_active",
    selected_ingest_job_id: null,
    items: [...memories].sort(compareEligibleMemories).map((memory) => continuityItem(memory, anchorJobId)),
  };
}

function continuityItem(memory: EligibleMemory, anchorJobId: string | null): SessionContinuityItem {
  return {
    id: memory.row.id,
    memory_kind: memory.row.memory_kind,
    title: memory.row.title,
    summary: memory.row.summary,
    confidence: memory.row.confidence,
    risk: memory.row.risk,
    created_at: memory.row.created_at,
    updated_at: memory.row.updated_at,
    ingest_job_id: memory.row.ingest_job_id as string,
    relation_to_anchor: memory.row.ingest_job_id === anchorJobId ? "anchor_job" : "prior_job",
    provenance: structuredClone(memory.provenance),
    contexts: structuredClone(memory.contexts),
  };
}

function relevantExclusions(
  memories: IneligibleMemory[],
  anchorGroup: IngestJobGroup | null,
  selectedGroups: {
    current_state: IngestJobGroup | null;
    completed_outcomes: IngestJobGroup | null;
    recent_decisions: IngestJobGroup | null;
  },
): SessionContinuityExclusion[] {
  const exclusions: SessionContinuityExclusion[] = [];
  for (const memory of memories) {
    if (isNewerThanGroup(memory.row, anchorGroup)) {
      exclusions.push({ memory_id: memory.row.id, channel: "anchor_job", reason: memory.reason });
    }
    const channel = channelForKind(memory.row.memory_kind);
    if (
      channel === "active_blockers"
      || channel === "next_actions"
      || isNewerThanGroup(memory.row, selectedGroup(channel, selectedGroups))
    ) {
      exclusions.push({ memory_id: memory.row.id, channel, reason: memory.reason });
    }
  }
  return exclusions.sort(
    (left, right) => left.channel.localeCompare(right.channel) || left.memory_id.localeCompare(right.memory_id),
  );
}

function selectedGroup(
  channel: SessionContinuityChannelName,
  groups: {
    current_state: IngestJobGroup | null;
    completed_outcomes: IngestJobGroup | null;
    recent_decisions: IngestJobGroup | null;
  },
): IngestJobGroup | null {
  if (channel === "current_state") return groups.current_state;
  if (channel === "completed_outcomes") return groups.completed_outcomes;
  if (channel === "recent_decisions") return groups.recent_decisions;
  return null;
}

function channelForKind(kind: SessionMemoryKind): Exclude<SessionContinuityChannelName, "anchor_job"> {
  if (kind === "continuity") return "current_state";
  if (kind === "verification") return "completed_outcomes";
  if (kind === "blocker") return "active_blockers";
  if (kind === "next_action") return "next_actions";
  return "recent_decisions";
}

function isNewerThanGroup(row: SessionMemoryRow, group: IngestJobGroup | null): boolean {
  if (!group) return true;
  if (row.created_at !== group.latest_memory_created_at) return row.created_at > group.latest_memory_created_at;
  if (!row.ingest_job_id) return true;
  return (row.ingest_job_id ?? row.id) > group.ingest_job_id;
}

function inspectFreshness(db: Database, projectKey: string): SessionCurrentContinuityV1["freshness"] {
  const events = (db
    .query("SELECT * FROM experience_events WHERE project_key = ? ORDER BY occurred_at, id")
    .all(projectKey) as ExperienceEventRow[])
    .filter((event) => !isSessionMemoryControlEventKind(event.event_kind));
  const claimed = db
    .query(
      `SELECT original_event_id, dedupe_key
       FROM experience_event_tombstones
       WHERE project_key = ?
         AND state = 'claimed'`,
    )
    .all(projectKey) as Array<{ original_event_id: string; dedupe_key: string | null }>;
  const claimedEventIds = new Set(claimed.map((item) => item.original_event_id));
  const claimedDedupeKeys = new Set(claimed.flatMap((item) => item.dedupe_key ? [item.dedupe_key] : []));
  const leased = events.filter(
    (event) => claimedEventIds.has(event.id) || (event.dedupe_key !== null && claimedDedupeKeys.has(event.dedupe_key)),
  ).length;
  const runningJobs = (
    db.query("SELECT count(*) AS count FROM ingest_jobs WHERE project_key = ? AND status = 'running'").get(projectKey) as
      | { count: number }
      | null
  )?.count ?? 0;
  const unleased = events.length - leased;
  return {
    state: events.length > 0 || runningJobs > 0 ? "lagging" : "current",
    queued_content_events: events.length,
    unleased_content_events: unleased,
    leased_content_events: leased,
    running_ingest_jobs: runningJobs,
  };
}

function buildReasonCodes(input: {
  anchorAvailable: boolean;
  freshness: SessionCurrentContinuityV1["freshness"];
  mixedProvenance: boolean;
  newerIneligibleIngestJob: boolean;
  channelMemoryExcluded: boolean;
}): SessionContinuityReasonCode[] {
  const reasons = new Set<SessionContinuityReasonCode>();
  if (!input.anchorAvailable) reasons.add("no_eligible_anchor_job");
  if (input.freshness.unleased_content_events > 0) reasons.add("content_events_unleased");
  if (input.freshness.leased_content_events > 0) reasons.add("content_events_leased");
  if (input.freshness.running_ingest_jobs > 0) reasons.add("ingest_running");
  if (input.mixedProvenance) reasons.add("mixed_control_content_provenance");
  if (input.newerIneligibleIngestJob) reasons.add("newer_ineligible_ingest_job");
  if (input.channelMemoryExcluded) reasons.add("channel_memory_excluded");
  return SESSION_CONTINUITY_REASON_CODES.filter((reason) => reasons.has(reason));
}

function emptyChannel(selection: SessionContinuityChannel["selection"]): SessionContinuityChannel {
  return { selection, selected_ingest_job_id: null, items: [] };
}

function compareEligibleMemories(left: EligibleMemory, right: EligibleMemory): number {
  return right.row.created_at.localeCompare(left.row.created_at) || left.row.id.localeCompare(right.row.id);
}

function compareIngestJobGroups(left: IngestJobGroup, right: IngestJobGroup): number {
  return right.latest_memory_created_at.localeCompare(left.latest_memory_created_at)
    || right.ingest_job_id.localeCompare(left.ingest_job_id);
}

function cachedJob(db: Database, id: string, cache: JobCache): IngestJobRow | null {
  if (!cache.has(id)) {
    cache.set(id, (db.query("SELECT * FROM ingest_jobs WHERE id = ?").get(id) as IngestJobRow | null) ?? null);
  }
  return cache.get(id) ?? null;
}

function cachedTombstone(db: Database, id: string, cache: TombstoneCache): ExperienceEventTombstoneRow | null {
  if (!cache.has(id)) {
    cache.set(
      id,
      (db.query("SELECT * FROM experience_event_tombstones WHERE id = ?").get(id) as ExperienceEventTombstoneRow | null)
        ?? null,
    );
  }
  return cache.get(id) ?? null;
}

function parseStringArray(value: string): string[] | null {
  try {
    const parsed = JSON.parse(value) as unknown;
    if (!Array.isArray(parsed) || parsed.some((item) => typeof item !== "string" || item.trim() === "")) return null;
    return [...new Set(parsed)];
  } catch {
    return null;
  }
}

function parseEventKind(value: string): string | null {
  try {
    const parsed = JSON.parse(value) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;
    const eventKind = (parsed as Record<string, unknown>).event_kind;
    return typeof eventKind === "string" && eventKind.trim() !== "" ? eventKind : null;
  } catch {
    return null;
  }
}
