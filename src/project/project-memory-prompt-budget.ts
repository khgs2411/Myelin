import { PROMPT_SIZE_LIMIT } from "../runtime/llm-client.ts";
import { stableJson } from "../runtime/json.ts";
import {
  buildProjectMemoryPacket,
  type ProjectMemoryPacket,
  type ProjectMemoryPacketOptions,
} from "./project-memory-packet.ts";
import type { ProjectMemoryCuratorMode } from "./project-memory-curator-contracts.ts";
import {
  PROJECT_MEMORY_ANSWER_DOMAINS,
  PROJECT_MEMORY_CREATION_MIN_PAGES,
  PROJECT_MEMORY_CURATOR_OUTPUT_CONTRACT_ARTIFACT,
} from "./project-memory-curator-contracts.ts";
import { PROJECT_MEMORY_DEFAULT_ORIENTATION_SURFACES } from "./project-memory-orientation-contract.ts";

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
  absoluteRunDir?: string;
  repoPath?: string;
  packet?: ProjectMemoryPacket;
  evidenceMapArtifact?: "project-memory-evidence-map.json";
  transport?: ProjectMemoryPromptTransport;
}): Promise<ProjectMemoryPromptBudgetResult> {
  const transport = input.transport ?? "inline_packet";
  if (transport === "artifact_reference") {
    const packet = input.packet ?? (await buildProjectMemoryPacket(input.root, input.projectKey));
    const prompt = buildProjectMemoryCuratorPrompt(packet.mode, input.runDir, packet, {
      transport,
      absoluteRunDir: input.absoluteRunDir,
      repoPath: input.repoPath,
      evidenceMapArtifact: input.evidenceMapArtifact,
    });
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
  options: {
    transport?: ProjectMemoryPromptTransport;
    absoluteRunDir?: string;
    repoPath?: string;
    evidenceMapArtifact?: "project-memory-evidence-map.json";
  } = {},
): string {
  const outputName = mode === "create" ? "ProjectMemoryCreationDraft" : "ProjectMemoryMaintenanceProposal";
  const artifactRunDir = options.absoluteRunDir ?? runDir;
  const repoContext = options.repoPath ? ` (${options.repoPath})` : "";
  const base = [
    "You are the Project Memory Curator.",
    `Run directory: ${runDir}`,
    `Input packet artifact: ${artifactRunDir}/input-packet.json`,
    `Curator output contract artifact: ${artifactRunDir}/${PROJECT_MEMORY_CURATOR_OUTPUT_CONTRACT_ARTIFACT}`,
    `Return ONLY strict JSON matching ${outputName}.`,
    `Your output must match ${PROJECT_MEMORY_CURATOR_OUTPUT_CONTRACT_ARTIFACT}; deterministic validation will reject unsupported packet refs, unsafe paths, or insufficient provenance.`,
    "Use packet references from the input packet. Do not invent packet refs.",
    "Do not write files. Do not mutate wiki markdown.",
    "Do not inspect repo source, docs, plans, or tests to discover the JSON contract; use the contract artifact.",
    "Do not run broad repository searches. Use the input packet plus bounded target-repo orientation files as the evidence boundary.",
    "Evidence refs must use IDs that appear in the input packet exactly; project_state refs are only `bootstrap_state`, `project_memory`, `freshness`, or `pages_manifest`.",
    "For lookup_result evidence, prefer short aliases `lookup:0`, `lookup:1`, etc. using the zero-based input_packet.lookup.results order instead of copying long lookup IDs.",
    "Validator-only rules: wiki target paths are relative to the project wiki root; use `index.md`, not `wiki/index.md`, and never use paths starting with `/`, `../`, or `wiki/`.",
    "Validator-only rules: each target path must exactly match its apply payload page_path or target page; every apply payload page or entry with empty repo_citations must include a non-null inference object.",
    "Only put auto-applyable no-ops in explicit_noop_decisions; unresolved or insufficient-evidence inputs belong in noop_inputs, not explicit_noop_decisions.",
    "When returning zero write proposals for a non-empty fallback-lookup packet, include explicit_noop_decisions with source_packet_refs and checked_existing_memory_refs only for auto-applyable reasons.",
    "When a maintenance write depends on lookup evidence for dedupe, target selection, or supersession, include evidence_dependencies naming the lookup_result refs.",
    ...(mode === "create"
      ? [
          "Create mode: Project Memory is living repo documentation, not a page-count exercise.",
          `Create mode: inspect the default orientation surfaces when present: ${PROJECT_MEMORY_DEFAULT_ORIENTATION_SURFACES.join(", ")}.`,
          "Create mode: you may inspect extra target-repo files only when justified in documentation_contract.curator_added_surfaces.",
          "Create mode: candidates, handoffs, and Session Memory are leads only; cite repo docs/code for durable claims.",
          `Create mode: cover all required answer domains: ${PROJECT_MEMORY_ANSWER_DOMAINS.join(", ")}.`,
          "Create mode: each page draft must name answer_domains, required_topics, representative_questions, inspected_surface_refs, direct repo_citations, and one matching sectioned apply_payload page.",
          "Create mode: do not use the old documentation role taxonomy as create-mode authority.",
          ...(options.evidenceMapArtifact
            ? [
                `Create mode is two-pass: use input-packet.json for bounded context and ${options.evidenceMapArtifact} as the required evidence map.`,
                `Create mode: documentation_contract.inspected_default_surfaces must include every present default orientation surface you actually inspected, including present defaults surfaced by ${options.evidenceMapArtifact}.`,
                "Create mode: every page answer_domain, required_topic, representative_question, and section must be supported by evidence_refs or repo_citations from the evidence map.",
                `Create mode: if an answer domain has missing_evidence in ${options.evidenceMapArtifact}, report it in quality_diagnostics.missing_coverage or shallow_summary_findings; do not fill the gap with generic prose.`,
                "Create mode: candidates, handoffs, and Session Memory are leads only. Convert them into Project Memory only when the evidence map points to repo-grounded support.",
              ]
            : []),
          "Create mode: every page draft and apply payload page must include direct repo_citations; packet/session/candidate evidence alone is not enough to mark Project Memory curated.",
          "Create mode: each page draft's apply_payload.pages must contain exactly one page, and that page_path must equal target.path; create separate page drafts for separate wiki pages.",
          `Create mode: produce a full Project Memory documentation set: index.md plus at least ${PROJECT_MEMORY_CREATION_MIN_PAGES - 1} non-index pages, all repo-grounded.`,
        ]
      : [
          "Maintain mode: propose bounded itemized Project Memory updates only.",
          "Maintain mode: do not propose auto-apply writes when target selection, dedupe, or supersession depends on fallback lookup; use noop_inputs or an auto-applyable explicit_noop_decision instead.",
        ]),
  ];

  if ((options.transport ?? "inline_packet") === "artifact_reference") {
    return [
      ...base,
      `Read input-packet.json before answering. Absolute path: ${artifactRunDir}/input-packet.json.`,
      `Read ${PROJECT_MEMORY_CURATOR_OUTPUT_CONTRACT_ARTIFACT} before answering. Absolute path: ${artifactRunDir}/${PROJECT_MEMORY_CURATOR_OUTPUT_CONTRACT_ARTIFACT}.`,
      `You are running from the target repository cwd${repoContext}; use repo files for repo-bounded curation and artifact paths above for packet/contract.`,
      "Treat the artifact as the authoritative input packet; this prompt intentionally does not inline it.",
    ].join("\n");
  }

  return [...base, "", "Input packet JSON:", stableJson(packet)].join("\n");
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
