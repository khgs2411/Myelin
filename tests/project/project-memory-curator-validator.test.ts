import { expect, test } from "bun:test";
import type { ProjectMemoryPacket } from "../../src/project/project-memory-packet.ts";
import { validateCuratorOutput } from "../../src/project/project-memory-curator-validator.ts";

test("rejects wrong project key as a global hard error", () => {
  const result = validateCuratorOutput(packet("maintain"), {
    schema_version: 1,
    project_key: "other",
    mode: "maintain",
    packet_ref: packetRef(),
    packet_context: packetContext(),
    summary: "wrong project",
    items: [],
    noop_inputs: [],
    risk: lowRisk(),
  });

  expect(result.ok).toBe(false);
  expect(result.global_findings.map((finding) => finding.code)).toContain("project_key_mismatch");
});

test("eligible maintenance item requires packet refs, evidence, and safe wiki path", () => {
  const result = validateCuratorOutput(packet("maintain"), {
    schema_version: 1,
    project_key: "demo",
    mode: "maintain",
    packet_ref: packetRef(),
    packet_context: packetContext(),
    summary: "one update",
    items: [maintenanceItem()],
    noop_inputs: [],
    risk: lowRisk(),
  });

  expect(result.ok).toBe(true);
  expect(result.eligible_item_ids).toEqual(["item_1"]);
  expect(result.rejected_item_ids).toEqual([]);
});

test("rejects maintenance items with unknown packet references or out-of-wiki paths", () => {
  const result = validateCuratorOutput(packet("maintain"), {
    schema_version: 1,
    project_key: "demo",
    mode: "maintain",
    packet_ref: packetRef(),
    packet_context: packetContext(),
    summary: "bad item",
    items: [
      maintenanceItem({
        id: "item_bad",
        operation: "PATCH_ENTRY",
        target_page: { path: "../state/project.json", path_kind: "existing_wiki_page" },
        target_entry_id: "setup.cli",
        proposed_entry_id: undefined,
        content_intent: "Patch outside wiki.",
        source_packet_refs: [{ kind: "project_candidate", ref: "missing" }],
        evidence_refs: [],
        repo_citations: [],
        expected_outcome: "rejected",
      }),
    ],
    noop_inputs: [],
    risk: lowRisk(),
  });

  expect(result.ok).toBe(false);
  expect(result.rejected_item_ids).toEqual(["item_bad"]);
  expect(result.item_results[0]?.findings.map((finding) => finding.code)).toEqual(
    expect.arrayContaining(["target_path_outside_wiki", "unknown_source_packet_ref", "missing_evidence_refs"]),
  );
});

test("quarantines high-risk maintenance items instead of marking them eligible", () => {
  const result = validateCuratorOutput(packet("maintain"), {
    schema_version: 1,
    project_key: "demo",
    mode: "maintain",
    packet_ref: packetRef(),
    packet_context: packetContext(),
    summary: "risky item",
    items: [
      maintenanceItem({
        id: "item_risky",
        operation: "MARK_DISPUTED",
        target_entry_id: "setup.cli",
        proposed_entry_id: undefined,
        content_intent: "Mark disputed due to conflicting evidence.",
        repo_citations: [],
        applicability: {},
        lifecycle_intent: "disputed",
        risk: { level: "high", reasons: ["conflicting evidence"], requires_quarantine: true },
        expected_outcome: "quarantine",
      }),
    ],
    noop_inputs: [],
    risk: lowRisk(),
  });

  expect(result.ok).toBe(false);
  expect(result.quarantined_item_ids).toEqual(["item_risky"]);
});

