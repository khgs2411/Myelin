import { expect, test } from "bun:test";
import blocked from "../fixtures/status/blocked.json";
import healthy from "../fixtures/status/healthy.json";
import { renderStatusHuman } from "../../src/status/status-renderer.ts";
import type { ProjectOperationalStatusV1 } from "../../src/status/status-v1.ts";

test("human view renders the same healthy states and counts", () => {
  const output = renderStatusHuman(healthy as ProjectOperationalStatusV1);
  expect(output).toContain(`Myelin status: ${healthy.overall_state}`);
  expect(output).toContain(`Session Memory: ${healthy.session_memory.state}`);
  expect(output).toContain(`${healthy.session_memory.retrieval.indexed_count} indexed`);
  expect(output).toContain(`Project Memory: ${healthy.project_memory.state}`);
});

test("human view preserves blocked warning, action, and evidence facts", () => {
  const output = renderStatusHuman(blocked as ProjectOperationalStatusV1);
  expect(output).toContain(blocked.warnings[0].code);
  expect(output).toContain(blocked.actions[0].command);
  for (const evidence of blocked.evidence) expect(output).toContain(evidence.path);
});
