import { expect, test } from "bun:test";
import { PROJECT_MEMORY_BEHAVIOR_COVERAGE_GUIDANCE } from "../../src/project/project-memory-authoring-guidance.ts";

test("requires complete behavior-policy outcomes and current regression evidence", () => {
  const guidance = PROJECT_MEMORY_BEHAVIOR_COVERAGE_GUIDANCE.join("\n");

  expect(guidance).toContain("every currently supported value");
  expect(guidance).toContain("membership, approval");
  expect(guidance).toContain("current implementation and regression-test evidence");
  expect(guidance).toContain("known_gaps");
});
