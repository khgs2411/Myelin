import { readJsonIfExists } from "../runtime/json.ts";
import { statePath } from "../runtime/state.ts";
import type { SchemaContext } from "../schema/types.ts";

const WORD_RE = /[a-z0-9][a-z0-9_-]*/g;
const BROAD_TERMS = new Set(["what", "overview", "main", "components", "architecture", "system", "project"]);
const HOW_TERMS = new Set(["how", "work", "works", "flow", "trace", "process", "implemented", "implementation"]);

export type PageRecord = {
  path: string;
  title: string;
  page_kind: string;
  domains: string[];
  topics: string[];
  aliases: string[];
  source_paths: string[];
  freshness_status: string;
  summary: string;
  entrypoint_rank: number | null;
  canonical: boolean;
};

export type PlannedPage = Pick<PageRecord, "path" | "title" | "page_kind" | "domains" | "freshness_status"> & {
  selection_reason: string;
  score: number;
};

export type QueryPlan = {
  question: string;
  project_key: string;
  memory_scope: string;
  normalized_terms: string[];
  matched_taxonomy: string[];
  selected_pages: PlannedPage[];
  candidate_pages: PlannedPage[];
  freshness_warnings: { path: string; freshness_status: string; message: string }[];
  route_confidence: number;
  route_reason: string;
};

type CatalogPayload = {
  pages?: unknown;
};

type CatalogPage = {
  path?: unknown;
  type?: unknown;
  linked_topics?: unknown;
  linked_sources?: unknown;
  freshness_status?: unknown;
  summary?: unknown;
  entrypoint_rank?: unknown;
};

export async function planQuery(options: {
  root: string;
  projectKey: string;
  question: string;
  schemaContext: SchemaContext;
}): Promise<QueryPlan> {
  const pages = await loadPages(options.root, options.projectKey);
  const terms = new Set(tokenize(options.question));
  const matchedTaxonomy = options.schemaContext.page_taxonomy.categories.filter((category) => terms.has(slug(category)));
  const memoryScope = selectMemoryScope(options.schemaContext);
  const isBroad = [...terms].some((term) => BROAD_TERMS.has(term)) && terms.size <= 8;
  const isHow = [...terms].some((term) => HOW_TERMS.has(term));

  const scored = pages
    .map((page) => scorePage(page, { terms, matchedTaxonomy, isBroad, isHow }))
    .filter((page) => page.score > 0)
    .sort((a, b) => b.score - a.score || entryRank(a) - entryRank(b) || a.path.localeCompare(b.path));

  const fallback = pages
    .filter((page) => page.canonical || page.page_kind === "index")
    .map((page) => compactPage(page, 0.25, "fallback entry page"));
  const candidates = (scored.length > 0 ? scored : fallback).slice(0, 12);
  const selected = candidates.slice(0, 5);

  return {
    question: options.question,
    project_key: options.projectKey,
    memory_scope: memoryScope,
    normalized_terms: [...terms].sort(),
    matched_taxonomy: matchedTaxonomy,
    selected_pages: selected,
    candidate_pages: candidates,
    freshness_warnings: selected
      .filter((page) => !["", "fresh", "unknown"].includes(page.freshness_status))
      .map((page) => ({
        path: page.path,
        freshness_status: page.freshness_status,
        message: `${page.path} is marked ${page.freshness_status}`,
      })),
    route_confidence: routeConfidence(candidates, matchedTaxonomy.length > 0),
    route_reason: matchedTaxonomy.length > 0 ? "schema taxonomy and page catalog" : "page catalog",
  };
}

async function loadPages(root: string, projectKey: string): Promise<PageRecord[]> {
  const metadata = await readJsonIfExists<{ pages?: unknown }>(statePath(root, projectKey, "page-metadata.json"));
  if (Array.isArray(metadata?.pages)) {
    const pages = metadata.pages.map(normalizeMetadataPage).filter((page): page is PageRecord => page !== null);
    if (pages.length > 0) return pages;
  }

  const catalog = await readJsonIfExists<CatalogPayload>(statePath(root, projectKey, "pages.json"));
  if (!Array.isArray(catalog?.pages)) throw new Error(`projects/${projectKey}/state/pages.json missing pages list`);
  return catalog.pages.map(normalizeCatalogPage).filter((page): page is PageRecord => page !== null);
}

function normalizeMetadataPage(value: unknown): PageRecord | null {
  if (!isRecord(value)) return null;
  const path = stringValue(value.path);
  if (!path) return null;
  return {
    path,
    title: stringValue(value.title) || titleFromPath(path),
    page_kind: stringValue(value.page_kind) || "source_reference",
    domains: stringList(value.domains),
    topics: stringList(value.topics),
    aliases: stringList(value.aliases),
    source_paths: stringList(value.source_paths),
    freshness_status: stringValue(value.freshness_status) || "unknown",
    summary: stringValue(value.summary),
    entrypoint_rank: numberOrNull(value.entrypoint_rank),
    canonical: Boolean(value.canonical),
  };
}

