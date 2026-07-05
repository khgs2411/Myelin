import { extractProjectMemorySectionsFromMarkdown, type ProjectMemoryMarkdownSection } from "./project-memory-markdown-sections.ts";
import { renderPageDraft } from "./project-memory-markdown-renderer.ts";
import {
  evaluateProjectMemoryQuality,
  PROJECT_MEMORY_ANSWER_DOMAINS,
  type ProjectMemoryAnswerDomain,
  type ProjectMemoryQualityDiagnostics,
} from "./project-memory-quality-contract.ts";
import type { ProjectMemoryCreationPageDraft, ProjectMemoryCuratorMode } from "./project-memory-curator-contracts.ts";

export type ProjectMemoryAnswerabilityQuestion = {
  domain: ProjectMemoryAnswerDomain;
  question: string;
  required_terms: string[];
};

export const PROJECT_MEMORY_CREATE_ANSWERABILITY_QUESTIONS: ProjectMemoryAnswerabilityQuestion[] = [
  {
    domain: "storage_retrieval",
    question: "Where is the SQLite database stored?",
    required_terms: ["state/memory.db", "session", "project"],
  },
  {
    domain: "storage_retrieval",
    question: "How do Project Memory retrieval rows differ from Session Memory rows?",
    required_terms: ["derived", "markdown", "session"],
  },
  {
    domain: "command_workflows",
    question: "Which CLI commands operate Project Memory?",
    required_terms: ["project learn", "memory query"],
  },
  {
    domain: "curation_apply_lifecycle",
    question: "How is Project Memory created and applied?",
    required_terms: ["curator", "validation", "apply"],
  },
  {
    domain: "evidence_provenance_candidates",
    question: "How do candidates become Project Memory?",
    required_terms: ["candidate", "lead", "evidence"],
  },
  {
    domain: "current_work_roadmap_decisions",
    question: "Where are roadmap and decisions captured?",
    required_terms: ["ROADMAP", "ADR"],
  },
  {
    domain: "product_memory_model",
    question: "What is Project Memory in Myelin?",
    required_terms: ["project memory", "curated", "markdown", "project"],
  },
];

export function evaluateRenderedProjectMemoryQuality(input: {
  mode: ProjectMemoryCuratorMode;
  pages: ProjectMemoryCreationPageDraft[];
  candidate_dispositions: ProjectMemoryQualityDiagnostics["candidate_dispositions"];
  missing_coverage: string[];
  blocked_reasons: string[];
  review_reasons: string[];
}): ProjectMemoryQualityDiagnostics {
  const renderedPages = input.pages.flatMap((page) => {
    const payloadPage = page.apply_payload?.pages?.find((candidate) => candidate.page_path === page.target.path);
    if (!payloadPage || !Array.isArray((payloadPage as { sections?: unknown }).sections)) return [];
    if (!Array.isArray((page as { answer_domains?: unknown }).answer_domains)) return [];
    if (!Array.isArray((page as { required_topics?: unknown }).required_topics)) return [];
    if (!Array.isArray((page as { representative_questions?: unknown }).representative_questions)) return [];
    const markdown = renderPageDraft(payloadPage);
    const sections = extractProjectMemorySectionsFromMarkdown({
      projectKey: "draft",
      wikiPath: `wiki/${payloadPage.page_path}`,
      text: markdown,
    }).filter((section) => section.heading_level > 1);
    return [{ page, markdown, sections }];
  });

  const domain_coverage = PROJECT_MEMORY_ANSWER_DOMAINS.map((domain) => {
    const pages = renderedPages.filter((entry) => entry.page.answer_domains.includes(domain));
    const sections = pages.flatMap((entry) => entry.sections);
    const bodyText = sections.map((section) => section.body_text).join("\n");
    return {
      domain,
      page_refs: pages.map((entry) => entry.page.target.path),
      section_refs: sections.map((section) => section.section_id),
      representative_questions: pages.flatMap((entry) => entry.page.representative_questions),
      citations_seen: countRepoCitations(bodyText),
      body_chars_seen: bodyText.replace(/\s/g, "").length,
      missing_topics: [],
    };
  });

  const markdown = renderedPages.map((entry) => entry.markdown).join("\n");
  const shallow_summary_findings = [
    ...renderedPages.flatMap((entry) => shallowSectionFindings(entry.page.target.path, entry.sections)),
    ...repetitiveSentenceFindings(renderedPages.flatMap((entry) => entry.sections)),
  ];

  return evaluateProjectMemoryQuality({
    mode: input.mode,
    domain_coverage,
    candidate_dispositions: input.candidate_dispositions,
    missing_coverage: input.missing_coverage,
    shallow_summary_findings,
    answerability_findings: answerabilityFindings(markdown),
    blocked_reasons: input.blocked_reasons,
    review_reasons: input.review_reasons,
  });
}

function countRepoCitations(text: string): number {
  return [...text.matchAll(/^- Repo:/gm)].length;
}

function answerabilityFindings(markdown: string): string[] {
  const normalized = markdown.toLowerCase();
  return PROJECT_MEMORY_CREATE_ANSWERABILITY_QUESTIONS
    .filter((question) => question.required_terms.some((term) => !normalized.includes(term.toLowerCase())))
    .map((question) => `missing answerability evidence for ${question.domain}: ${question.question}`);
}

function shallowSectionFindings(pagePath: string, sections: Pick<ProjectMemoryMarkdownSection, "body_text" | "heading_path">[]): string[] {
  return sections
    .filter((section) => section.body_text.replace(/\s/g, "").length < 300)
    .map((section) => `section too shallow in ${pagePath}: ${section.heading_path.join(" > ")}`);
}

function repetitiveSentenceFindings(sections: Pick<ProjectMemoryMarkdownSection, "body_text">[]): string[] {
  const sentenceCounts = new Map<string, number>();
  for (const section of sections) {
    for (const sentence of section.body_text.split(/(?<=[.!?])\s+/)) {
      const normalized = normalizeLongSentence(sentence);
      if (!normalized) continue;
      sentenceCounts.set(normalized, (sentenceCounts.get(normalized) ?? 0) + 1);
    }
  }

  return [...sentenceCounts.entries()]
    .filter(([, count]) => count >= 3)
    .map(([sentence, count]) => `repeated long sentence appears ${count} times: ${sentence.slice(0, 120)}`);
}

function normalizeLongSentence(sentence: string): string | null {
  const normalized = sentence
    .replace(/^- (Evidence|Repo):.*$/gm, "")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
  return normalized.length >= 140 ? normalized : null;
}
