import { PROMPT_SIZE_LIMIT } from "../runtime/llm-client.ts";
import { stableJson } from "../runtime/json.ts";
import {
  buildProjectMemoryPacket,
  type ProjectMemoryPacket,
  type ProjectMemoryPacketOptions,
} from "./project-memory-packet.ts";
import type { ProjectMemoryCuratorMode } from "./project-memory-curator-contracts.ts";

export const PROJECT_MEMORY_PROMPT_SAFETY_MARGIN_CHARS = 5_000;
export const PROJECT_MEMORY_PROMPT_TARGET_CHARS = PROMPT_SIZE_LIMIT - PROJECT_MEMORY_PROMPT_SAFETY_MARGIN_CHARS;

export type ProjectMemoryPromptBudgetArtifact = {
  schema_version: 1;
  transport: ProjectMemoryPromptTransport;
  status: "ok" | "too_large";
  hard_limit_chars: number;
  safety_margin_chars: number;
  target_chars: number;
  selected_attempt_index: number;
  adjusted: boolean;
  attempts: ProjectMemoryPromptBudgetAttempt[];
};

export type ProjectMemoryPromptBudgetAttempt = {
  options: ProjectMemoryPromptBudgetArtifactOptions;
  prompt_chars: number;
  packet_chars: number;
  estimated_input_tokens: number;
  fits_target: boolean;
  fits_hard_limit: boolean;
  counts: {
    wiki_pages: number;
    pending_handoffs: number;
    pending_candidates: number;
    session_memories: number;
    lookup_queries: number;
    lookup_results: number;
    lookup_matches: number;
  };
  section_chars: {
    project: number;
    state: number;
    wiki: number;
    pending: number;
    session_memory: number;
    lookup: number;
    degraded_reasons: number;
  };
};

export type ProjectMemoryPromptBudgetResult =
  | {
      status: "ok";
      packet: ProjectMemoryPacket;
      prompt: string;
      artifact: ProjectMemoryPromptBudgetArtifact;
    }
  | {
      status: "too_large";
      packet: ProjectMemoryPacket;
      prompt: string;
      artifact: ProjectMemoryPromptBudgetArtifact;
      reason: string;
    };

export type ProjectMemoryPromptTransport = "artifact_reference" | "inline_packet";

type ProjectMemoryPromptBudgetArtifactOptions = {
  session_memory_limit?: number;
  pending_limit?: number;
  lookup_limit?: number;
};

const PROJECT_MEMORY_PROMPT_BUDGET_OPTIONS: ProjectMemoryPacketOptions[] = [
  {},
  { lookupLimit: 3 },
  { lookupLimit: 2 },
  { lookupLimit: 1 },
  { lookupLimit: 0 },
  { lookupLimit: 0, sessionMemoryLimit: 5 },
  { lookupLimit: 0, sessionMemoryLimit: 0 },
  { lookupLimit: 0, sessionMemoryLimit: 0, pendingLimit: 10 },
];

