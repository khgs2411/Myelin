import { createHash } from "node:crypto";
import { mkdir, readFile, readdir, stat, writeFile } from "node:fs/promises";
import { basename, dirname, relative } from "node:path";
import { projectPath, resolveInside } from "../runtime/fs.ts";
import { stableJson } from "../runtime/json.ts";
import type { ProjectMemoryCanonicalSectionRef } from "./project-memory-retrieval-contracts.ts";

export type ProjectMemoryMarkdownPage = {
  project_key: string;
  wiki_path: string;
  absolute_path: string;
  category: string | null;
  slug: string;
  title: string;
  page_hash: string;
  size_bytes: number;
};

export type ProjectMemoryMarkdownSection = ProjectMemoryCanonicalSectionRef & {
  heading_level: number;
  heading_text: string;
  body_text: string;
  snippet: string;
  start_line?: number;
  end_line?: number;
};

export type ProjectMemorySectionManifest = {
  schema_version: 1;
  project_key: string;
  generated_at: string;
  pages: ProjectMemoryMarkdownPage[];
  sections: ProjectMemoryMarkdownSection[];
  warnings: string[];
};

type HeadingBlock = {
  level: number;
  text: string;
  line: number;
  bodyStart: number;
  bodyEnd: number;
};

export async function extractProjectMemorySections(
  root: string,
  projectKey: string,
  input: { now?: Date } = {},
): Promise<ProjectMemorySectionManifest> {
  const wikiRoot = projectPath(root, projectKey, "wiki");
  if (!(await isDirectory(wikiRoot))) {
    return {
      schema_version: 1,
      project_key: projectKey,
      generated_at: (input.now ?? new Date()).toISOString(),
      pages: [],
      sections: [],
      warnings: [`projects/${projectKey}/wiki directory missing`],
    };
  }

  const files = (await markdownFiles(wikiRoot)).sort();
  const pages: ProjectMemoryMarkdownPage[] = [];
  const sections: ProjectMemoryMarkdownSection[] = [];
  const warnings: string[] = [];

  for (const file of files) {
    const text = await readFile(file, "utf8");
    const wikiPath = `wiki/${relative(wikiRoot, file).replaceAll("\\", "/")}`;
    const category = categoryFor(wikiPath);
    const title = titleForMarkdown(wikiPath, text);
    pages.push({
      project_key: projectKey,
      wiki_path: wikiPath,
      absolute_path: file,
      category,
      slug: basename(wikiPath, ".md"),
      title,
      page_hash: hashText(normalizeText(text)),
      size_bytes: Buffer.byteLength(text, "utf8"),
    });
    sections.push(...sectionsForPage({ projectKey, wikiPath, category, title, text, warnings }));
  }

  return {
    schema_version: 1,
    project_key: projectKey,
    generated_at: (input.now ?? new Date()).toISOString(),
    pages,
    sections,
    warnings,
  };
}

export function extractProjectMemorySectionsFromMarkdown(input: {
  projectKey: string;
  wikiPath: string;
  text: string;
  category?: string | null;
  title?: string;
  warnings?: string[];
}): ProjectMemoryMarkdownSection[] {
  const warnings = input.warnings ?? [];
  return sectionsForPage({
    projectKey: input.projectKey,
    wikiPath: input.wikiPath,
    category: input.category ?? categoryFor(input.wikiPath),
    title: input.title ?? titleForMarkdown(input.wikiPath, input.text),
    text: input.text,
    warnings,
  });
}

export async function writeProjectMemorySectionManifest(
  root: string,
  manifest: ProjectMemorySectionManifest,
): Promise<string> {
  const relativePath = `projects/${manifest.project_key}/state/project-memory-retrieval/sections.json`;
  const absolutePath = resolveInside(root, relativePath);
  await mkdir(dirname(absolutePath), { recursive: true });
  await writeFile(absolutePath, `${stableJson(manifest)}\n`, "utf8");
  return relativePath;
}

async function markdownFiles(dir: string): Promise<string[]> {
  const files: string[] = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    if (entry.name.startsWith(".")) continue;
    const path = resolveInside(dir, entry.name);
    if (entry.isDirectory()) files.push(...(await markdownFiles(path)));
    else if (entry.isFile() && entry.name.endsWith(".md")) files.push(path);
  }
  return files;
}

