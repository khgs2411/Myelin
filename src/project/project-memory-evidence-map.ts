import { execFile } from "node:child_process";
import { readFile, stat } from "node:fs/promises";
import { join } from "node:path";
import { promisify } from "node:util";
import {
  PROJECT_MEMORY_ANSWER_DOMAINS,
  type ProjectMemoryAnswerDomain,
} from "./project-memory-quality-contract.ts";
import { PROJECT_MEMORY_DEFAULT_ORIENTATION_SURFACES } from "./project-memory-orientation-contract.ts";
import type { ProjectMemoryPacket } from "./project-memory-packet.ts";

export const PROJECT_MEMORY_EVIDENCE_MAP_ARTIFACT = "project-memory-evidence-map.json" as const;

const execFileAsync = promisify(execFile);
const MAX_SEARCH_RESULTS_PER_DOMAIN = 12;
const MAX_READ_CHARS_PER_FILE = 20_000;

export type ProjectMemoryEvidenceMap = {
  schema_version: 1;
  project_key: string;
  packet_ref: "input-packet.json";
  domains: ProjectMemoryEvidenceMapDomain[];
  leads_considered: ProjectMemoryEvidenceLead[];
  discovery_steps: ProjectMemoryEvidenceDiscoveryStep[];
  missing_domains: ProjectMemoryAnswerDomain[];
};

export type ProjectMemoryEvidenceMapDomain = {
  domain: ProjectMemoryAnswerDomain;
  representative_questions: string[];
  inspected_paths: string[];
  search_terms: string[];
  search_results: ProjectMemoryEvidenceSearchResult[];
  evidence_refs: ProjectMemoryEvidenceMapRef[];
  missing_evidence: string[];
};

export type ProjectMemoryEvidenceDiscoveryStep = {
  kind: "default_path_read" | "bounded_repo_search" | "packet_lead_scan";
  domain?: ProjectMemoryAnswerDomain;
  detail: string;
};

export type ProjectMemoryEvidenceSearchResult = {
  path: string;
  line: number | null;
  term: string;
  excerpt: string;
};

export type ProjectMemoryEvidenceMapRef = {
  kind: "repo_path" | "doc" | "test" | "adr" | "state" | "candidate" | "session_memory" | "handoff";
  ref: string;
  reason: string;
};

export type ProjectMemoryEvidenceLead = {
  kind: "project_candidate" | "project_handoff" | "session_memory";
  ref: string;
  summary: string;
  mapped_domains: ProjectMemoryAnswerDomain[];
};

type DomainDiscoveryProfile = {
  questions: string[];
  pathHints: string[];
  terms: string[];
};

const DOMAIN_QUERIES: Record<ProjectMemoryAnswerDomain, DomainDiscoveryProfile> = {
  product_memory_model: {
    questions: ["What is Myelin Project Memory?", "How do Session Memory and Project Memory differ?"],
    pathHints: [
      ...PROJECT_MEMORY_DEFAULT_ORIENTATION_SURFACES,
      "MY_VISION.md",
      "myvision.md",
    ],
    terms: ["Project Memory", "Session Memory", "living repo documentation", "durable memory", "memory layer"],
  },
  storage_retrieval: {
    questions: ["Where is SQLite state stored?", "How do retrieval rows point back to markdown?"],
    pathHints: [
      "src/memory/db.ts",
      "src/memory/migrations.ts",
      "src/memory/project-memory-retrieval-indexer.ts",
      "src/memory/project-memory-retrieval-index-service.ts",
      "src/query/project-memory-query-service.ts",
    ],
    terms: ["state/memory.db", "session_memories", "project memory retrieval", "sqlite", "embedding"],
  },
  command_workflows: {
    questions: ["Which CLI commands operate Project Memory?", "How does an operator invoke project learn and memory query?"],
    pathHints: ["src/commands/project.ts", "src/commands/memory.ts", "src/cli.ts", "Makefile", "AGENTS.md"],
    terms: ["project learn", "memory query", "memory index session", "memory inbox intake", "top-level ingest", "schema check"],
  },
  curation_apply_lifecycle: {
    questions: ["How does project learn create, validate, apply, and index Project Memory?"],
    pathHints: [
      "src/project/project-memory-curator-service.ts",
      "src/project/project-memory-curator-validator.ts",
      "src/project/project-memory-markdown-applier.ts",
      "src/project/project-memory-apply-contracts.ts",
    ],
    terms: ["validateCuratorOutput", "applyCreationDraft", "curator-validation.json", "project-memory-changeset.json"],
  },
  evidence_provenance_candidates: {
    questions: ["How are candidates and handoffs treated as leads?", "Where is source evidence preserved?"],
    pathHints: [
      "src/project/project-memory-candidate-intake-service.ts",
      "src/project/project-memory-source-consumption-reconciler.ts",
      "src/project/project-memory-producer-boundary.ts",
      "src/memory/candidates.ts",
      "src/memory/handoffs.ts",
    ],
    terms: ["project_candidate", "project_handoff", "lead", "source_event_refs", "producer_kind"],
  },
  current_work_roadmap_decisions: {
    questions: ["Where are roadmap and durable decisions captured?", "Which decisions govern the current project-memory work?"],
    pathHints: [
      "docs/ROADMAP.md",
      "docs/adr/0063-use-answer-domain-project-memory-documentation-map.md",
      "docs/adr/0064-use-two-pass-project-memory-evidence-workflow.md",
      "docs/adr/0065-require-independent-first-create-usefulness-critique.md",
      "docs/adr/0066-allow-clean-project-shell-rebootstrap-reset.md",
      "docs/design/2026-07-05-project-memory-rendered-create-contract/spec.md",
      "docs/design/2026-07-05-project-memory-rendered-create-contract/agenda.md",
    ],
    terms: ["Step 5", "Step 6", "ADR", "Ready for Development", "roadmap"],
  },
};

