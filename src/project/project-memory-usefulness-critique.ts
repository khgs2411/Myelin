import { PROJECT_MEMORY_EVIDENCE_MAP_ARTIFACT } from "./project-memory-evidence-map.ts";

export const PROJECT_MEMORY_USEFULNESS_CRITIQUE_ARTIFACT = "project-memory-usefulness-critique.json" as const;
export const PROJECT_MEMORY_USEFULNESS_CRITIQUE_VERDICTS = ["pass", "review_only", "fail"] as const;

export type ProjectMemoryUsefulnessCritiqueVerdict = (typeof PROJECT_MEMORY_USEFULNESS_CRITIQUE_VERDICTS)[number];

export type ProjectMemoryUsefulnessCritique = {
  schema_version: 1;
  project_key: string;
  verdict: ProjectMemoryUsefulnessCritiqueVerdict;
  reasons: string[];
  weak_sections: { page_path: string; heading: string; reason: string }[];
  evidence_map_ref: typeof PROJECT_MEMORY_EVIDENCE_MAP_ARTIFACT;
  rendered_markdown_refs: string[];
};

export function parseProjectMemoryUsefulnessCritique(value: unknown): ProjectMemoryUsefulnessCritique | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  if (record.schema_version !== 1) return null;
  if (typeof record.project_key !== "string") return null;
  if (!PROJECT_MEMORY_USEFULNESS_CRITIQUE_VERDICTS.includes(record.verdict as ProjectMemoryUsefulnessCritiqueVerdict)) {
    return null;
  }
  if (!arrayOfStrings(record.reasons)) return null;
  if (!Array.isArray(record.weak_sections)) return null;
  const weakSections = record.weak_sections.map((item) => {
    if (!item || typeof item !== "object" || Array.isArray(item)) return null;
    const section = item as Record<string, unknown>;
    if (
      typeof section.page_path !== "string" ||
      typeof section.heading !== "string" ||
      typeof section.reason !== "string"
    ) {
      return null;
    }
    return {
      page_path: section.page_path,
      heading: section.heading,
      reason: section.reason,
    };
  });
  if (weakSections.some((item) => item === null)) return null;
  if (record.evidence_map_ref !== PROJECT_MEMORY_EVIDENCE_MAP_ARTIFACT) return null;
  if (!arrayOfStrings(record.rendered_markdown_refs)) return null;

  return {
    schema_version: 1,
    project_key: record.project_key,
    verdict: record.verdict as ProjectMemoryUsefulnessCritiqueVerdict,
    reasons: record.reasons,
    weak_sections: weakSections as ProjectMemoryUsefulnessCritique["weak_sections"],
    evidence_map_ref: PROJECT_MEMORY_EVIDENCE_MAP_ARTIFACT,
    rendered_markdown_refs: record.rendered_markdown_refs,
  };
}

export function buildProjectMemoryUsefulnessCritiquePrompt(input: {
  projectKey: string;
  evidenceMapJson: string;
  renderedMarkdown: { page_path: string; markdown: string }[];
}): string {
  return [
    "You are auditing first-create Project Memory usefulness.",
    "Return JSON only.",
    "Review rendered markdown and the evidence map. Do not use hidden curator reasoning.",
    "Verdict must be one of: pass, review_only, fail.",
    "Use fail when the docs are too generic, shallow, or cannot answer core repo questions.",
    "Use review_only only for concrete unresolved risks: unsupported high-impact claims, contradictions inside the rendered docs, missing evidence for a required answer domain, or command/state semantics that remain ambiguous after reading citations.",
    "Do not return review_only merely because a cited current-state or roadmap claim could drift later; cite drift as a weakness only when the rendered text lacks a source or overstates certainty beyond the evidence map.",
    "Use pass when the rendered docs are repo-specific, answer the core questions, cite the relevant evidence-map sources, and any remaining uncertainty is bounded in the text.",
    `Project key: ${input.projectKey}`,
    `Evidence map artifact: ${PROJECT_MEMORY_EVIDENCE_MAP_ARTIFACT}`,
    "Evidence map JSON:",
    input.evidenceMapJson,
    "Rendered markdown pages:",
    ...input.renderedMarkdown.flatMap((page) => [`--- ${page.page_path} ---`, page.markdown]),
  ].join("\n");
}

function arrayOfStrings(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === "string");
}
