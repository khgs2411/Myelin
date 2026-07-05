import { expect, test } from "bun:test";
import { PROJECT_MEMORY_EVIDENCE_MAP_ARTIFACT } from "../../src/project/project-memory-evidence-map.ts";
import {
  buildProjectMemoryUsefulnessCritiquePrompt,
  parseProjectMemoryUsefulnessCritique,
  PROJECT_MEMORY_USEFULNESS_CRITIQUE_VERDICTS,
} from "../../src/project/project-memory-usefulness-critique.ts";
import { buildProjectMemoryUsefulnessCritiqueSchema } from "../../src/project/project-memory-usefulness-critique-schema.ts";

test("parses usefulness critique verdicts and rejects blocked", () => {
  const parsed = parseProjectMemoryUsefulnessCritique({
    schema_version: 1,
    project_key: "llm-wiki",
    verdict: "pass",
    reasons: ["answers core questions"],
    weak_sections: [],
    evidence_map_ref: PROJECT_MEMORY_EVIDENCE_MAP_ARTIFACT,
    rendered_markdown_refs: ["index.md"],
  });

  expect(parsed?.verdict).toBe("pass");
  expect(PROJECT_MEMORY_USEFULNESS_CRITIQUE_VERDICTS).not.toContain("blocked" as never);
  expect(parseProjectMemoryUsefulnessCritique({ ...parsed, verdict: "blocked" })).toBeNull();
});

test("builds critique prompt from rendered markdown and evidence map", () => {
  const prompt = buildProjectMemoryUsefulnessCritiquePrompt({
    projectKey: "llm-wiki",
    evidenceMapJson: JSON.stringify({ domains: [{ domain: "storage_retrieval" }] }),
    renderedMarkdown: [
      {
        page_path: "storage.md",
        markdown: "# Storage\n\n## SQLite\n\nstate/memory.db stores indexed memory rows.",
      },
    ],
  });

  expect(prompt).toContain("auditing first-create Project Memory usefulness");
  expect(prompt).toContain("Do not use hidden curator reasoning");
  expect(prompt).toContain("pass, review_only, fail");
  expect(prompt).toContain("Use review_only only for concrete unresolved risks");
  expect(prompt).toContain("Do not return review_only merely because a cited current-state or roadmap claim could drift later");
  expect(prompt).toContain("Use pass when the rendered docs are repo-specific");
  expect(prompt).toContain("storage_retrieval");
  expect(prompt).toContain("--- storage.md ---");
  expect(prompt).toContain("state/memory.db");
});

test("critique structured-output schema is provider-safe and excludes blocked", () => {
  const schema = buildProjectMemoryUsefulnessCritiqueSchema({ projectKey: "llm-wiki" }) as Record<string, any>;

  expect(schema).toMatchObject({
    type: "object",
    additionalProperties: false,
    properties: {
      project_key: { type: "string", const: "llm-wiki" },
      verdict: { type: "string", enum: ["pass", "review_only", "fail"] },
    },
  });
  expect(JSON.stringify(schema)).not.toContain("blocked");
  expect(schema.properties.evidence_map_ref.const).toBe(PROJECT_MEMORY_EVIDENCE_MAP_ARTIFACT);
});
