import { expect, test } from "bun:test";
import { aggregateOverall, maxState, warning } from "../../src/status/severity.ts";

test("overall aggregation is deterministic", () => {
  expect(aggregateOverall(["healthy", "attention", "healthy"])).toBe("attention");
  expect(aggregateOverall(["attention", "blocked"])).toBe("blocked");
  expect(maxState("healthy", "healthy")).toBe("healthy");
});

test("warnings keep stable structured fields", () => {
  expect(warning("SESSION_QUEUE_UNOWNED", "attention", "session_memory", "Queue needs an owner.", ["e1"])).toEqual({
    code: "SESSION_QUEUE_UNOWNED", severity: "attention", section: "session_memory", message: "Queue needs an owner.", evidence_ids: ["e1"],
  });
});
