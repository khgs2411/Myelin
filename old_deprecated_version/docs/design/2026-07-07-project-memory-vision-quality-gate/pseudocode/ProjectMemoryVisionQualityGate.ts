// Pseudocode artifact. Non-executable reference shape for planning.

// Intended destination: src/project/project-memory-vision-quality-gate.ts
// Owns the first-create vision-quality trust decision after deterministic validation and usefulness critique.
// Does not own rendering, provider invocation, markdown apply, retrieval indexing, or candidate intake.

import type { ProjectMemoryTrustStatus } from "../../../src/project/project-memory-curator-contracts.ts";
import type { ProjectMemoryQualityDiagnostics } from "../../../src/project/project-memory-quality-contract.ts";

export type ProjectMemoryVisionQualityQuestion = {
  id: string;
  question: string;
  expected_terms: string[];
  required_evidence: ("myelin_vision" | "roadmap" | "rendered_markdown" | "evidence_map" | "live_dogfood")[];
  weight: "high" | "medium" | "low";
};

export type ProjectMemoryVisionQualityGateInput = {
  projectKey: string;
  trustStatus: ProjectMemoryTrustStatus;
  qualityDiagnostics: ProjectMemoryQualityDiagnostics;
  evidenceMapRef: "project-memory-evidence-map.json";
  usefulnessCritiqueRef: "project-memory-usefulness-critique.json";
  renderedPages: {
    page_path: string;
    section_refs: string[];
    markdown: string;
  }[];
  questions: ProjectMemoryVisionQualityQuestion[];
  liveDogfood?: {
    run_ref: string;
    outcome: "passed" | "failed" | "not_run";
    reason?: string;
  };
  now?: Date;
};

export type ProjectMemoryVisionQualityGateResult = {
  status: "pass" | "review_only" | "fail" | "blocked";
  reasons: string[];
  weak_questions: {
    question_id: string;
    reason: string;
    missing_terms: string[];
  }[];
  citation_notes: string[];
  terminal_state: "curated" | "review_only" | "shallow" | "blocked" | "uncurated";
};

export function evaluateProjectMemoryVisionQualityGate(
  input: ProjectMemoryVisionQualityGateInput,
): ProjectMemoryVisionQualityGateResult {
  // 1. Require deterministic validation and usefulness critique artifacts first.
  // 2. Treat live dogfood as the strongest available signal.
  // 3. Ask each representative question against the rendered markdown, not against curator intent.
  // 4. Record weak questions when the docs are technically present but still too generic to trust.
  // 5. Return review_only when foundation-valid docs look promising but not yet durable enough for curated state.
  // 6. Return fail when core product questions cannot be answered from the rendered pages.
  // 7. Return blocked only when the gate cannot be evaluated because required artifacts are missing or unreadable.
  return {
    status: "blocked",
    reasons: ["pseudocode only"],
    weak_questions: [],
    citation_notes: [],
    terminal_state: "uncurated",
  };
}

function questionHasPrecisionEvidence(
  question: ProjectMemoryVisionQualityQuestion,
  renderedPages: ProjectMemoryVisionQualityGateInput["renderedPages"],
): boolean {
  // The gate should check for concrete repo-groundable terms, not just broad topic mentions.
  void question;
  void renderedPages;
  return false;
}

function classifyGateStrength(input: ProjectMemoryVisionQualityGateInput): "strong" | "medium" | "weak" {
  // Live dogfood plus precise citations should rank higher than fixture-only foundation checks.
  void input;
  return "weak";
}