export async function buildPromptBudgetedProjectMemoryPacket(input: {
  root: string;
  projectKey: string;
  runDir: string;
  transport?: ProjectMemoryPromptTransport;
}): Promise<ProjectMemoryPromptBudgetResult> {
  const transport = input.transport ?? "inline_packet";
  if (transport === "artifact_reference") {
    const packet = await buildProjectMemoryPacket(input.root, input.projectKey);
    const prompt = buildProjectMemoryCuratorPrompt(packet.mode, input.runDir, packet, { transport });
    const attempt = measureProjectMemoryPromptAttempt(packet, prompt, {});
    const artifact = buildArtifact(attempt.fits_hard_limit ? "ok" : "too_large", [attempt], 0, transport);
    if (attempt.fits_hard_limit) return { status: "ok", packet, prompt, artifact };
    return {
      status: "too_large",
      packet,
      prompt,
      artifact,
      reason: `curator prompt too large after artifact-reference budgeting: ${prompt.length} chars exceeds ${PROMPT_SIZE_LIMIT}`,
    };
  }

  const attempts: ProjectMemoryPromptBudgetAttempt[] = [];
  let selectedPacket: ProjectMemoryPacket | null = null;
  let selectedPrompt = "";
  let selectedIndex = -1;
  let lastPacket: ProjectMemoryPacket | null = null;
  let lastPrompt = "";

  for (const [index, options] of PROJECT_MEMORY_PROMPT_BUDGET_OPTIONS.entries()) {
    const adjusted = index > 0;
    const packet = adjustedPacket(
      await buildProjectMemoryPacket(input.root, input.projectKey, options),
      adjusted ? budgetDegradedReason(options) : null,
    );
    const prompt = buildProjectMemoryCuratorPrompt(packet.mode, input.runDir, packet, { transport });
    lastPacket = packet;
    lastPrompt = prompt;
    const attempt = measureProjectMemoryPromptAttempt(packet, prompt, options);
    attempts.push(attempt);

    if (attempt.fits_target || attempt.fits_hard_limit) {
      selectedPacket = packet;
      selectedPrompt = prompt;
      selectedIndex = index;
      break;
    }
  }

  if (selectedPacket) {
    return {
      status: "ok",
      packet: selectedPacket,
      prompt: selectedPrompt,
      artifact: buildArtifact("ok", attempts, selectedIndex, transport),
    };
  }

  if (!lastPacket) throw new Error("Project Memory prompt budget option ladder is empty");
  selectedIndex = attempts.length - 1;

  return {
    status: "too_large",
    packet: lastPacket,
    prompt: lastPrompt,
    artifact: buildArtifact("too_large", attempts, selectedIndex, transport),
    reason: `curator prompt too large after budgeting: ${lastPrompt.length} chars exceeds ${PROMPT_SIZE_LIMIT}`,
  };
}

export function buildProjectMemoryCuratorPrompt(
  mode: ProjectMemoryCuratorMode,
  runDir: string,
  packet: ProjectMemoryPacket,
  options: { transport?: ProjectMemoryPromptTransport } = {},
): string {
  const outputName = mode === "create" ? "ProjectMemoryCreationDraft" : "ProjectMemoryMaintenanceProposal";
  const base = [
    "You are the Project Memory Curator.",
    `Run directory: ${runDir}`,
    `Input packet artifact: ${runDir}/input-packet.json`,
    `Return ONLY strict JSON matching ${outputName}.`,
    "Use packet references from the input packet. Do not invent packet refs.",
    "Do not write files. Do not mutate wiki markdown.",
    "Do not inspect repo source, docs, plans, or tests to discover the JSON contract; use the contract summary in this prompt.",
    "Do not run broad repository searches. Use the input packet as the evidence boundary unless a packet citation names a specific file that must be verified.",
    "When returning zero write proposals for a non-empty fallback-lookup packet, include explicit_noop_decisions with source_packet_refs and checked_existing_memory_refs.",
    "When a maintenance write depends on lookup evidence for dedupe, target selection, or supersession, include evidence_dependencies naming the lookup_result refs.",
    mode === "create"
      ? "Create mode: propose the first trusted Project Memory brain draft."
      : "Maintain mode: propose bounded itemized Project Memory updates only.",
    curatorContractSummary(mode),
  ];

  if ((options.transport ?? "inline_packet") === "artifact_reference") {
    return [
      ...base,
      `Read input-packet.json from the current run directory before answering. The repo-root path is ${runDir}/input-packet.json.`,
      "Treat the artifact as the authoritative input packet; this prompt intentionally does not inline it.",
    ].join("\n");
  }

  return [...base, "", "Input packet JSON:", stableJson(packet)].join("\n");
}

function curatorContractSummary(mode: ProjectMemoryCuratorMode): string {
  const common =
    "Common JSON: schema_version:1, project_key, mode, packet_ref{run_dir,artifact:'input-packet.json',packet_schema_version}, packet_context{degraded,degraded_reasons,budgets}, summary, optional explicit_noop_decisions[].";
  if (mode === "create") {
    return [
      "ProjectMemoryCreationDraft contract summary:",
      common,
      "Create fields: brain_intent{name,first_brain_summary,untrusted_existing_markdown_policy}, pages[], state_intent{mark_project_memory_curated,freshness_intent}, evidence_refs[], repo_citations[], risk{level,reasons,requires_quarantine}.",
      "Page draft: id,target{path,path_kind},title,purpose,content_intent,apply_payload,required_sections[],evidence_refs[],repo_citations[],notes_for_apply[].",
      "Creation apply_payload: {schema_version:1,pages:[{page_path,title,purpose,body:{paragraphs:[]},evidence_refs,repo_citations,inference?}]} and must include the target page.",
      "Creation publication requires index.md plus a domain page, unless notes_for_apply includes a no-domain-pages rationale.",
    ].join("\n");
  }
  return [
    "ProjectMemoryMaintenanceProposal contract summary:",
    common,
    "Maintain fields: items[], noop_inputs[], risk{level,reasons,requires_quarantine}.",
    "Item: id,operation,target_page{path,path_kind:'existing_wiki_page'},target_entry_id?,proposed_entry_id?,content_intent,apply_payload,source_packet_refs[],evidence_refs[],evidence_dependencies?,repo_citations[],inference?,applicability,lifecycle_intent,risk,preconditions[],expected_outcome.",
    "Maintenance apply_payload: {schema_version:1,entries:[{entry_id,title,body:{paragraphs:[]},lifecycle,evidence_refs,repo_citations,applicability}]} for write operations.",
  ].join("\n");
}

