import type { ProjectMemoryCuratorMode } from "./project-memory-curator-contracts.ts";
import { PROJECT_MEMORY_AGENT_CANDIDATE_DISPOSITIONS } from "./project-memory-agent-contracts.ts";
import type { ProjectMemoryAgentCandidateDisposition } from "./project-memory-agent-contracts.ts";

export const PROJECT_MEMORY_DOCUMENTATION_ROLES = [
  "orientation_index",
  "product_memory_model",
  "runtime_workflows",
  "architecture_data_flow",
  "current_work_roadmap",
  "decisions_terms",
] as const;

export const PROJECT_MEMORY_ANSWER_DOMAINS = [
  "product_memory_model",
  "storage_retrieval",
  "command_workflows",
  "curation_apply_lifecycle",
  "evidence_provenance_candidates",
  "current_work_roadmap_decisions",
] as const;

export const PROJECT_MEMORY_CONTENT_QUALITY_STATUSES = ["trusted", "review_only", "shallow", "blocked"] as const;
export const PROJECT_MEMORY_RETRIEVAL_READINESS_STATUSES = ["ready", "pending", "degraded", "not_applicable"] as const;
export const PROJECT_MEMORY_CANDIDATE_DISPOSITIONS = PROJECT_MEMORY_AGENT_CANDIDATE_DISPOSITIONS;

export type ProjectMemoryDocumentationRole = (typeof PROJECT_MEMORY_DOCUMENTATION_ROLES)[number];
export type ProjectMemoryAnswerDomain = (typeof PROJECT_MEMORY_ANSWER_DOMAINS)[number];
export type ProjectMemoryContentQualityStatus = (typeof PROJECT_MEMORY_CONTENT_QUALITY_STATUSES)[number];
export type ProjectMemoryRetrievalReadinessStatus = (typeof PROJECT_MEMORY_RETRIEVAL_READINESS_STATUSES)[number];
export type ProjectMemoryCandidateDisposition = ProjectMemoryAgentCandidateDisposition;

export type ProjectMemoryRoleCoverage = {
  role: ProjectMemoryDocumentationRole;
  page_ref: string;
  sections_seen: number;
  citations_seen: number;
  body_chars_seen: number;
};

export type ProjectMemoryAnswerDomainCoverage = {
  domain: ProjectMemoryAnswerDomain;
  page_refs: string[];
  section_refs: string[];
  representative_questions: string[];
  citations_seen: number;
  body_chars_seen: number;
  missing_topics: string[];
};

export type ProjectMemoryQualityDiagnostics = {
  schema_version: 1;
  content_quality: { status: ProjectMemoryContentQualityStatus; reasons: string[] };
  retrieval_readiness: { status: ProjectMemoryRetrievalReadinessStatus; reason?: string | null };
  domain_coverage: ProjectMemoryAnswerDomainCoverage[];
  role_coverage?: ProjectMemoryRoleCoverage[];
  candidate_dispositions: { source_ref: string; disposition: ProjectMemoryCandidateDisposition; reason: string }[];
  missing_coverage: string[];
  shallow_summary_findings: string[];
  answerability_findings: string[];
};

export function evaluateProjectMemoryQuality(input: {
  mode: ProjectMemoryCuratorMode;
  domain_coverage: ProjectMemoryAnswerDomainCoverage[];
  role_coverage?: ProjectMemoryRoleCoverage[];
  candidate_dispositions: ProjectMemoryQualityDiagnostics["candidate_dispositions"];
  missing_coverage: string[];
  shallow_summary_findings: string[];
  answerability_findings: string[];
  blocked_reasons: string[];
  review_reasons: string[];
}): ProjectMemoryQualityDiagnostics {
  if (input.blocked_reasons.length > 0) {
    return diagnosticsFor(input, "blocked", input.blocked_reasons);
  }

  const reasons: string[] = [];
  if (input.mode === "create") {
    for (const domain of PROJECT_MEMORY_ANSWER_DOMAINS) {
      const coverage = input.domain_coverage.find((item) => item.domain === domain);
      if (!coverage) reasons.push(`missing required answer domain: ${domain}`);
      else {
        if (coverage.section_refs.length < 1) reasons.push(`answer domain has no rendered sections: ${domain}`);
        if (coverage.citations_seen < 1) reasons.push(`answer domain has insufficient repo citation coverage: ${domain}`);
        if (coverage.body_chars_seen < 300) reasons.push(`answer domain has shallow body coverage: ${domain}`);
        for (const topic of coverage.missing_topics) {
          reasons.push(`answer domain missing topic ${domain}: ${topic}`);
        }
      }
    }
  }

  reasons.push(...input.missing_coverage, ...input.shallow_summary_findings, ...input.answerability_findings);
  if (reasons.length > 0) return diagnosticsFor(input, "shallow", reasons);
  if (input.review_reasons.length > 0) return diagnosticsFor(input, "review_only", input.review_reasons);
  return diagnosticsFor(input, "trusted", []);
}

function diagnosticsFor(
  input: {
    domain_coverage: ProjectMemoryAnswerDomainCoverage[];
    role_coverage?: ProjectMemoryRoleCoverage[];
    candidate_dispositions: ProjectMemoryQualityDiagnostics["candidate_dispositions"];
    missing_coverage: string[];
    shallow_summary_findings: string[];
    answerability_findings: string[];
  },
  status: ProjectMemoryContentQualityStatus,
  reasons: string[],
): ProjectMemoryQualityDiagnostics {
  return {
    schema_version: 1,
    content_quality: { status, reasons },
    retrieval_readiness: { status: "not_applicable" },
    domain_coverage: input.domain_coverage,
    role_coverage: input.role_coverage,
    candidate_dispositions: input.candidate_dispositions,
    missing_coverage: input.missing_coverage,
    shallow_summary_findings: input.shallow_summary_findings,
    answerability_findings: input.answerability_findings,
  };
}

export function isTrustedProjectMemoryQuality(diagnostics?: ProjectMemoryQualityDiagnostics): boolean {
  return diagnostics?.content_quality.status === "trusted";
}
