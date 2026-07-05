import { PROJECT_MEMORY_EVIDENCE_MAP_ARTIFACT } from "./project-memory-evidence-map.ts";

export const PROJECT_MEMORY_USEFULNESS_CRITIQUE_CONTRACT_ARTIFACT = "project-memory-usefulness-critique-contract.json" as const;

export function buildProjectMemoryUsefulnessCritiqueSchema(input: { projectKey: string }): Record<string, unknown> {
  return {
    type: "object",
    additionalProperties: false,
    required: [
      "schema_version",
      "project_key",
      "verdict",
      "reasons",
      "weak_sections",
      "evidence_map_ref",
      "rendered_markdown_refs",
    ],
    properties: {
      schema_version: { type: "number", const: 1 },
      project_key: { type: "string", const: input.projectKey },
      verdict: { type: "string", enum: ["pass", "review_only", "fail"] },
      reasons: { type: "array", items: { type: "string" } },
      weak_sections: {
        type: "array",
        items: {
          type: "object",
          additionalProperties: false,
          required: ["page_path", "heading", "reason"],
          properties: {
            page_path: { type: "string" },
            heading: { type: "string" },
            reason: { type: "string" },
          },
        },
      },
      evidence_map_ref: { type: "string", const: PROJECT_MEMORY_EVIDENCE_MAP_ARTIFACT },
      rendered_markdown_refs: { type: "array", items: { type: "string" } },
    },
  };
}
