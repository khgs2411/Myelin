import { stat } from "node:fs/promises";
import { memoryDbPath, openMemoryDb } from "../memory/db.ts";
import { listMemoryCandidates } from "../memory/candidates.ts";
import { listHandoffInstructions } from "../memory/handoffs.ts";
import type { HandoffInstructionRow, MemoryCandidateRow, SessionMemoryRow } from "../memory/ingest-types.ts";
import { listSessionMemories } from "../memory/session-memories.ts";
import { projectPath } from "../runtime/fs.ts";
import { readJsonIfExists } from "../runtime/json.ts";
import { findProject } from "../runtime/projects.ts";
import {
  loadProjectMemoryCorpus,
  lookupProjectMemory,
  type ProjectMemoryPage,
} from "./project-memory-lookup.ts";
import type {
  ProjectMemoryLookupQualitySummary,
  ProjectMemoryLookupResult,
} from "./project-memory-retrieval-contracts.ts";
import {
  extractProjectMemorySections,
  type ProjectMemoryMarkdownSection,
} from "./project-memory-markdown-sections.ts";
import {
  priorityForProjectMemoryLead,
  producerKindForLead,
  type ProjectMemoryLeadPriority,
} from "./project-memory-producer-boundary.ts";

export type ProjectMemoryPacket = {
  schema_version: 1;
  project_key: string;
  mode: "create" | "maintain";
  project: {
    key: string;
    name: string;
    lifecycle: "active" | "legacy" | "deprecated";
    repo_paths: string[];
  };
  state: {
    bootstrap_state: unknown | null;
    project_memory: unknown | null;
    freshness: unknown | null;
    pages_manifest: unknown | null;
  };
  wiki: {
    page_count: number;
    pages: ProjectMemoryPage[];
    sections: ProjectMemoryMarkdownSection[];
  };
  pending: {
    project_handoffs: PacketHandoff[];
    project_candidates: PacketCandidate[];
  };
  session_memory: {
    selected: PacketSessionMemory[];
  };
  lookup: {
    queries: PacketLookupQuery[];
    results: ProjectMemoryLookupResult[];
    quality_summary: ProjectMemoryLookupQualitySummary;
  };
  degraded: boolean;
  degraded_reasons: string[];
};

export type ProjectMemoryPacketOptions = {
  sessionMemoryLimit?: number;
  pendingLimit?: number;
  lookupLimit?: number;
};

export type PacketLookupQuery = {
  source_kind: "project_handoff" | "project_candidate" | "session_memory";
  source_id: string;
  query: string;
};

export type PacketHandoff = {
  id: string;
  status: string;
  priority: ProjectMemoryLeadPriority;
  producer_kind: string;
  objective: string;
  prompt_text: string;
  source_session_memory_ids: string[];
  source_event_refs: string[];
  suggested_actions: string[];
  confidence: string;
  risk: string;
  reason: string;
};

export type PacketCandidate = {
  id: string;
  status: string;
  priority: ProjectMemoryLeadPriority;
  producer_kind: string;
  candidate_type: string;
  title: string | null;
  summary: string;
  source_event_refs: string[];
  confidence: string;
  risk: string;
  reason: string;
};

export type PacketSessionMemory = {
  id: string;
  memory_kind: string;
  title: string | null;
  summary: string;
  source_event_refs: string[];
  confidence: string;
  risk: string;
  created_at: string;
  updated_at: string;
};

const DEFAULT_SESSION_MEMORY_LIMIT = 10;
const DEFAULT_PENDING_LIMIT = 20;
const DEFAULT_LOOKUP_LIMIT = 5;

