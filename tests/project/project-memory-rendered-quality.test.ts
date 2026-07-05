import { expect, test } from "bun:test";
import {
  evaluateRenderedProjectMemoryQuality,
  PROJECT_MEMORY_CREATE_ANSWERABILITY_QUESTIONS,
} from "../../src/project/project-memory-rendered-quality.ts";
import type { ProjectMemoryAnswerDomain } from "../../src/project/project-memory-quality-contract.ts";
import type { ProjectMemoryCreationPageDraft } from "../../src/project/project-memory-curator-contracts.ts";

test("rendered quality rejects declared domains with thin rendered sections", () => {
  const diagnostics = evaluateRenderedProjectMemoryQuality({
    mode: "create",
    pages: [pageDraft({
      domain: "storage_retrieval",
      body: "SQLite state exists.",
      requiredTopics: ["state/memory.db"],
    })],
    candidate_dispositions: [],
    missing_coverage: [],
    blocked_reasons: [],
    review_reasons: [],
  });

  expect(diagnostics.content_quality.status).toBe("shallow");
  expect(diagnostics.content_quality.reasons.join("\n")).toContain("answer domain has no rendered sections");
  expect(diagnostics.shallow_summary_findings.join("\n")).toContain("section too shallow");
});

test("rendered quality computes storage coverage from rendered markdown sections", () => {
  const diagnostics = evaluateRenderedProjectMemoryQuality({
    mode: "create",
    pages: [pageDraft({
      domain: "storage_retrieval",
      body: [
        "The root SQLite database is stored at state/memory.db for the project runtime.",
        "Session Memory rows are durable memory records, while Project Memory retrieval rows are derived pointers back to markdown sections.",
        "The project query path resolves derived retrieval hits to canonical markdown so agents can answer without rediscovering the repo.",
        "This storage and retrieval distinction is intentionally documented with enough detail for future session and project work.",
      ].join(" "),
      requiredTopics: ["state/memory.db", "derived", "markdown", "session", "project"],
    })],
    candidate_dispositions: [],
    missing_coverage: [],
    blocked_reasons: [],
    review_reasons: [],
  });

  const storage = diagnostics.domain_coverage.find((item) => item.domain === "storage_retrieval");
  expect(storage?.section_refs.length).toBeGreaterThan(0);
  expect(storage?.citations_seen).toBeGreaterThan(0);
  expect(storage?.missing_topics).toEqual([]);
});

test("rendered quality treats required topics as coverage labels instead of exact prose", () => {
  const diagnostics = evaluateRenderedProjectMemoryQuality({
    mode: "create",
    pages: [pageDraft({
      domain: "product_memory_model",
      body: [
        "Project Memory is living repo documentation for Myelin.",
        "The product model separates Session Memory from durable project documentation and gives agents a navigation page for future work.",
        "The create path replaces an uncurated placeholder with cited sections grounded in repository evidence.",
      ].join(" "),
      requiredTopics: ["Project Memory definition", "uncurated placeholder replacement"],
    })],
    candidate_dispositions: [],
    missing_coverage: [],
    blocked_reasons: [],
    review_reasons: [],
  });

  const product = diagnostics.domain_coverage.find((item) => item.domain === "product_memory_model");
  expect(product?.missing_topics).toEqual([]);
});

test("rendered quality rejects repeated boilerplate even when it is long", () => {
  const repeated = [
    "Project Memory is curated markdown under projects/<key>/wiki while Session Memory is stored in the root SQLite database state/memory.db with embeddings and session_memories rows.",
    "Candidates and handoffs are leads from Session Memory, not durable truth; project learn must inspect repo evidence, preserve provenance, validate rendered sections, and apply only trusted markdown.",
    "Operators use project learn, memory query, memory index session, memory index project, memory inbox create, and memory inbox intake.",
  ].join(" ");

  const diagnostics = evaluateRenderedProjectMemoryQuality({
    mode: "create",
    pages: [
      pageDraft({ domain: "product_memory_model", body: repeated, requiredTopics: ["product model"] }),
      pageDraft({ domain: "storage_retrieval", body: repeated, requiredTopics: ["storage"] }),
      pageDraft({ domain: "command_workflows", body: repeated, requiredTopics: ["commands"] }),
    ],
    candidate_dispositions: [],
    missing_coverage: [],
    blocked_reasons: [],
    review_reasons: [],
  });

  expect(diagnostics.content_quality.status).toBe("shallow");
  expect(diagnostics.shallow_summary_findings.join("\n")).toContain("repeated long sentence appears");
});

test("answerability questions exclude blocked as a model critique status", () => {
  expect(PROJECT_MEMORY_CREATE_ANSWERABILITY_QUESTIONS.map((item) => item.domain)).toContain("storage_retrieval");
  expect(JSON.stringify(PROJECT_MEMORY_CREATE_ANSWERABILITY_QUESTIONS)).not.toContain("blocked");
});

function pageDraft(input: {
  domain: ProjectMemoryAnswerDomain;
  body: string;
  requiredTopics: string[];
}): ProjectMemoryCreationPageDraft {
  return {
    id: `${input.domain}_page`,
    target: { path: `${input.domain}.md`, path_kind: "new_wiki_page" },
    title: input.domain,
    purpose: `Document ${input.domain}.`,
    answer_domains: [input.domain],
    required_topics: input.requiredTopics,
    representative_questions: [`How does ${input.domain} work?`],
    content_intent: `Create ${input.domain}`,
    apply_payload: {
      schema_version: 1,
      pages: [
        {
          page_path: `${input.domain}.md`,
          title: input.domain,
          purpose: `Document ${input.domain}.`,
          sections: [
            {
              heading: "Overview",
              level: 2,
              body: { paragraphs: [input.body] },
              evidence_refs: [{ kind: "repo_citation", ref: "src/memory/db.ts" }],
              repo_citations: [{ path: "src/memory/db.ts", line_start: 11, reason: "memory database path" }],
            },
          ],
          evidence_refs: [{ kind: "repo_citation", ref: "src/memory/db.ts" }],
          repo_citations: [{ path: "src/memory/db.ts", line_start: 11, reason: "memory database path" }],
        },
      ],
    },
    inspected_surface_refs: ["src/memory/db.ts"],
    evidence_refs: [{ kind: "repo_citation", ref: "src/memory/db.ts" }],
    repo_citations: [{ path: "src/memory/db.ts", line_start: 11, reason: "memory database path" }],
    notes_for_apply: [],
  };
}
