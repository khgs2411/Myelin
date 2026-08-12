import { expect, test } from "bun:test";
import blocked from "../fixtures/status/blocked.json";
import healthy from "../fixtures/status/healthy.json";
import { unavailableSessionCurrentContinuity } from "../../src/memory/session-current-continuity.ts";
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

test("human view places the additive Session continuity briefing before operational sections", () => {
  const continuity = unavailableSessionCurrentContinuity();
  continuity.state = "ready";
  continuity.reason_codes = [];
  continuity.anchor_job = {
    ingest_job_id: "ingest_anchor",
    latest_memory_created_at: "2026-08-09T10:00:00.000Z",
    job_status: "completed",
    provenance_state: "content_only",
    memory_ids: ["mem_state"],
  };
  continuity.current_state = {
    selection: "latest_eligible_ingest_job",
    selected_ingest_job_id: "ingest_anchor",
    items: [{
      id: "mem_state",
      memory_kind: "continuity",
      title: "Current state",
      summary: "The approved Session Memory reliability slice is in progress.",
      confidence: "high",
      risk: "low",
      created_at: "2026-08-09T10:00:00.000Z",
      updated_at: "2026-08-09T10:00:00.000Z",
      ingest_job_id: "ingest_anchor",
      relation_to_anchor: "anchor_job",
      provenance: {
        state: "content_only",
        source_event_refs: ["tomb_state"],
        content_event_refs: ["tomb_state"],
        control_event_refs: [],
      },
      contexts: [],
    }],
  };
  const status = {
    ...structuredClone(healthy),
    briefing: { contract_version: "myelin.status.briefing.v1", session_continuity: continuity },
  } as ProjectOperationalStatusV1;

  const output = renderStatusHuman(status);
  expect(output).toContain("Session continuity: ready (integrity valid, freshness current)");
  expect(output).toContain("anchor job: ingest_anchor");
  expect(output).toContain("[anchor_job] mem_state — Current state:");
  expect(output.indexOf("Project:")).toBeLessThan(output.indexOf("Session continuity:"));
  expect(output.indexOf("Session continuity:")).toBeLessThan(output.indexOf("Installation:"));
});
