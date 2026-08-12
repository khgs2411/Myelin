import { describe, expect, test } from "bun:test";
import {
  priorityForProjectMemoryLead,
  producerKindForLead,
  producerKindForSourceRef,
} from "../../src/project/project-memory-producer-boundary.ts";

describe("Project Memory producer boundary", () => {
  test("weights project candidates above session context during maintenance", () => {
    expect(priorityForProjectMemoryLead({ source_kind: "project_candidate", confidence: "high", risk: "low" })).toBe("high");
    expect(priorityForProjectMemoryLead({ source_kind: "session_memory", confidence: "high", risk: "low" })).toBe("normal");
  });

  test("high risk lowers lead priority without granting write authority", () => {
    expect(priorityForProjectMemoryLead({ source_kind: "project_handoff", confidence: "high", risk: "high" })).toBe("low");
  });

  test("derives producer kind as diagnostic metadata only", () => {
    expect(producerKindForSourceRef("project_inbox:demo:item_1")).toBe("runtime_inbox");
    expect(producerKindForSourceRef("inbox:item_1")).toBe("runtime_inbox");
    expect(producerKindForSourceRef("session_memory:mem_1")).toBe("session_memory");
    expect(producerKindForSourceRef("cand_1")).toBe("normalized");
  });

  test("uses source event refs when lead id is already normalized", () => {
    expect(producerKindForLead({ id: "project_inbox:demo:item_1", source_event_refs: ["inbox:item_1"] })).toBe(
      "runtime_inbox",
    );
    expect(producerKindForLead({ id: "handoff_1", source_event_refs: ["session_memory:mem_1"] })).toBe(
      "session_memory",
    );
  });
});