export async function buildProjectMemoryPacket(
  root: string,
  projectKey: string,
  options: ProjectMemoryPacketOptions = {},
): Promise<ProjectMemoryPacket> {
  const project = await findProject(root, projectKey);
  const state = {
    bootstrap_state: await readJsonIfExists(projectPath(root, projectKey, "state", "bootstrap-state.json")),
    project_memory: await readJsonIfExists(projectPath(root, projectKey, "state", "project-memory.json")),
    freshness: await readJsonIfExists(projectPath(root, projectKey, "state", "freshness.json")),
    pages_manifest: await readJsonIfExists(projectPath(root, projectKey, "state", "pages.json")),
  };
  const corpus = await loadProjectMemoryCorpus(root, projectKey);
  const sectionManifest = await extractProjectMemorySections(root, projectKey);
  const pages = corpus.pages;
  const degradedReasons: string[] = [];
  if (pages.length === 0) degradedReasons.push(`projects/${projectKey}/wiki has no markdown pages`);

  const memoryInputs = await readMemoryInputs(root, projectKey, {
    sessionMemoryLimit: options.sessionMemoryLimit ?? DEFAULT_SESSION_MEMORY_LIMIT,
    pendingLimit: options.pendingLimit ?? DEFAULT_PENDING_LIMIT,
  });
  degradedReasons.push(...memoryInputs.degradedReasons);

  const queries = lookupQueries(memoryInputs);
  const results: ProjectMemoryLookupResult[] = [];
  const mode = packetMode(state.bootstrap_state, state.project_memory);
  for (const query of queries) {
    const result = await lookupProjectMemory(root, projectKey, query.query, {
      pages,
      searchTextByPath: corpus.search_text_by_path,
      limit: options.lookupLimit ?? DEFAULT_LOOKUP_LIMIT,
      source_kind: query.source_kind,
      source_id: query.source_id,
      mode,
      allow_fallback: true,
    });
    results.push(result);
  }
  const lookupQuality = summarizeLookupQuality(results);
  degradedReasons.push(...lookupQuality.blocking_reasons);

  return {
    schema_version: 1,
    project_key: projectKey,
    mode,
    project: {
      key: project.key,
      name: project.config.name ?? project.key,
      lifecycle: project.config.lifecycle ?? "active",
      repo_paths: project.config.repo_paths ?? [],
    },
    state,
    wiki: {
      page_count: pages.length,
      pages,
      sections: sectionManifest.sections,
    },
    pending: {
      project_handoffs: memoryInputs.projectHandoffs,
      project_candidates: memoryInputs.projectCandidates,
    },
    session_memory: {
      selected: memoryInputs.sessionMemories,
    },
    lookup: {
      queries,
      results,
      quality_summary: lookupQuality,
    },
    degraded: degradedReasons.length > 0,
    degraded_reasons: [...new Set(degradedReasons)].sort(),
  };
}

function summarizeLookupQuality(results: ProjectMemoryLookupResult[]): ProjectMemoryLookupQualitySummary {
  return {
    blocking: results.some((result) => result.apply_severity === "blocking"),
    blocking_reasons: uniqueReasons(results.filter((result) => result.apply_severity === "blocking")),
    advisory_reasons: uniqueReasons(results.filter((result) => result.apply_severity === "advisory")),
    proposal_scoped_result_ids: results
      .filter((result) => result.apply_severity === "proposal_scoped")
      .map((result) => result.id),
  };
}

function uniqueReasons(results: ProjectMemoryLookupResult[]): string[] {
  return [...new Set(results.map((result) => result.degraded_reason).filter((reason): reason is string => Boolean(reason)))].sort();
}

async function readMemoryInputs(
  root: string,
  projectKey: string,
  options: { sessionMemoryLimit: number; pendingLimit: number },
): Promise<{
  projectHandoffs: PacketHandoff[];
  projectCandidates: PacketCandidate[];
  sessionMemories: PacketSessionMemory[];
  degradedReasons: string[];
}> {
  if (!(await exists(memoryDbPath(root)))) {
    return {
      projectHandoffs: [],
      projectCandidates: [],
      sessionMemories: [],
      degradedReasons: ["state/memory.db is missing; Session Memory and pending handoff inputs are unavailable"],
    };
  }

  const db = openMemoryDb(root);
  try {
    const projectHandoffs = [
      ...listHandoffInstructions(db, { target_scope: "project", project_key: projectKey, status: "pending" }),
      ...listHandoffInstructions(db, { target_scope: "project", project_key: projectKey, status: "needs_review" }),
    ].slice(0, options.pendingLimit);
    const projectCandidates = [
      ...listMemoryCandidates(db, { project_key: projectKey, scope: "project", status: "pending" }),
      ...listMemoryCandidates(db, { project_key: projectKey, scope: "project", status: "needs_review" }),
    ].slice(0, options.pendingLimit);
    const sessionMemories = listSessionMemories(db, projectKey, options.sessionMemoryLimit);

    return {
      projectHandoffs: projectHandoffs.map(compactHandoff),
      projectCandidates: projectCandidates.map(compactCandidate),
      sessionMemories: sessionMemories.map(compactSessionMemory),
      degradedReasons: [],
    };
  } finally {
    db.close();
  }
}

