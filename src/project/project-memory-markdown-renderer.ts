import { createHash } from "node:crypto";
import type {
  ProjectMemoryApplicability,
  ProjectMemoryBoundedSnippet,
  ProjectMemoryEntryDraft,
  ProjectMemoryInferenceLabel,
  ProjectMemoryPageDraft,
} from "./project-memory-apply-contracts.ts";
import type { ProjectMemoryEvidenceRef, ProjectMemoryRepoCitation } from "./project-memory-curator-contracts.ts";

const ENTRY_START_RE = /<!-- myelin-entry id="([^"]+)" lifecycle="([^"]+)"(?: [^>]*)? -->/g;
const ENTRY_MARKER_RE = /<!-- \/?myelin-entry\b/;
const ENTRY_CLOSE = "<!-- /myelin-entry -->";

export function renderEntryBlock(entry: ProjectMemoryEntryDraft): string {
  rejectMarkerBreakingContent([
    entry.entry_id,
    entry.title,
    ...entry.body.paragraphs,
    ...(entry.body.bullets ?? []),
    ...(entry.body.warnings ?? []),
  ]);
  return [
    `<!-- myelin-entry id="${escapeAttr(entry.entry_id)}" lifecycle="${escapeAttr(entry.lifecycle)}" -->`,
    `### ${entry.title}`,
    "",
    ...renderMarkdownLines(entry.body),
    "",
    ...renderProvenance(entry.evidence_refs, entry.repo_citations, entry.inference),
    ...renderApplicability(entry.applicability),
    ENTRY_CLOSE,
  ].join("\n");
}

export function renderPageDraft(page: ProjectMemoryPageDraft): string {
  rejectMarkerBreakingContent([
    page.page_path,
    page.title,
    page.purpose,
    ...page.sections.flatMap((section) => [
      section.heading,
      ...section.body.paragraphs,
      ...(section.body.bullets ?? []),
      ...(section.body.warnings ?? []),
    ]),
  ]);
  return normalizeMarkdown([
    `# ${page.title}`,
    "",
    page.purpose,
    "",
    ...page.sections.flatMap((section) => renderPageSection(section)),
    ...renderPageProvenance(page),
    "",
  ].join("\n"));
}

function renderPageSection(section: ProjectMemoryPageDraft["sections"][number]): string[] {
  return [
    `## ${section.heading}`,
    "",
    ...renderMarkdownLines(section.body),
    "",
    ...renderProvenance(section.evidence_refs, section.repo_citations, section.inference),
    "",
  ];
}

function renderPageProvenance(page: ProjectMemoryPageDraft): string[] {
  return [
    "Page provenance:",
    "",
    ...renderProvenance(page.evidence_refs, page.repo_citations, page.inference).slice(2),
  ];
}

export function upsertEntryBlock(pageText: string, entryId: string, renderedBlock: string): string {
  const range = findEntryBlock(pageText, entryId);
  if (range) {
    return normalizeMarkdown(`${pageText.slice(0, range.start)}${renderedBlock}${pageText.slice(range.end)}`);
  }
  const base = pageText.trimEnd();
  const heading = base.includes("## Project Memory Updates") ? "" : "\n\n## Project Memory Updates";
  return normalizeMarkdown(`${base}${heading}\n\n${renderedBlock}`);
}

export function updateEntryLifecycle(pageText: string, entryId: string, lifecycle: string, reasonBlock: string): string {
  const range = findEntryBlock(pageText, entryId);
  if (!range) throw new Error(`Missing Project Memory entry block: ${entryId}`);
  const block = pageText.slice(range.start, range.end);
  const nextBlock = block
    .replace(/<!-- myelin-entry id="([^"]+)" lifecycle="([^"]+)"(.*?) -->/, `<!-- myelin-entry id="$1" lifecycle="${escapeAttr(lifecycle)}"$3 -->`)
    .replace(ENTRY_CLOSE, `\nLifecycle:\n\n${reasonBlock}\n\n${ENTRY_CLOSE}`);
  return normalizeMarkdown(`${pageText.slice(0, range.start)}${nextBlock}${pageText.slice(range.end)}`);
}

export function findEntryBlock(pageText: string, entryId: string): { start: number; end: number; text: string } | null {
  ENTRY_START_RE.lastIndex = 0;
  for (let match = ENTRY_START_RE.exec(pageText); match; match = ENTRY_START_RE.exec(pageText)) {
    if (match[1] !== entryId) continue;
    const close = pageText.indexOf(ENTRY_CLOSE, match.index);
    if (close === -1) throw new Error(`Unclosed Project Memory entry block: ${entryId}`);
    const end = close + ENTRY_CLOSE.length;
    return { start: match.index, end, text: pageText.slice(match.index, end) };
  }
  return null;
}

export function boundedSnippetForText(path: string, anchor: string, text: string, maxChars = 800): ProjectMemoryBoundedSnippet {
  const truncated = text.length > maxChars;
  return {
    path,
    anchor,
    sha256: sha256(text),
    text: truncated ? text.slice(0, maxChars) : text,
    truncated,
  };
}

export function normalizeMarkdown(text: string): string {
  return `${text.replace(/\r\n/g, "\n").replace(/[ \t]+$/gm, "").trimEnd()}\n`;
}

function renderMarkdownLines(body: ProjectMemoryEntryDraft["body"]): string[] {
  const lines: string[] = [];
  for (const paragraph of body.paragraphs) lines.push(paragraph, "");
  for (const bullet of body.bullets ?? []) lines.push(`- ${bullet}`);
  if ((body.bullets ?? []).length > 0) lines.push("");
  for (const warning of body.warnings ?? []) lines.push(`> ${warning}`, "");
  while (lines.at(-1) === "") lines.pop();
  return lines;
}

function renderProvenance(
  evidenceRefs: ProjectMemoryEvidenceRef[],
  repoCitations: ProjectMemoryRepoCitation[],
  inference?: ProjectMemoryInferenceLabel,
): string[] {
  const lines = ["Provenance:", ""];
  for (const ref of evidenceRefs) {
    lines.push(`- Evidence: ${ref.kind}:${ref.ref}${ref.note ? ` - ${ref.note}` : ""}`);
  }
  for (const citation of repoCitations) {
    const range = citation.line_start ? `:${citation.line_start}${citation.line_end ? `-${citation.line_end}` : ""}` : "";
    lines.push(`- Repo: ${citation.path}${range} - ${citation.reason}`);
  }
  if (inference) {
    lines.push(`- Inference: ${inference.label} - ${inference.why_direct_repo_evidence_is_unavailable}`);
    if (inference.basis) lines.push(`- Inference basis: ${inference.basis}`);
  }
  return lines;
}

function renderApplicability(applicability?: ProjectMemoryApplicability): string[] {
  if (!applicability) return [];
  const lines = ["", "Applicability:", ""];
  for (const branch of applicability.branches ?? []) lines.push(`- Branch: ${branch}`);
  for (const path of applicability.repo_paths ?? []) lines.push(`- Path: ${path}`);
  for (const command of applicability.commands ?? []) lines.push(`- Command: ${command}`);
  if (applicability.notes) lines.push(`- Notes: ${applicability.notes}`);
  return lines.length > 3 ? lines : [];
}

function rejectMarkerBreakingContent(values: string[]): void {
  if (values.some((value) => ENTRY_MARKER_RE.test(value))) {
    throw new Error("Entry content cannot contain myelin-entry markers");
  }
}

function escapeAttr(value: string): string {
  return value.replaceAll("&", "&amp;").replaceAll('"', "&quot;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
}

function sha256(text: string): string {
  return createHash("sha256").update(text).digest("hex");
}
