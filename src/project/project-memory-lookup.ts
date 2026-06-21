import { readFile, readdir, stat } from "node:fs/promises";
import { basename, relative } from "node:path";
import { projectPath, resolveInside } from "../runtime/fs.ts";

export type ProjectMemoryPage = {
  path: string;
  title: string;
  headings: string[];
  snippet: string;
  size_bytes: number;
};

export type ProjectMemoryLookupMatch = {
  path: string;
  title: string;
  score: number;
  matched_terms: string[];
  snippet: string;
};

export type ProjectMemoryLookupResult = {
  query: string;
  normalized_terms: string[];
  matches: ProjectMemoryLookupMatch[];
  degraded: boolean;
  degraded_reason: string | null;
  source_tools: string[];
};

export type ProjectMemoryLookupCorpus = {
  pages: ProjectMemoryPage[];
  search_text_by_path: Record<string, string>;
};

const WORD_RE = /[a-z0-9][a-z0-9_-]*/g;
const STOP_TERMS = new Set([
  "a",
  "an",
  "and",
  "are",
  "for",
  "from",
  "has",
  "how",
  "into",
  "is",
  "it",
  "of",
  "on",
  "or",
  "the",
  "to",
  "what",
  "when",
  "where",
  "with",
]);

export async function loadProjectMemoryPages(root: string, projectKey: string): Promise<ProjectMemoryPage[]> {
  return (await loadProjectMemoryCorpus(root, projectKey)).pages;
}

export async function loadProjectMemoryCorpus(root: string, projectKey: string): Promise<ProjectMemoryLookupCorpus> {
  const wikiRoot = projectPath(root, projectKey, "wiki");
  if (!(await isDirectory(wikiRoot))) return { pages: [], search_text_by_path: {} };

  const files = await markdownFiles(wikiRoot);
  const pages: ProjectMemoryPage[] = [];
  const searchTextByPath: Record<string, string> = {};
  for (const file of files.sort()) {
    const text = await readFile(file, "utf8");
    const pagePath = `wiki/${relative(wikiRoot, file).replaceAll("\\", "/")}`;
    pages.push({
      path: pagePath,
      title: titleForMarkdown(pagePath, text),
      headings: headingsFor(text),
      snippet: compactSnippet(text),
      size_bytes: Buffer.byteLength(text, "utf8"),
    });
    searchTextByPath[pagePath] = text;
  }
  return { pages, search_text_by_path: searchTextByPath };
}

export async function lookupProjectMemory(
  root: string,
  projectKey: string,
  query: string,
  input: { pages?: ProjectMemoryPage[]; searchTextByPath?: Record<string, string>; limit?: number } = {},
): Promise<ProjectMemoryLookupResult> {
  const pages = input.pages ?? (await loadProjectMemoryPages(root, projectKey));
  const terms = tokenize(query);
  const matches = pages
    .map((page) => scorePage(page, terms, input.searchTextByPath?.[page.path]))
    .filter((match) => match.score > 0)
    .sort((a, b) => b.score - a.score || a.path.localeCompare(b.path))
    .slice(0, input.limit ?? 5);

  return {
    query,
    normalized_terms: terms,
    matches,
    degraded: true,
    degraded_reason: "Project Memory lookup is markdown text search only; derived metadata/vector indexes are not implemented.",
    source_tools: ["project-memory-markdown-scan"],
  };
}

function scorePage(page: ProjectMemoryPage, terms: string[], fullText?: string): ProjectMemoryLookupMatch {
  const titleTerms = new Set(tokenize(page.title));
  const headingTerms = new Set(tokenize(page.headings.join(" ")));
  const bodyTerms = new Set(tokenize(fullText ?? page.snippet));
  const matched = terms.filter((term) => titleTerms.has(term) || headingTerms.has(term) || bodyTerms.has(term));
  let score = 0;
  for (const term of terms) {
    if (titleTerms.has(term)) score += 3;
    if (headingTerms.has(term)) score += 2;
    if (bodyTerms.has(term)) score += 1;
  }
  if (page.path.endsWith("/index.md")) score += 0.25;

  return {
    path: page.path,
    title: page.title,
    score: Number(score.toFixed(3)),
    matched_terms: [...new Set(matched)].sort(),
    snippet: page.snippet,
  };
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

function titleForMarkdown(path: string, text: string): string {
  const heading = text.match(/^#\s+(.+)$/m)?.[1]?.trim();
  if (heading) return heading;
  return basename(path, ".md").replaceAll("-", " ").replaceAll("_", " ").replace(/\b\w/g, (char) => char.toUpperCase());
}

function headingsFor(text: string): string[] {
  return [...text.matchAll(/^#{1,6}\s+(.+)$/gm)].map((match) => match[1].trim()).slice(0, 12);
}

function compactSnippet(text: string): string {
  return text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && !line.startsWith("#"))
    .join(" ")
    .slice(0, 500);
}

function tokenize(value: string): string[] {
  return [...new Set((value.toLowerCase().match(WORD_RE) ?? []).filter((term) => !STOP_TERMS.has(term)))].sort();
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