function sectionsForPage(input: {
  projectKey: string;
  wikiPath: string;
  category: string | null;
  title: string;
  text: string;
  warnings: string[];
}): ProjectMemoryMarkdownSection[] {
  const lines = input.text.split(/\r?\n/);
  const headings = headingBlocks(lines);
  if (headings.length === 0) {
    if (normalizeText(input.text).length === 0) {
      input.warnings.push(`${input.wikiPath} is empty`);
    }
    return [
      sectionForBlock({
        ...input,
        headingPath: [input.title],
        block: {
          level: 1,
          text: input.title,
          line: 1,
          bodyStart: 1,
          bodyEnd: lines.length,
        },
        bodyText: input.text,
        ordinal: 1,
      }),
    ];
  }

  const sections: ProjectMemoryMarkdownSection[] = [];
  const headingPathByLevel = new Map<number, string>();
  const headingCounts = new Map<string, number>();

  for (const block of headings) {
    for (const level of [...headingPathByLevel.keys()]) {
      if (level >= block.level) headingPathByLevel.delete(level);
    }
    headingPathByLevel.set(block.level, block.text);
    const headingPath = [...headingPathByLevel.entries()]
      .sort((a, b) => a[0] - b[0])
      .map(([, heading]) => heading);
    const baseId = headingPath.map(slugify).filter(Boolean).join("/") || "page-overview";
    const ordinal = (headingCounts.get(baseId) ?? 0) + 1;
    headingCounts.set(baseId, ordinal);
    if (ordinal > 1) {
      input.warnings.push(`${input.wikiPath} has duplicate heading path: ${headingPath.join(" > ")}`);
    }
    sections.push(
      sectionForBlock({
        ...input,
        headingPath,
        block,
        bodyText: lines.slice(block.bodyStart - 1, block.bodyEnd).join("\n"),
        ordinal,
      }),
    );
  }

  return sections;
}

function sectionForBlock(input: {
  projectKey: string;
  wikiPath: string;
  category: string | null;
  title: string;
  headingPath: string[];
  block: HeadingBlock;
  bodyText: string;
  ordinal: number;
}): ProjectMemoryMarkdownSection {
  const bodyText = normalizeText(input.bodyText);
  return {
    project_key: input.projectKey,
    wiki_path: input.wikiPath,
    category: input.category,
    page_title: input.title,
    section_id: sectionIdFor(input.headingPath, input.ordinal),
    heading_path: input.headingPath,
    section_hash: sectionHash({ heading_path: input.headingPath, body_text: bodyText }),
    heading_level: input.block.level,
    heading_text: input.block.text,
    body_text: bodyText,
    snippet: snippetFor(bodyText),
    start_line: input.block.line,
    end_line: input.block.bodyEnd,
  };
}

function headingBlocks(lines: string[]): HeadingBlock[] {
  const headings: HeadingBlock[] = [];
  for (let index = 0; index < lines.length; index += 1) {
    const match = lines[index].match(/^(#{1,6})\s+(.+?)\s*#*\s*$/);
    if (!match) continue;
    headings.push({
      level: match[1].length,
      text: match[2].trim(),
      line: index + 1,
      bodyStart: index + 2,
      bodyEnd: lines.length,
    });
  }
  for (let index = 0; index < headings.length; index += 1) {
    headings[index].bodyEnd = (headings[index + 1]?.line ?? lines.length + 1) - 1;
  }
  return headings;
}

function sectionIdFor(headingPath: string[], ordinal: number): string {
  const base = headingPath.map(slugify).filter(Boolean).join("/") || "page-overview";
  return ordinal > 1 ? `${base}-${ordinal}` : base;
}

function sectionHash(input: { heading_path: string[]; body_text: string }): string {
  return hashText(`${input.heading_path.join("\n")}\n\n${normalizeText(input.body_text)}`);
}

function hashText(text: string): string {
  return `sha256:${createHash("sha256").update(text).digest("hex")}`;
}

function normalizeText(text: string): string {
  return text.replace(/\r\n/g, "\n").replace(/[ \t]+$/gm, "").trim();
}

function snippetFor(text: string): string {
  return text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && !line.startsWith("#"))
    .join(" ")
    .slice(0, 500);
}

function categoryFor(wikiPath: string): string | null {
  const parts = wikiPath.split("/");
  return parts.length > 2 ? parts[1] : null;
}

function titleForMarkdown(path: string, text: string): string {
  const heading = text.match(/^#\s+(.+)$/m)?.[1]?.trim();
  if (heading) return heading;
  return basename(path, ".md").replaceAll("-", " ").replaceAll("_", " ").replace(/\b\w/g, (char) => char.toUpperCase());
}

function slugify(value: string): string {
  return (
    value
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "") || "section"
  );
}

async function isDirectory(path: string): Promise<boolean> {
  try {
    return (await stat(path)).isDirectory();
  } catch (error) {
    if (isNotFound(error)) return false;
    throw error;
  }
}

function isNotFound(error: unknown): boolean {
  return Boolean(error && typeof error === "object" && "code" in error && error.code === "ENOENT");
}