test("rejects creation drafts with unsafe page targets or protected state assignment", () => {
  const result = validateCuratorOutput(packet("create"), {
    schema_version: 1,
    project_key: "demo",
    mode: "create",
    packet_ref: packetRef(),
    packet_context: packetContext(),
    summary: "unsafe draft",
    brain_intent: {
      name: "Demo",
      first_brain_summary: "Create first brain",
      untrusted_existing_markdown_policy: "adopt",
    },
    pages: [
      {
        id: "unsafe",
        target: { path: "../state/project.json", path_kind: "project_state" },
        title: "Unsafe",
        purpose: "Unsafe",
        content_intent: "Write state",
        apply_payload: {
          schema_version: 1,
          pages: [
            {
              page_path: "../state/project.json",
              title: "Unsafe",
              purpose: "Unsafe",
              body: { paragraphs: ["Unsafe."] },
              evidence_refs: [{ kind: "project_state", ref: "bootstrap_state" }],
              repo_citations: [],
              inference: {
                label: "unsafe",
                why_direct_repo_evidence_is_unavailable: "Unsafe test fixture.",
              },
            },
          ],
        },
        required_sections: [],
        evidence_refs: [{ kind: "project_state", ref: "bootstrap_state" }],
        repo_citations: [],
        notes_for_apply: [],
      },
    ],
    state_intent: { mark_project_memory_curated: true, freshness_intent: "initialize", owner: "curator" },
    evidence_refs: [{ kind: "project_state", ref: "bootstrap_state" }],
    repo_citations: [],
    risk: lowRisk(),
  });

  expect(result.ok).toBe(false);
  expect(result.global_findings.map((finding) => finding.code)).toEqual(
    expect.arrayContaining(["creation_target_path_outside_wiki", "protected_state_assignment"]),
  );
});

test("accepts creation drafts with index and explicit no-domain-pages rationale", () => {
  const result = validateCuratorOutput(packet("create"), {
    schema_version: 1,
    project_key: "demo",
    mode: "create",
    packet_ref: packetRef(),
    packet_context: packetContext(),
    summary: "index-only draft",
    brain_intent: {
      name: "Demo",
      first_brain_summary: "Create first brain",
      untrusted_existing_markdown_policy: "adopt",
    },
    pages: [
      {
        id: "index",
        target: { path: "index.md", path_kind: "new_wiki_page" },
        title: "Demo",
        purpose: "Index",
        content_intent: "Create index",
        apply_payload: {
          schema_version: 1,
          pages: [
            {
              page_path: "index.md",
              title: "Demo",
              purpose: "Index",
              body: { paragraphs: ["Demo index."] },
              evidence_refs: [{ kind: "project_state", ref: "bootstrap_state" }],
              repo_citations: [],
              inference: {
                label: "initial_project_memory",
                why_direct_repo_evidence_is_unavailable: "Creation summary is based on project state.",
              },
            },
          ],
        },
        required_sections: ["Overview"],
        evidence_refs: [{ kind: "project_state", ref: "bootstrap_state" }],
        repo_citations: [],
        notes_for_apply: ["no-domain-pages: nothing durable beyond the index yet"],
      },
    ],
    state_intent: { mark_project_memory_curated: true, freshness_intent: "initialize" },
    evidence_refs: [{ kind: "project_state", ref: "bootstrap_state" }],
    repo_citations: [],
    risk: lowRisk(),
  });

  expect(result.ok).toBe(true);
  expect(result.global_findings).toEqual([]);
});

test("rejects creation drafts that lack index plus domain page or rationale", () => {
  const result = validateCuratorOutput(packet("create"), {
    schema_version: 1,
    project_key: "demo",
    mode: "create",
    packet_ref: packetRef(),
    packet_context: packetContext(),
    summary: "index-only draft",
    brain_intent: {
      name: "Demo",
      first_brain_summary: "Create first brain",
      untrusted_existing_markdown_policy: "adopt",
    },
    pages: [
      {
        id: "index",
        target: { path: "index.md", path_kind: "new_wiki_page" },
        title: "Demo",
        purpose: "Index",
        content_intent: "Create index",
        apply_payload: {
          schema_version: 1,
          pages: [
            {
              page_path: "index.md",
              title: "Demo",
              purpose: "Index",
              body: { paragraphs: ["Demo index."] },
              evidence_refs: [{ kind: "project_state", ref: "bootstrap_state" }],
              repo_citations: [],
              inference: {
                label: "initial_project_memory",
                why_direct_repo_evidence_is_unavailable: "Creation summary is based on project state.",
              },
            },
          ],
        },
        required_sections: ["Overview"],
        evidence_refs: [{ kind: "project_state", ref: "bootstrap_state" }],
        repo_citations: [],
        notes_for_apply: [],
      },
    ],
    state_intent: { mark_project_memory_curated: true, freshness_intent: "initialize" },
    evidence_refs: [{ kind: "project_state", ref: "bootstrap_state" }],
    repo_citations: [],
    risk: lowRisk(),
  });

  expect(result.ok).toBe(false);
  expect(result.global_findings.map((finding) => finding.code)).toContain("creation_publication_minimum_not_met");
});