function normalizeCatalogPage(value: unknown): PageRecord | null {
  if (!isRecord(value)) return null;
  const page = value as CatalogPage;
  const path = stringValue(page.path);
  if (!path) return null;
  const topics = stringList(page.linked_topics);
  return {
    path,
    title: titleFromPath(path),
    page_kind: pageKindFromCatalogType(stringValue(page.type)),
    domains: topics.filter((topic) => !topic.endsWith(".md") && !topic.includes("/")),
    topics,
    aliases: [titleFromPath(path), path.split("/").pop()?.replace(/\.md$/, "").replaceAll("-", " ") ?? ""].filter(Boolean),
    source_paths: stringList(page.linked_sources),
    freshness_status: stringValue(page.freshness_status) || "unknown",
    summary: stringValue(page.summary),
    entrypoint_rank: numberOrNull(page.entrypoint_rank),
    canonical: path === "index.md",
  };
}

function scorePage(
  page: PageRecord,
  options: { terms: Set<string>; matchedTaxonomy: string[]; isBroad: boolean; isHow: boolean },
): PlannedPage {
  let score = 0;
  const reasons: string[] = [];
  const searchable = new Set(
    tokenize([page.title, page.summary, ...page.domains, ...page.topics, ...page.aliases, page.page_kind].join(" ")),
  );
  const overlap = [...options.terms].filter((term) => searchable.has(term));
  if (overlap.length > 0) {
    score += Math.min(overlap.length, 5);
    reasons.push("term match");
  }
  if (options.matchedTaxonomy.includes(page.page_kind) || options.matchedTaxonomy.some((category) => page.path.includes(category))) {
    score += 3;
    reasons.push("schema taxonomy match");
  }
  if (options.isBroad && (page.canonical || page.entrypoint_rank !== null || ["index", "architecture"].includes(page.page_kind))) {
    score += 3;
    reasons.push("entry page for broad question");
  }
  if (options.isHow && page.source_paths.length > 0) {
    score += 2;
    reasons.push("source-backed for how question");
  }
  if (page.canonical) score += 0.5;
  if (page.freshness_status === "stale") {
    score -= 1;
    reasons.push("stale");
  }
  return compactPage(page, Math.max(0, Number(score.toFixed(3))), reasons.join(", ") || "candidate");
}

function compactPage(page: PageRecord, score: number, reason: string): PlannedPage {
  return {
    path: page.path,
    title: page.title,
    page_kind: page.page_kind,
    domains: page.domains,
    freshness_status: page.freshness_status,
    selection_reason: reason,
    score,
  };
}

function selectMemoryScope(schemaContext: SchemaContext): string {
  if (schemaContext.memory_scopes.phase_0_active.includes("project_wiki")) return "project_wiki";
  return schemaContext.memory_scopes.phase_0_active[0] ?? "none";
}

function routeConfidence(candidates: PlannedPage[], schemaMatched: boolean): number {
  if (candidates.length === 0) return 0;
  const top = candidates[0]?.score ?? 0;
  if (top <= 0) return 0.15;
  return Math.min(0.95, Number((0.3 + top / 12 + (schemaMatched ? 0.1 : 0)).toFixed(3)));
}

function entryRank(page: PlannedPage): number {
  return page.page_kind === "index" ? 0 : 999;
}

function pageKindFromCatalogType(type: string): string {
  const mapping: Record<string, string> = {
    index: "index",
    architecture: "architecture",
    systems: "system",
    modules: "module",
    integrations: "integration",
    runbooks: "runbook",
    decisions: "decision",
    sessions: "session",
    glossary: "glossary",
    "open-questions": "open_question",
  };
  return mapping[type] ?? "source_reference";
}

function titleFromPath(path: string): string {
  if (path === "index.md") return "Index";
  const base = path.split("/").pop()?.replace(/\.md$/, "") ?? path;
  return base.replaceAll("-", " ").replaceAll("_", " ").replace(/\b\w/g, (char) => char.toUpperCase());
}

function slug(value: string): string {
  return tokenize(value).join("-");
}

function tokenize(value: string): string[] {
  return value.toLowerCase().match(WORD_RE) ?? [];
}

function stringList(value: unknown): string[] {
  return Array.isArray(value) ? value.map(stringValue).filter(Boolean) : [];
}

function stringValue(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function numberOrNull(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
