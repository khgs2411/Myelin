import { expect, test } from "bun:test";
import { normalizeProjectMemorySectionForEmbedding } from "../../src/memory/project-memory-retrieval-text.ts";

test("normalizes Project Memory section text with valid hints after structural text", () => {
  const text = normalizeProjectMemorySectionForEmbedding({
    page_title: "Ranking",
    category: "architecture",
    heading_path: ["Ranking", "Proposal Ranking"],
    body_text: "Ranking body.",
    hints: {
      keywords: ["ranking", "proposal generation"],
      aliases: ["proposal stage"],
      topics: ["project memory pipeline"],
      query_phrases: ["how does Myelin decide what to write"],
    },
  });

  expect(text).toContain("title: Ranking");
  expect(text).toContain("category: architecture");
  expect(text).toContain("heading_path: Ranking > Proposal Ranking");
  expect(text).toContain("section_text: Ranking body.");
  expect(text).toContain("keywords: ranking; proposal generation");
  expect(text.indexOf("section_text")).toBeLessThan(text.indexOf("keywords"));
});
