import { expect, test } from "bun:test";
import {
  assertMaintenanceReport,
  type ProjectMemoryMaintenancePendingSource,
} from "../../src/project/project-memory-agent-maintenance-service.ts";

test("rejects duplicate dispositions for the same pending source", () => {
  const pending: ProjectMemoryMaintenancePendingSource[] = [{
    source_kind: "project_candidate",
    source_ref: "candidate-1",
    summary: "Candidate summary",
  }];
  const disposition = {
    source_kind: "project_candidate" as const,
    source_ref: "candidate-1",
    disposition: "already_covered" as const,
    reason: "Existing documentation covers it.",
    output_refs: ["wiki/runtime.md"],
  };

  expect(() => assertMaintenanceReport("demo", pending, {
    schema_version: 1,
    project_key: "demo",
    status: "completed",
    dispositions: [disposition, disposition],
    touched_paths: [],
    evidence_paths: [],
    known_gaps: [],
  })).toThrow("duplicate disposition for source: project_candidate:candidate-1");
});