test("rejects existing-page maintenance operations when the page is absent from the packet", () => {
  const result = validateCuratorOutput(
    packet("maintain"),
    proposalWithItem({
      id: "missing_page",
      operation: "PATCH_ENTRY",
      target_page: { path: "missing/index.md", path_kind: "existing_wiki_page" },
      target_entry_id: "setup.cli",
      proposed_entry_id: undefined,
    }),
  );

  expect(result.rejected_item_ids).toEqual(["missing_page"]);
  expect(result.item_results[0]?.findings.map((finding) => finding.code)).toContain("target_page_missing");
});

test("rejects maintenance items that request a new wiki page target", () => {
  const result = validateCuratorOutput(
    packet("maintain"),
    proposalWithItem({
      id: "new_page",
      target_page: { path: "new-topic/index.md", path_kind: "new_wiki_page" },
    }),
  );

  expect(result.ok).toBe(false);
  expect(result.rejected_item_ids).toEqual(["new_page"]);
  expect(result.item_results[0]?.findings).toContainEqual(
    expect.objectContaining({
      category: "path",
      code: "unsupported_maintenance_target_kind",
    }),
  );
});

test("rejects unsupported broad operations and illegal lifecycle transitions", () => {
  const result = validateCuratorOutput(
    packet("maintain"),
    proposalWithItem({
      id: "broad",
      operation: "DELETE_PAGE",
      lifecycle_intent: "active",
    }),
  );

  expect(result.rejected_item_ids).toEqual(["broad"]);
  expect(result.item_results[0]?.findings.map((finding) => finding.code)).toEqual(
    expect.arrayContaining(["unknown_operation", "illegal_lifecycle_transition"]),
  );
});

test("rejects repo-groundable command claims without repo citation or inference explanation", () => {
  const result = validateCuratorOutput(
    packet("maintain"),
    proposalWithItem({
      id: "no_repo_citation",
      content_intent: "Document command myelin project learn demo behavior.",
      repo_citations: [],
      inference: undefined,
    }),
  );

  expect(result.rejected_item_ids).toEqual(["no_repo_citation"]);
  expect(result.item_results[0]?.findings.map((finding) => finding.code)).toContain("missing_repo_citation");
});

test("quarantines otherwise valid maintenance items when packet state is degraded", () => {
  const degraded = packet("maintain");
  degraded.degraded = true;
  degraded.degraded_reasons = ["lookup degraded"];

  const result = validateCuratorOutput(degraded, proposalWithItem({ id: "degraded_item" }));

  expect(result.ok).toBe(false);
  expect(result.quarantined_item_ids).toEqual(["degraded_item"]);
  expect(result.item_results[0]?.findings.map((finding) => finding.code)).toContain("packet_degraded");
});

test("rejects proposals that exceed item or content budgets", () => {
  const manyItems = Array.from({ length: 26 }, (_, index) => maintenanceItem({ id: `item_${index}` }));
  const itemBudget = validateCuratorOutput(packet("maintain"), {
    schema_version: 1,
    project_key: "demo",
    mode: "maintain",
    packet_ref: packetRef(),
    packet_context: packetContext(),
    summary: "too many",
    items: manyItems,
    noop_inputs: [],
    risk: lowRisk(),
  });

  const contentBudget = validateCuratorOutput(
    packet("maintain"),
    proposalWithItem({ id: "too_large", content_intent: "x".repeat(4_001) }),
  );

  expect(itemBudget.ok).toBe(false);
  expect(itemBudget.global_findings.map((finding) => finding.code)).toContain("proposal_item_budget_exceeded");
  expect(contentBudget.rejected_item_ids).toEqual(["too_large"]);
  expect(contentBudget.item_results[0]?.findings.map((finding) => finding.code)).toContain("item_content_budget_exceeded");
});

