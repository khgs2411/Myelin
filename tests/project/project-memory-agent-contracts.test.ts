import { describe, expect, test } from "bun:test";
import {
  PROJECT_MEMORY_AGENT_CANDIDATE_DISPOSITIONS,
  isProjectMemoryAgentCandidateDisposition,
  normalizeProjectMemoryAgentCandidateDisposition,
} from "../../src/project/project-memory-agent-contracts.ts";

describe("project memory agent contracts", () => {
  test("defines the maintenance disposition vocabulary", () => {
    expect([...PROJECT_MEMORY_AGENT_CANDIDATE_DISPOSITIONS]).toEqual([
      "applied_to_project_memory",
      "already_covered",
      "insufficient_evidence",
      "not_durable",
      "belongs_to_other_layer",
      "deferred_unsafe_change",
      "blocked_by_runner_failure",
    ]);
  });

  test("normalizes legacy already_trusted as already_covered", () => {
    expect(normalizeProjectMemoryAgentCandidateDisposition("already_trusted")).toBe("already_covered");
    expect(normalizeProjectMemoryAgentCandidateDisposition("blocked_by_quality")).toBeNull();
    expect(isProjectMemoryAgentCandidateDisposition("already_covered")).toBe(true);
  });
});