function lookupQueries(input: {
  projectHandoffs: PacketHandoff[];
  projectCandidates: PacketCandidate[];
  sessionMemories: PacketSessionMemory[];
}): PacketLookupQuery[] {
  const queries: PacketLookupQuery[] = [];
  for (const handoff of input.projectHandoffs) {
    queries.push({
      source_kind: "project_handoff",
      source_id: handoff.id,
      query: [handoff.objective, handoff.reason].filter(Boolean).join(" "),
    });
  }
  for (const candidate of input.projectCandidates) {
    queries.push({
      source_kind: "project_candidate",
      source_id: candidate.id,
      query: [candidate.title ?? "", candidate.summary, candidate.reason].filter(Boolean).join(" "),
    });
  }
  for (const memory of input.sessionMemories) {
    queries.push({
      source_kind: "session_memory",
      source_id: memory.id,
      query: [memory.title ?? "", memory.summary].filter(Boolean).join(" "),
    });
  }
  return queries.filter((query) => query.query.trim().length > 0).slice(0, 25);
}

function compactHandoff(row: HandoffInstructionRow): PacketHandoff {
  const sourceEventRefs = jsonStringArray(row.source_event_refs_json);
  return {
    id: row.id,
    status: row.status,
    priority: priorityForProjectMemoryLead({ source_kind: "project_handoff", confidence: row.confidence, risk: row.risk }),
    producer_kind: producerKindForLead({ id: row.id, source_event_refs: sourceEventRefs }),
    objective: row.objective,
    prompt_text: row.prompt_text,
    source_session_memory_ids: jsonStringArray(row.source_session_memory_ids_json),
    source_event_refs: sourceEventRefs,
    suggested_actions: jsonStringArray(row.suggested_actions_json),
    confidence: row.confidence,
    risk: row.risk,
    reason: row.reason,
  };
}

function compactCandidate(row: MemoryCandidateRow): PacketCandidate {
  const sourceEventRefs = jsonStringArray(row.source_event_refs_json);
  return {
    id: row.id,
    status: row.status,
    priority: priorityForProjectMemoryLead({ source_kind: "project_candidate", confidence: row.confidence, risk: row.risk }),
    producer_kind: producerKindForLead({ id: row.id, source_event_refs: sourceEventRefs }),
    candidate_type: row.candidate_type,
    title: row.title,
    summary: row.summary,
    source_event_refs: sourceEventRefs,
    confidence: row.confidence,
    risk: row.risk,
    reason: row.reason,
  };
}

function compactSessionMemory(row: SessionMemoryRow): PacketSessionMemory {
  return {
    id: row.id,
    memory_kind: row.memory_kind,
    title: row.title,
    summary: row.summary,
    source_event_refs: jsonStringArray(row.source_event_refs_json),
    confidence: row.confidence,
    risk: row.risk,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

function packetMode(bootstrapState: unknown, projectMemory: unknown): ProjectMemoryPacket["mode"] {
  if (statusOf(projectMemory) === "curated" || statusOf(bootstrapState) === "curated") return "maintain";
  return "create";
}

function statusOf(value: unknown): string | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const status = (value as { status?: unknown }).status;
  return typeof status === "string" ? status : null;
}

function jsonStringArray(value: string): string[] {
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === "string") : [];
  } catch {
    return [];
  }
}

async function exists(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch (error) {
    if (isNotFound(error)) return false;
    throw error;
  }
}

function isNotFound(error: unknown): boolean {
  return Boolean(error && typeof error === "object" && "code" in error && error.code === "ENOENT");
}