function packet(mode: "create" | "maintain"): ProjectMemoryPacket {
  return {
    schema_version: 1,
    project_key: "demo",
    mode,
    project: { key: "demo", name: "Demo", lifecycle: "active", repo_paths: ["/repo/demo"] },
    state: {
      bootstrap_state: { status: mode === "create" ? "uncurated" : "curated" },
      project_memory: mode === "maintain" ? { status: "curated" } : null,
      freshness: null,
      pages_manifest: null,
    },
    wiki: {
      page_count: 1,
      pages: [{ path: "wiki/setup/index.md", title: "Setup", headings: [], snippet: "Setup", size_bytes: 5 }],
    },
    pending: {
      project_handoffs: [],
      project_candidates: [
        {
          id: "cand_1",
          status: "pending",
          candidate_type: "project.setup",
          title: "Setup",
          summary: "Document setup.",
          source_event_refs: ["evt_1"],
          confidence: "medium",
          risk: "low",
          reason: "durable",
        },
      ],
    },
    session_memory: { selected: [] },
    lookup: { queries: [], results: [] },
    degraded: false,
    degraded_reasons: [],
  };
}

function lowRisk() {
  return { level: "low" as const, reasons: [], requires_quarantine: false };
}

function packetRef() {
  return { run_dir: "projects/demo/runs/project-learn/run", artifact: "input-packet.json" as const, packet_schema_version: 1 as const };
}

function packetContext() {
  return { degraded: false, degraded_reasons: [], budgets: { max_items: 25, max_content_chars: 4_000 } };
}

function proposalWithItem(overrides: Record<string, unknown>) {
  return {
    schema_version: 1,
    project_key: "demo",
    mode: "maintain",
    packet_ref: packetRef(),
    packet_context: packetContext(),
    summary: "proposal",
    items: [maintenanceItem(overrides)],
    noop_inputs: [],
    risk: lowRisk(),
  };
}

function maintenanceItem(overrides: Record<string, unknown> = {}) {
  const operation = (overrides.operation as string | undefined) ?? "CREATE_ENTRY";
  const targetEntryId = operation === "CREATE_ENTRY" ? undefined : "setup.cli";
  const proposedEntryId = operation === "CREATE_ENTRY" ? "setup.cli" : undefined;
  return {
    id: "item_1",
    operation,
    target_page: { path: "setup/index.md", path_kind: "existing_wiki_page" },
    target_entry_id: targetEntryId,
    proposed_entry_id: proposedEntryId,
    content_intent: "Document CLI setup command.",
    apply_payload: {
      schema_version: 1,
      entries: [
        {
          entry_id: targetEntryId ?? proposedEntryId,
          title: "Setup CLI",
          body: { paragraphs: ["Document CLI setup command."] },
          lifecycle: "active",
          evidence_refs: [{ kind: "project_candidate", ref: "cand_1" }],
          repo_citations: [
            { path: "src/commands/project.ts", line_start: 1, line_end: 20, reason: "CLI command registration" },
          ],
        },
      ],
    },
    source_packet_refs: [{ kind: "project_candidate", ref: "cand_1" }],
    evidence_refs: [{ kind: "project_candidate", ref: "cand_1" }],
    repo_citations: [
      { path: "src/commands/project.ts", line_start: 1, line_end: 20, reason: "CLI command registration" },
    ],
    applicability: { commands: ["myelin project learn demo"] },
    lifecycle_intent: "active",
    risk: lowRisk(),
    preconditions: ["setup page exists"],
    expected_outcome: "setup page receives a sourced entry in a later apply slice",
    ...overrides,
  };
}
