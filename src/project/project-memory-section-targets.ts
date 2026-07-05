import type { ProjectMemoryMarkdownSection } from "./project-memory-markdown-sections.ts";

export type ProjectMemorySectionTargetRef = {
  wiki_path: string;
  section_id: string;
  expected_section_hash?: string;
};

export type ProjectMemoryResolvedSectionTarget =
  | { status: "resolved"; section: ProjectMemoryMarkdownSection }
  | { status: "missing_section"; ref: ProjectMemorySectionTargetRef }
  | { status: "stale_hash"; ref: ProjectMemorySectionTargetRef; actual_hash: string };

export function sectionTargetKey(ref: Pick<ProjectMemorySectionTargetRef, "wiki_path" | "section_id">): string {
  return `${ref.wiki_path}#${ref.section_id}`;
}

export function resolveSectionTarget(
  sections: ProjectMemoryMarkdownSection[],
  ref: ProjectMemorySectionTargetRef,
): ProjectMemoryResolvedSectionTarget {
  const section = sections.find((item) => item.wiki_path === ref.wiki_path && item.section_id === ref.section_id);
  if (!section) return { status: "missing_section", ref };
  if (ref.expected_section_hash && section.section_hash !== ref.expected_section_hash) {
    return { status: "stale_hash", ref, actual_hash: section.section_hash };
  }
  return { status: "resolved", section };
}