export async function buildProjectMemoryEvidenceMap(input: {
  root: string;
  projectKey: string;
  packet: ProjectMemoryPacket;
  repoPath: string;
}): Promise<ProjectMemoryEvidenceMap> {
  const domains: ProjectMemoryEvidenceMapDomain[] = [];
  const discoverySteps: ProjectMemoryEvidenceDiscoveryStep[] = [];
  for (const domain of PROJECT_MEMORY_ANSWER_DOMAINS) {
    domains.push(await buildDomainEvidence(input.repoPath, domain, DOMAIN_QUERIES[domain], discoverySteps));
  }

  return {
    schema_version: 1,
    project_key: input.projectKey,
    packet_ref: "input-packet.json",
    domains,
    leads_considered: leadsFromPacket(input.packet),
    discovery_steps: [
      ...discoverySteps,
      { kind: "packet_lead_scan", detail: "mapped packet candidate, handoff, and session-memory leads to answer domains by domain terms" },
    ],
    missing_domains: domains.filter((domain) => domain.evidence_refs.length === 0).map((domain) => domain.domain),
  };
}

async function buildDomainEvidence(
  repoPath: string,
  domain: ProjectMemoryAnswerDomain,
  profile: DomainDiscoveryProfile,
  discoverySteps: ProjectMemoryEvidenceDiscoveryStep[],
): Promise<ProjectMemoryEvidenceMapDomain> {
  const inspectedPaths: string[] = [];
  const evidenceRefs: ProjectMemoryEvidenceMapRef[] = [];

  for (const pathHint of profile.pathHints) {
    const text = await readTextFileIfPresent(join(repoPath, pathHint));
    if (text === null) continue;
    inspectedPaths.push(pathHint);
    discoverySteps.push({ kind: "default_path_read", domain, detail: pathHint });
    evidenceRefs.push({
      kind: evidenceKindForPath(pathHint),
      ref: pathHint,
      reason: matchesAnyTerm(text.slice(0, MAX_READ_CHARS_PER_FILE), profile.terms)
        ? `matched answer-domain terms for ${domain}`
        : `default orientation surface for ${domain}`,
    });
  }

  const search = await boundedRepoSearch({ repoPath, domain, terms: profile.terms });
  discoverySteps.push(...search.steps);
  for (const result of search.results) {
    if (!inspectedPaths.includes(result.path)) inspectedPaths.push(result.path);
    evidenceRefs.push({
      kind: evidenceKindForPath(result.path),
      ref: result.line ? `${result.path}:${result.line}` : result.path,
      reason: `bounded repo search matched "${result.term}" for ${domain}`,
    });
  }

  return {
    domain,
    representative_questions: profile.questions,
    inspected_paths: inspectedPaths,
    search_terms: profile.terms,
    search_results: search.results,
    evidence_refs: evidenceRefs,
    missing_evidence: evidenceRefs.length === 0 ? [`no concrete repo evidence found for ${domain}`] : [],
  };
}