export function measureProjectMemoryPromptAttempt(
  packet: ProjectMemoryPacket,
  prompt: string,
  options: ProjectMemoryPacketOptions,
): ProjectMemoryPromptBudgetAttempt {
  const lookupResults = packet.lookup.results;
  return {
    options: artifactOptions(options),
    prompt_chars: prompt.length,
    packet_chars: stableJson(packet).length,
    estimated_input_tokens: Math.ceil(prompt.length / 4),
    fits_target: prompt.length <= PROJECT_MEMORY_PROMPT_TARGET_CHARS,
    fits_hard_limit: prompt.length <= PROMPT_SIZE_LIMIT,
    counts: {
      wiki_pages: packet.wiki.pages.length,
      pending_handoffs: packet.pending.project_handoffs.length,
      pending_candidates: packet.pending.project_candidates.length,
      session_memories: packet.session_memory.selected.length,
      lookup_queries: packet.lookup.queries.length,
      lookup_results: lookupResults.length,
      lookup_matches: lookupResults.reduce((sum, result) => sum + result.hits.length, 0),
    },
    section_chars: {
      project: stableJson(packet.project).length,
      state: stableJson(packet.state).length,
      wiki: stableJson(packet.wiki).length,
      pending: stableJson(packet.pending).length,
      session_memory: stableJson(packet.session_memory).length,
      lookup: stableJson(packet.lookup).length,
      degraded_reasons: stableJson(packet.degraded_reasons).length,
    },
  };
}

function adjustedPacket(packet: ProjectMemoryPacket, degradedReason: string | null): ProjectMemoryPacket {
  if (!degradedReason) return packet;
  return {
    ...packet,
    degraded: true,
    degraded_reasons: [...new Set([...packet.degraded_reasons, degradedReason])].sort(),
  };
}

function budgetDegradedReason(options: ProjectMemoryPacketOptions): string {
  const parts = Object.entries(artifactOptions(options))
    .map(([key, value]) => `${key}=${value}`)
    .join(", ");
  return `Project Memory packet context was reduced by prompt budget preflight (${parts}).`;
}

function artifactOptions(options: ProjectMemoryPacketOptions): ProjectMemoryPromptBudgetArtifactOptions {
  const artifactOptions: ProjectMemoryPromptBudgetArtifactOptions = {};
  if (options.sessionMemoryLimit !== undefined) artifactOptions.session_memory_limit = options.sessionMemoryLimit;
  if (options.pendingLimit !== undefined) artifactOptions.pending_limit = options.pendingLimit;
  if (options.lookupLimit !== undefined) artifactOptions.lookup_limit = options.lookupLimit;
  return artifactOptions;
}

function buildArtifact(
  status: ProjectMemoryPromptBudgetArtifact["status"],
  attempts: ProjectMemoryPromptBudgetAttempt[],
  selectedIndex: number,
  transport: ProjectMemoryPromptTransport,
): ProjectMemoryPromptBudgetArtifact {
  return {
    schema_version: 1,
    transport,
    status,
    hard_limit_chars: PROMPT_SIZE_LIMIT,
    safety_margin_chars: PROJECT_MEMORY_PROMPT_SAFETY_MARGIN_CHARS,
    target_chars: PROJECT_MEMORY_PROMPT_TARGET_CHARS,
    selected_attempt_index: selectedIndex,
    adjusted: selectedIndex > 0,
    attempts,
  };
}
