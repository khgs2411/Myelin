import type { ProjectMemoryMarkdownLines } from "./project-memory-apply-contracts.ts";
import type { ProjectMemoryEvidenceRef, ProjectMemoryRepoCitation } from "./project-memory-curator-contracts.ts";
import { normalizeMarkdown } from "./project-memory-markdown-renderer.ts";

export type ResolvedMarkdownSectionRange = {
  wiki_path: string;
  section_id: string;
  section_hash: string;
  heading_path: string[];
  start_line?: number;
  end_line?: number;
};

export function patchMarkdownSection(text: string, input: {
  section: ResolvedMarkdownSectionRange;
  expected_section_hash: string;
  body: string;
}): string {
  if (input.section.section_hash !== input.expected_section_hash) {
    throw new Error(`stale section hash for ${input.section.wiki_path}#${input.section.section_id}`);
  }
  if (!Number.isInteger(input.section.start_line) || !Number.isInteger(input.section.end_line) || (input.section.start_line ?? 0) <= 0) {
    throw new Error(`invalid section range for ${input.section.wiki_path}#${input.section.section_id}`);
  }
  const lines = text.split(/\r?\n/);
  const startIndex = input.section.start_line! - 1;
  const endIndexInclusive = Math.min(input.section.end_line!, lines.length) - 1;
  const headingLine = lines[startIndex] ?? "";
  if (!headingLine.startsWith("#")) {
    throw new Error(`section range does not start at heading for ${input.section.wiki_path}#${input.section.section_id}`);
  }
  return normalizeMarkdown([
    ...lines.slice(0, startIndex + 1),
    "",
    input.body.trimEnd(),
    "",
    ...lines.slice(endIndexInclusive + 1),
  ].join("\n"));
}

export function insertMarkdownSection(text: string, input: { heading: string; level: number; body: string }): string {
  const heading = `${"#".repeat(input.level)} ${input.heading}`;
  return normalizeMarkdown(`${text.trimEnd()}\n\n${heading}\n\n${input.body.trimEnd()}\n`);
}

export function renderSectionBody(input: {
  body: ProjectMemoryMarkdownLines;
  evidence_refs: ProjectMemoryEvidenceRef[];
  repo_citations: ProjectMemoryRepoCitation[];
}): string {
  return [
    ...renderMarkdownLines(input.body),
    "",
    "Provenance:",
    "",
    ...input.evidence_refs.map((ref) => `- Evidence: ${ref.kind}:${ref.ref}${ref.note ? ` - ${ref.note}` : ""}`),
    ...input.repo_citations.map((citation) => {
      const range = citation.line_start ? `:${citation.line_start}${citation.line_end ? `-${citation.line_end}` : ""}` : "";
      return `- Repo: ${citation.path}${range} - ${citation.reason}`;
    }),
  ].join("\n");
}

function renderMarkdownLines(body: ProjectMemoryMarkdownLines): string[] {
  const lines: string[] = [];
  for (const paragraph of body.paragraphs) lines.push(paragraph, "");
  for (const bullet of body.bullets ?? []) lines.push(`- ${bullet}`);
  if ((body.bullets ?? []).length > 0) lines.push("");
  for (const warning of body.warnings ?? []) lines.push(`> ${warning}`, "");
  while (lines.at(-1) === "") lines.pop();
  return lines;
}