async function boundedRepoSearch(input: {
  repoPath: string;
  domain: ProjectMemoryAnswerDomain;
  terms: string[];
}): Promise<{ results: ProjectMemoryEvidenceSearchResult[]; steps: ProjectMemoryEvidenceDiscoveryStep[] }> {
  const results: ProjectMemoryEvidenceSearchResult[] = [];
  const steps: ProjectMemoryEvidenceDiscoveryStep[] = [];
  const repoStats = await stat(input.repoPath).catch(() => null);
  if (!repoStats?.isDirectory()) {
    return {
      results,
      steps: [{ kind: "bounded_repo_search", domain: input.domain, detail: `repo path missing: ${input.repoPath}` }],
    };
  }

  for (const term of input.terms) {
    if (results.length >= MAX_SEARCH_RESULTS_PER_DOMAIN) break;
    steps.push({ kind: "bounded_repo_search", domain: input.domain, detail: `rg search for ${term}` });
    const output = await execFileAsync("rg", [
      "--line-number",
      "--fixed-strings",
      "--ignore-case",
      "--max-count",
      "3",
      "--glob",
      "!node_modules/**",
      "--glob",
      "!.git/**",
      "--glob",
      "!projects/*/runs/**",
      "--glob",
      "!projects/*/logs/**",
      "--glob",
      "!state/**",
      term,
      input.repoPath,
    ], { maxBuffer: 128_000 }).catch((error: unknown) => {
      const maybe = error as { code?: number | string; stdout?: string };
      if (maybe.code === 1) return { stdout: "" };
      if (maybe.code === "ENOENT") {
        throw new Error("Project Memory evidence-map discovery requires rg on PATH.");
      }
      throw error;
    });

    const stdout = typeof output.stdout === "string" ? output.stdout : "";
    for (const line of stdout.split("\n")) {
      if (!line.trim() || results.length >= MAX_SEARCH_RESULTS_PER_DOMAIN) continue;
      const match = line.match(/^(.*?):(\d+):(.*)$/);
      if (!match) continue;
      const [, absolutePath, lineNumber, excerpt] = match;
      const relativePath = absolutePath.startsWith(`${input.repoPath}/`)
        ? absolutePath.slice(input.repoPath.length + 1)
        : absolutePath;
      results.push({
        path: relativePath,
        line: Number(lineNumber),
        term,
        excerpt: excerpt.slice(0, 240),
      });
    }
  }

  return { results, steps };
}

function leadsFromPacket(packet: ProjectMemoryPacket): ProjectMemoryEvidenceLead[] {
  return [
    ...packet.pending.project_candidates.map((candidate) => ({
      kind: "project_candidate" as const,
      ref: candidate.id,
      summary: compactLeadSummary([candidate.title, candidate.summary, candidate.reason]),
      mapped_domains: mappedDomainsForText([candidate.title, candidate.summary, candidate.reason].filter(Boolean).join("\n")),
    })),
    ...packet.pending.project_handoffs.map((handoff) => ({
      kind: "project_handoff" as const,
      ref: handoff.id,
      summary: compactLeadSummary([handoff.objective, handoff.prompt_text, handoff.reason]),
      mapped_domains: mappedDomainsForText([handoff.objective, handoff.prompt_text, handoff.reason].join("\n")),
    })),
    ...packet.session_memory.selected.map((memory) => ({
      kind: "session_memory" as const,
      ref: memory.id,
      summary: compactLeadSummary([memory.title, memory.summary]),
      mapped_domains: mappedDomainsForText([memory.title, memory.summary].filter(Boolean).join("\n")),
    })),
  ];
}

function mappedDomainsForText(text: string): ProjectMemoryAnswerDomain[] {
  return PROJECT_MEMORY_ANSWER_DOMAINS.filter((domain) => matchesAnyTerm(text, DOMAIN_QUERIES[domain].terms));
}

function compactLeadSummary(parts: Array<string | null | undefined>): string {
  const text = parts.filter((part): part is string => Boolean(part?.trim())).join(" - ").replace(/\s+/g, " ").trim();
  return text.length > 280 ? `${text.slice(0, 277)}...` : text;
}

function evidenceKindForPath(path: string): ProjectMemoryEvidenceMapRef["kind"] {
  if (path.includes("/test") || path.startsWith("tests/") || path.includes(".test.")) return "test";
  if (path.startsWith("docs/adr/")) return "adr";
  if (path.startsWith("docs/") || path.endsWith(".md")) return "doc";
  if (path.startsWith("projects/") && path.includes("/state/")) return "state";
  return "repo_path";
}

async function readTextFileIfPresent(path: string): Promise<string | null> {
  try {
    const stats = await stat(path);
    if (!stats.isFile()) return null;
    return await readFile(path, "utf8");
  } catch (error) {
    if (error && typeof error === "object" && "code" in error && error.code === "ENOENT") return null;
    throw error;
  }
}

function matchesAnyTerm(text: string, terms: string[]): boolean {
  const lowerText = text.toLowerCase();
  return terms.some((term) => lowerText.includes(term.toLowerCase()));
}
