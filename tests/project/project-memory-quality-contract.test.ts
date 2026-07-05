import { describe, expect, test } from "bun:test";
import {
  evaluateProjectMemoryQuality,
  PROJECT_MEMORY_ANSWER_DOMAINS,
  type ProjectMemoryAnswerDomain,
  type ProjectMemoryAnswerDomainCoverage,
} from "../../src/project/project-memory-quality-contract.ts";

describe("Project Memory quality contract", () => {
  test("requires the default answer domains before trusted create quality", () => {
    const result = evaluateProjectMemoryQuality({
      mode: "create",
      domain_coverage: PROJECT_MEMORY_ANSWER_DOMAINS
        .filter((domain) => domain !== "current_work_roadmap_decisions")
        .map(domainCoverage),
      candidate_dispositions: [],
      shallow_summary_findings: [],
      answerability_findings: [],
      missing_coverage: [],
      blocked_reasons: [],
      review_reasons: [],
    });

    expect(result.content_quality.status).toBe("shallow");
    expect(result.content_quality.reasons).toContain("missing required answer domain: current_work_roadmap_decisions");
  });

  test("trusts create quality when every answer domain is grounded and deep enough", () => {
    const result = evaluateProjectMemoryQuality({
      mode: "create",
      domain_coverage: PROJECT_MEMORY_ANSWER_DOMAINS.map(domainCoverage),
      candidate_dispositions: [],
      shallow_summary_findings: [],
      answerability_findings: [],
      missing_coverage: [],
      blocked_reasons: [],
      review_reasons: [],
    });

    expect(result.content_quality.status).toBe("trusted");
  });

  test("uses blocked when required evidence prevents deterministic evaluation", () => {
    const result = evaluateProjectMemoryQuality({
      mode: "create",
      domain_coverage: [],
      candidate_dispositions: [],
      shallow_summary_findings: [],
      answerability_findings: [],
      missing_coverage: [],
      blocked_reasons: ["quality diagnostics missing"],
      review_reasons: [],
    });

    expect(result.content_quality.status).toBe("blocked");
  });

  test("uses review_only for structurally useful output that requires human review", () => {
    const result = evaluateProjectMemoryQuality({
      mode: "maintain",
      domain_coverage: [],
      candidate_dispositions: [],
      shallow_summary_findings: [],
      answerability_findings: [],
      missing_coverage: [],
      blocked_reasons: [],
      review_reasons: ["lookup dependency used fallback result"],
    });

    expect(result.content_quality.status).toBe("review_only");
  });
});

function domainCoverage(domain: ProjectMemoryAnswerDomain): ProjectMemoryAnswerDomainCoverage {
  return {
    domain,
    page_refs: [`${domain}.md`],
    section_refs: [`${domain}/overview`],
    representative_questions: [`How does ${domain} work?`],
    citations_seen: 2,
    body_chars_seen: 500,
    missing_topics: [],
  };
}
