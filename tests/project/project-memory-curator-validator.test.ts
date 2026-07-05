import { expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ProjectMemoryEvidenceMap } from "../../src/project/project-memory-evidence-map.ts";
import type { ProjectMemoryPacket } from "../../src/project/project-memory-packet.ts";
import type { ProjectMemoryAnswerDomain } from "../../src/project/project-memory-quality-contract.ts";
import { validateCuratorOutput } from "../../src/project/project-memory-curator-validator.ts";

test("rejects wrong project key as a global hard error", () => {
  const result = validateCuratorOutput(packet("maintain"), {
    schema_version: 1,
    project_key: "other",
    mode: "maintain",
    packet_ref: packetRef(),
    packet_context: packetContext(),
    summary: "wrong project",
    quality_diagnostics: qualityDiagnostics("maintain"),
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
    quality_diagnostics: qualityDiagnostics("maintain"),
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
    quality_diagnostics: qualityDiagnostics("maintain"),
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
    quality_diagnostics: qualityDiagnostics("maintain"),
    items: [
      maintenanceItem({
        id: "item_risky",
        operation: "MARK_DISPUTED",
        target_entry_id: "setup.cli",
        proposed_entry_id: undefined,
        content_intent: "Mark disputed due to conflicting evidence.",
        repo_citations: [],
        inference: {
          label: "conflicting_source_evidence",
          why_direct_repo_evidence_is_unavailable: "The dispute is about packet evidence rather than a repo claim.",
        },
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
    quality_diagnostics: qualityDiagnostics("create"),
    documentation_contract: documentationContract(),
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
        answer_domains: ["product_memory_model"],
        required_topics: ["Overview", "Details"],
        representative_questions: ["What is Project Memory in Myelin?"],
        content_intent: "Write state",
        apply_payload: {
          schema_version: 1,
          pages: [
            {
              page_path: "../state/project.json",
              title: "Unsafe",
              purpose: "Unsafe",
              sections: pageSections("product_memory_model"),
              evidence_refs: [{ kind: "project_state", ref: "bootstrap_state" }],
              repo_citations: [repoCitation()],
              inference: {
                label: "unsafe",
                why_direct_repo_evidence_is_unavailable: "Unsafe test fixture.",
              },
            },
          ],
        },
        inspected_surface_refs: ["README.md"],
        evidence_refs: [{ kind: "project_state", ref: "bootstrap_state" }],
        repo_citations: [repoCitation()],
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

test("accepts creation drafts with a full repo-grounded page set", () => {
  const pages = fullCreationPages();
  const result = validateCuratorOutput(packet("create"), creationProposalWithPages(pages), {
    evidenceMap: evidenceMapForPages(pages),
  });

  expect(result.ok).toBe(true);
  expect(result.global_findings).toEqual([]);
});

test("rejects creation drafts that declare answer domains without evidence-map support", () => {
  const pages = fullCreationPages();
  const result = validateCuratorOutput(packet("create"), creationProposalWithPages(pages), {
    evidenceMap: evidenceMapForPages(pages, { missingDomain: "storage_retrieval" }),
  });

  expect(result.ok).toBe(false);
  expect(result.global_findings.map((finding) => finding.code)).toContain(
    "creation_page_answer_domain_missing_evidence_map_support",
  );
  expect(result.quality_diagnostics?.content_quality.status).toBe("shallow");
});

test("rejects old role-shaped creation drafts without answer domains or rendered sections", () => {
  const page = {
    id: "legacy",
    target: { path: "index.md", path_kind: "new_wiki_page" },
    title: "Legacy",
    purpose: "Legacy role-shaped page",
    role: "orientation_index",
    content_intent: "Create legacy page",
    apply_payload: {
      schema_version: 1,
      pages: [
        {
          page_path: "index.md",
          title: "Legacy",
          purpose: "Legacy role-shaped page",
          body: { paragraphs: ["Legacy body-shaped content. ".repeat(20)] },
          evidence_refs: [{ kind: "project_state", ref: "bootstrap_state" }],
          repo_citations: [repoCitation()],
          inference: {
            label: "legacy",
            why_direct_repo_evidence_is_unavailable: "Legacy fixture.",
          },
        },
      ],
    },
    required_sections: ["Overview", "Details"],
    inspected_surface_refs: ["README.md"],
    evidence_refs: [{ kind: "project_state", ref: "bootstrap_state" }],
    repo_citations: [repoCitation()],
    notes_for_apply: [],
  };

  const result = validateCuratorOutput(packet("create"), creationProposalWithPages([page]));

  expect(result.ok).toBe(false);
  expect(result.global_findings.map((finding) => finding.code)).toEqual(
    expect.arrayContaining(["creation_page_answer_domains_required", "apply_payload_page_sections_required"]),
  );
  expect(result.quality_diagnostics?.content_quality.status).toBe("shallow");
});

test("rejects creation draft targets prefixed with the wiki directory", () => {
  const result = validateCuratorOutput(
    packet("create"),
    creationProposalWithPages([creationPage("index.md", "index"), creationPage("wiki/index.md", "wiki_prefixed")]),
  );

  expect(result.ok).toBe(false);
  expect(result.global_findings.map((finding) => finding.code)).toContain("creation_target_path_outside_wiki");
});

test("rejects inference-only creation drafts without direct repo citations", () => {
  const page = creationPage("index.md", "index");
  page.repo_citations = [];
  page.apply_payload.pages[0]!.repo_citations = [];

  const result = validateCuratorOutput(packet("create"), creationProposalWithPages([page]));

  expect(result.ok).toBe(false);
  expect(result.global_findings.map((finding) => finding.code)).toEqual(
    expect.arrayContaining(["creation_page_repo_citation_required", "creation_apply_payload_repo_citation_required"]),
  );
});

test("rejects creation apply payloads that smuggle extra unapplied pages", () => {
  const page = creationPage("index.md", "index");
  page.apply_payload.pages.push({ ...page.apply_payload.pages[0]!, page_path: "runtime.md", title: "Runtime" });

  const result = validateCuratorOutput(packet("create"), creationProposalWithPages([page]));

  expect(result.ok).toBe(false);
  expect(result.global_findings.map((finding) => finding.code)).toContain("apply_payload_page_count_invalid");
});

test("rejects creation drafts with fewer than the required non-index pages", () => {
  const page = creationPage("index.md", "index");

  const result = validateCuratorOutput(packet("create"), creationProposalWithPages([page]));

  expect(result.ok).toBe(false);
  expect(result.global_findings.map((finding) => finding.code)).toContain("creation_publication_minimum_not_met");
});

test("rejects creation drafts missing a required answer domain", () => {
  const pages = fullCreationPages().filter((page) => !page.answer_domains.includes("evidence_provenance_candidates"));

  const result = validateCuratorOutput(packet("create"), creationProposalWithPages(pages));

  expect(result.ok).toBe(false);
  expect(result.quality_diagnostics?.content_quality.status).toBe("shallow");
  expect(result.quality_diagnostics?.content_quality.reasons).toContain(
    "answer domain has no rendered sections: evidence_provenance_candidates",
  );
});

test("rejects creation drafts that do not inspect present default orientation surfaces", async () => {
  const repoRoot = await mkdtemp(join(tmpdir(), "myelin-validator-orientation-"));
  try {
    await mkdir(join(repoRoot, "docs"), { recursive: true });
    await writeFile(join(repoRoot, "AGENTS.md"), "agents\n", "utf8");
    await writeFile(join(repoRoot, "docs", "ROADMAP.md"), "roadmap\n", "utf8");
    const input = packet("create");
    input.project.repo_paths = [repoRoot];

    const result = validateCuratorOutput(
      input,
      creationProposalWithPages(fullCreationPages(), {
        documentation_contract: documentationContract({ inspected_default_surfaces: ["AGENTS.md"] }),
      }),
    );

    expect(result.ok).toBe(false);
    expect(result.quality_diagnostics?.content_quality.status).toBe("shallow");
    expect(result.quality_diagnostics?.content_quality.reasons).toContain(
      "required orientation surface not inspected: docs/ROADMAP.md",
    );
  } finally {
    await rm(repoRoot, { recursive: true, force: true });
  }
});

test("rejects creation drafts that mark an existing default surface as not present", async () => {
  const repoRoot = await mkdtemp(join(tmpdir(), "myelin-validator-orientation-"));
  try {
    await mkdir(join(repoRoot, "docs"), { recursive: true });
    await writeFile(join(repoRoot, "docs", "ROADMAP.md"), "roadmap\n", "utf8");
    const input = packet("create");
    input.project.repo_paths = [repoRoot];

    const result = validateCuratorOutput(
      input,
      creationProposalWithPages(fullCreationPages(), {
        documentation_contract: documentationContract({
          missing_orientation_surfaces: [{ path: "docs/ROADMAP.md", reason: "not_present" }],
        }),
      }),
    );

    expect(result.ok).toBe(false);
    expect(result.quality_diagnostics?.content_quality.status).toBe("shallow");
    expect(result.quality_diagnostics?.content_quality.reasons).toContain(
      "required orientation surface not inspected: docs/ROADMAP.md",
    );
  } finally {
    await rm(repoRoot, { recursive: true, force: true });
  }
});

test("rejects creation drafts that lack a full documentation page set", () => {
  const result = validateCuratorOutput(packet("create"), {
    schema_version: 1,
    project_key: "demo",
    mode: "create",
    packet_ref: packetRef(),
    packet_context: packetContext(),
    summary: "index-only draft",
    quality_diagnostics: qualityDiagnostics("create"),
    documentation_contract: documentationContract(),
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
        answer_domains: ["product_memory_model"],
        required_topics: ["Overview", "Details"],
        representative_questions: ["What is Project Memory in Myelin?"],
        content_intent: "Create index",
        apply_payload: {
          schema_version: 1,
          pages: [
            {
              page_path: "index.md",
              title: "Demo",
              purpose: "Index",
              sections: pageSections("product_memory_model"),
              evidence_refs: [{ kind: "project_state", ref: "bootstrap_state" }],
              repo_citations: [repoCitation()],
              inference: {
                label: "initial_project_memory",
                why_direct_repo_evidence_is_unavailable: "Creation summary is based on project state.",
              },
            },
          ],
        },
        inspected_surface_refs: ["README.md"],
        evidence_refs: [{ kind: "project_state", ref: "bootstrap_state" }],
        repo_citations: [repoCitation()],
        notes_for_apply: [],
      },
    ],
    state_intent: { mark_project_memory_curated: true, freshness_intent: "initialize" },
    evidence_refs: [{ kind: "project_state", ref: "bootstrap_state" }],
    repo_citations: [repoCitation()],
    risk: lowRisk(),
  });

  expect(result.ok).toBe(false);
  expect(result.global_findings.map((finding) => finding.code)).toContain("creation_publication_minimum_not_met");
});

test("blocks curator output when quality diagnostics are missing", () => {
  const result = validateCuratorOutput(packet("maintain"), {
    schema_version: 1,
    project_key: "demo",
    mode: "maintain",
    packet_ref: packetRef(),
    packet_context: packetContext(),
    summary: "missing diagnostics",
    items: [maintenanceItem()],
    noop_inputs: [],
    risk: lowRisk(),
  });

  expect(result.ok).toBe(false);
  expect(result.global_findings.map((finding) => finding.code)).toContain("quality_diagnostics_invalid");
});

test("blocks shallow quality even when maintenance item structure is otherwise eligible", () => {
  const result = validateCuratorOutput(packet("maintain"), {
    ...proposalWithItem({ id: "shallow_item" }),
    quality_diagnostics: qualityDiagnostics("maintain", "shallow"),
  });

  expect(result.ok).toBe(false);
  expect(result.quality_diagnostics?.content_quality.status).toBe("shallow");
  expect(result.global_findings.map((finding) => finding.code)).toContain("content_quality_not_trusted");
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

test("rejects section-first maintenance items with missing or stale section targets", () => {
  const missing = validateCuratorOutput(
    packet("maintain"),
    proposalWithItem({
      id: "missing_section",
      operation: "PATCH_SECTION",
      target: {
        target_kind: "existing_section",
        wiki_path: "setup/index.md",
        section_id: "missing",
        expected_section_hash: "sha256:missing",
        heading_path: ["Missing"],
        ownership_reason: "Missing section target fixture.",
      },
    }),
  );
  const stale = validateCuratorOutput(
    packet("maintain"),
    proposalWithItem({
      id: "stale_section",
      operation: "PATCH_SECTION",
      target: {
        target_kind: "existing_section",
        wiki_path: "setup/index.md",
        section_id: "setup",
        expected_section_hash: "sha256:stale",
        heading_path: ["Setup"],
        ownership_reason: "Stale section target fixture.",
      },
    }),
  );

  expect(missing.rejected_item_ids).toEqual(["missing_section"]);
  expect(missing.item_results[0]?.findings.map((finding) => finding.code)).toContain("section_target_missing");
  expect(stale.rejected_item_ids).toEqual(["stale_section"]);
  expect(stale.item_results[0]?.findings.map((finding) => finding.code)).toContain("section_target_stale_hash");
});

test("rejects section mutations without an expected section hash", () => {
  const missing = validateCuratorOutput(
    packet("maintain"),
    proposalWithItem({
      id: "missing_hash",
      operation: "PATCH_SECTION",
      target: {
        target_kind: "existing_section",
        wiki_path: "setup/index.md",
        section_id: "setup",
        expected_section_hash: undefined,
        heading_path: ["Setup"],
        ownership_reason: "Missing hash fixture.",
      },
    }),
  );
  const nullHash = validateCuratorOutput(
    packet("maintain"),
    proposalWithItem({
      id: "null_hash",
      operation: "PATCH_SECTION",
      target: {
        target_kind: "existing_section",
        wiki_path: "setup/index.md",
        section_id: "setup",
        expected_section_hash: null,
        heading_path: ["Setup"],
        ownership_reason: "Null hash fixture.",
      },
    }),
  );

  expect(missing.rejected_item_ids).toEqual(["missing_hash"]);
  expect(missing.item_results[0]?.findings.map((finding) => finding.code)).toContain("section_target_hash_required");
  expect(nullHash.rejected_item_ids).toEqual(["null_hash"]);
  expect(nullHash.item_results[0]?.findings.map((finding) => finding.code)).toContain("section_target_hash_required");
});

test("rejects section-first operation and target kind mismatches", () => {
  const patchNewPage = validateCuratorOutput(
    packet("maintain"),
    proposalWithItem({
      id: "patch_new_page",
      operation: "PATCH_SECTION",
      target: {
        target_kind: "new_page",
        wiki_path: "new-topic/index.md",
        section_id: "setup",
        expected_section_hash: "sha256:setup",
        heading_path: ["Setup"],
        ownership_reason: "Mismatched target fixture.",
      },
      missing_coverage_diagnostic: "No existing page owns this concept.",
    }),
  );
  const createExisting = validateCuratorOutput(
    packet("maintain"),
    proposalWithItem({
      id: "create_existing",
      operation: "CREATE_SECTION",
      target: {
        target_kind: "existing_section",
        wiki_path: "setup/index.md",
        section_id: "setup",
        expected_section_hash: "sha256:setup",
        heading_path: ["Setup"],
        ownership_reason: "Mismatched target fixture.",
      },
    }),
  );

  expect(patchNewPage.rejected_item_ids).toEqual(["patch_new_page"]);
  expect(patchNewPage.item_results[0]?.findings.map((finding) => finding.code)).toContain("section_target_kind_mismatch");
  expect(createExisting.rejected_item_ids).toEqual(["create_existing"]);
  expect(createExisting.item_results[0]?.findings.map((finding) => finding.code)).toContain("section_target_kind_mismatch");
});

test("accepts valid section-first PATCH_SECTION with matching hash", () => {
  const result = validateCuratorOutput(
    packet("maintain"),
    proposalWithItem({
      id: "valid_patch",
      operation: "PATCH_SECTION",
    }),
  );

  expect(result.ok).toBe(true);
  expect(result.eligible_item_ids).toEqual(["valid_patch"]);
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
    quality_diagnostics: qualityDiagnostics("maintain"),
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

test("requires explicit no-op decision for non-empty fallback lookup packet with zero maintenance items", () => {
  const input = packet("maintain");
  input.lookup.results = [fallbackLookupResult("lookup:cand_1", "cand_1")];
  input.lookup.quality_summary = {
    blocking: false,
    blocking_reasons: [],
    advisory_reasons: ["fallback markdown search"],
    proposal_scoped_result_ids: ["lookup:cand_1"],
  };

  const result = validateCuratorOutput(input, {
    schema_version: 1,
    project_key: "demo",
    mode: "maintain",
    packet_ref: packetRef(),
    packet_context: packetContext(),
    summary: "No items",
    quality_diagnostics: qualityDiagnostics("maintain"),
    items: [],
    noop_inputs: [],
    risk: lowRisk(),
  });

  expect(result.ok).toBe(false);
  expect(result.global_findings.map((finding) => finding.code)).toContain("noop_missing_explicit_decision");
});

test("accepts documented noop inputs for fallback lookup packet with zero maintenance items", () => {
  const input = packet("maintain");
  input.lookup.results = [fallbackLookupResult("lookup:cand_1", "cand_1")];
  input.lookup.quality_summary = {
    blocking: false,
    blocking_reasons: [],
    advisory_reasons: ["fallback markdown search"],
    proposal_scoped_result_ids: ["lookup:cand_1"],
  };

  const result = validateCuratorOutput(input, {
    schema_version: 1,
    project_key: "demo",
    mode: "maintain",
    packet_ref: packetRef(),
    packet_context: packetContext(),
    summary: "No auto-applyable items",
    quality_diagnostics: qualityDiagnostics("maintain"),
    items: [],
    noop_inputs: [
      {
        source_packet_ref: { kind: "project_candidate", ref: "cand_1" },
        reason: "insufficient_evidence",
        notes: "Fallback lookup is insufficient for target selection.",
      },
    ],
    risk: lowRisk(),
  });

  expect(result.ok).toBe(true);
  expect(result.global_findings).toEqual([]);
});

test("rejects documented noop inputs with unknown source refs", () => {
  const input = packet("maintain");
  input.lookup.results = [fallbackLookupResult("lookup:cand_1", "cand_1")];

  const result = validateCuratorOutput(input, {
    schema_version: 1,
    project_key: "demo",
    mode: "maintain",
    packet_ref: packetRef(),
    packet_context: packetContext(),
    summary: "Bad no-op",
    quality_diagnostics: qualityDiagnostics("maintain"),
    items: [],
    noop_inputs: [
      {
        source_packet_ref: { kind: "project_candidate", ref: "missing" },
        reason: "insufficient_evidence",
        notes: "Unknown source.",
      },
    ],
    risk: lowRisk(),
  });

  expect(result.ok).toBe(false);
  expect(result.global_findings.map((finding) => finding.code)).toContain("noop_input_source_ref_invalid");
});

test("requires explicit no-op decision for non-empty fallback lookup packet with zero creation pages", () => {
  const input = packet("create");
  input.lookup.results = [fallbackLookupResult("lookup:cand_1", "cand_1")];
  input.lookup.quality_summary = {
    blocking: false,
    blocking_reasons: [],
    advisory_reasons: ["fallback markdown search"],
    proposal_scoped_result_ids: ["lookup:cand_1"],
  };

  const result = validateCuratorOutput(input, {
    schema_version: 1,
    project_key: "demo",
    mode: "create",
    packet_ref: packetRef(),
    packet_context: packetContext(),
    summary: "No pages",
    quality_diagnostics: qualityDiagnostics("create"),
    documentation_contract: documentationContract(),
    brain_intent: {
      name: "Demo",
      first_brain_summary: "Nothing to write.",
      untrusted_existing_markdown_policy: "ignore",
    },
    pages: [],
    state_intent: {
      mark_project_memory_curated: false,
      freshness_intent: "leave_degraded",
    },
    evidence_refs: [],
    repo_citations: [],
    risk: lowRisk(),
  });

  expect(result.ok).toBe(false);
  expect(result.global_findings.map((finding) => finding.code)).toContain("noop_missing_explicit_decision");
});

test("accepts explicit no-op decision under fallback lookup when checked refs are present", () => {
  const input = packet("maintain");
  input.lookup.results = [fallbackLookupResult("lookup:cand_1", "cand_1")];
  input.lookup.quality_summary = {
    blocking: false,
    blocking_reasons: [],
    advisory_reasons: ["fallback markdown search"],
    proposal_scoped_result_ids: ["lookup:cand_1"],
  };

  const result = validateCuratorOutput(input, {
    schema_version: 1,
    project_key: "demo",
    mode: "maintain",
    packet_ref: packetRef(),
    packet_context: packetContext(),
    summary: "Already covered",
    quality_diagnostics: qualityDiagnostics("maintain"),
    items: [],
    noop_inputs: [],
    explicit_noop_decisions: [explicitNoopDecision("noop_1", "lookup:cand_1")],
    risk: lowRisk(),
  });

  expect(result.ok).toBe(true);
  expect(result.noop_refs).toEqual(["noop_1"]);
});

test("accepts terminal explicit no-op even when fallback lookup keeps maintain quality shallow", () => {
  const input = packet("maintain");
  input.lookup.results = [fallbackLookupResult("lookup:cand_1", "cand_1")];
  input.degraded = true;
  input.degraded_reasons = ["fallback lookup cannot support markdown writes"];

  const result = validateCuratorOutput(input, {
    schema_version: 1,
    project_key: "demo",
    mode: "maintain",
    packet_ref: packetRef(),
    packet_context: packetContext(),
    summary: "Already covered",
    quality_diagnostics: qualityDiagnostics("maintain", "shallow"),
    items: [],
    noop_inputs: [],
    explicit_noop_decisions: [explicitNoopDecision("noop_1", "lookup:cand_1")],
    risk: lowRisk(),
  });

  expect(result.ok).toBe(true);
  expect(result.noop_refs).toEqual(["noop_1"]);
  expect(result.global_findings.map((finding) => finding.code)).not.toContain("content_quality_not_trusted");
});

test("accepts explicit creation no-op decision under fallback lookup when checked refs are present", () => {
  const input = packet("create");
  input.lookup.results = [fallbackLookupResult("lookup:cand_1", "cand_1")];

  const result = validateCuratorOutput(input, {
    schema_version: 1,
    project_key: "demo",
    mode: "create",
    packet_ref: packetRef(),
    packet_context: packetContext(),
    summary: "Already covered",
    quality_diagnostics: qualityDiagnostics("create"),
    documentation_contract: documentationContract(),
    explicit_noop_decisions: [explicitNoopDecision("noop_create_1", "lookup:cand_1")],
    brain_intent: {
      name: "Demo",
      first_brain_summary: "Nothing to write.",
      untrusted_existing_markdown_policy: "ignore",
    },
    pages: [],
    state_intent: {
      mark_project_memory_curated: false,
      freshness_intent: "leave_degraded",
    },
    evidence_refs: [],
    repo_citations: [],
    risk: lowRisk(),
  });

  expect(result.ok).toBe(true);
  expect(result.noop_refs).toEqual(["noop_create_1"]);
});

test("keeps insufficient-evidence explicit no-op reviewable", () => {
  const input = packet("maintain");
  input.lookup.results = [fallbackLookupResult("lookup:cand_1", "cand_1")];
  const output = {
    schema_version: 1,
    project_key: "demo",
    mode: "maintain",
    packet_ref: packetRef(),
    packet_context: packetContext(),
    summary: "No items",
    quality_diagnostics: qualityDiagnostics("maintain"),
    items: [],
    noop_inputs: [],
    explicit_noop_decisions: [{ ...explicitNoopDecision("noop_1", "lookup:cand_1"), reason: "insufficient_evidence" }],
    risk: lowRisk(),
  };

  const result = validateCuratorOutput(input, output);

  expect(result.ok).toBe(false);
  expect(result.global_findings.map((finding) => finding.code)).toContain("noop_insufficient_evidence");
});

test("requires review for maintenance item depending on fallback lookup", () => {
  const input = packet("maintain");
  input.lookup.results = [fallbackLookupResult("lookup:cand_1", "cand_1")];

  const result = validateCuratorOutput(
    input,
    proposalWithItem({
      id: "fallback_dep",
      evidence_dependencies: [{ kind: "lookup_result", ref: "lookup:cand_1", required_for: "dedupe" }],
    }),
  );

  expect(result.quarantined_item_ids).toEqual(["fallback_dep"]);
  expect(result.item_results[0]?.findings.map((finding) => finding.code)).toContain(
    "lookup_dependency_fallback_requires_review",
  );
});

test("rejects item depending on stale lookup result without quarantining unrelated item", () => {
  const input = packet("maintain");
  input.lookup.results = [
    staleLookupResult("lookup:stale", "cand_1"),
    indexedLookupResult("lookup:fresh", "cand_2"),
  ];

  const result = validateCuratorOutput(
    input,
    proposalWithItems([
      maintenanceItem({
        id: "bad",
        evidence_dependencies: [{ kind: "lookup_result", ref: "lookup:stale", required_for: "target_selection" }],
      }),
      maintenanceItem({
        id: "good",
        evidence_dependencies: [{ kind: "lookup_result", ref: "lookup:fresh", required_for: "target_selection" }],
      }),
    ]),
  );

  expect(result.rejected_item_ids).toEqual(["bad"]);
  expect(result.eligible_item_ids).toEqual(["good"]);
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
      sections: [
        {
          project_key: "demo",
          wiki_path: "wiki/setup/index.md",
          category: "setup",
          page_title: "Setup",
          section_id: "setup",
          heading_path: ["Setup"],
          section_hash: "sha256:setup",
          heading_level: 1,
          heading_text: "Setup",
          body_text: "Setup",
          snippet: "Setup",
          start_line: 1,
          end_line: 3,
        },
      ],
    },
    pending: {
      project_handoffs: [],
      project_candidates: [
        {
          id: "cand_1",
          status: "pending",
          priority: "normal",
          producer_kind: "normalized",
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
    lookup: {
      queries: [],
      results: [],
      quality_summary: { blocking: false, blocking_reasons: [], advisory_reasons: [], proposal_scoped_result_ids: [] },
    },
    degraded: false,
    degraded_reasons: [],
  };
}

function lowRisk() {
  return { level: "low" as const, reasons: [], requires_quarantine: false };
}

function repoCitation() {
  return { path: "README.md", line_start: 1, line_end: 5, reason: "Project overview" };
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
    quality_diagnostics: qualityDiagnostics("maintain"),
    items: [maintenanceItem(overrides)],
    noop_inputs: [],
    risk: lowRisk(),
  };
}

function proposalWithItems(items: unknown[]) {
  return {
    schema_version: 1,
    project_key: "demo",
    mode: "maintain",
    packet_ref: packetRef(),
    packet_context: packetContext(),
    summary: "proposal",
    quality_diagnostics: qualityDiagnostics("maintain"),
    items,
    noop_inputs: [],
    risk: lowRisk(),
  };
}

function creationProposalWithPages(pages: unknown[], overrides: Record<string, unknown> = {}) {
  return {
    schema_version: 1,
    project_key: "demo",
    mode: "create",
    packet_ref: packetRef(),
    packet_context: packetContext(),
    summary: "creation proposal",
    quality_diagnostics: qualityDiagnostics("create"),
    documentation_contract: documentationContract(),
    brain_intent: {
      name: "Demo",
      first_brain_summary: "Create first brain",
      untrusted_existing_markdown_policy: "adopt",
    },
    pages,
    state_intent: { mark_project_memory_curated: true, freshness_intent: "initialize" },
    evidence_refs: [{ kind: "project_state", ref: "bootstrap_state" }],
    repo_citations: [],
    risk: lowRisk(),
    ...overrides,
  };
}

function documentationContract(overrides: Record<string, unknown> = {}) {
  return {
    inspected_default_surfaces: [],
    curator_added_surfaces: [],
    missing_orientation_surfaces: [],
    missing_coverage: [],
    shallow_summary_findings: [],
    ...overrides,
  };
}

function qualityDiagnostics(mode: "create" | "maintain", status: "trusted" | "review_only" | "shallow" | "blocked" = "trusted") {
  return {
    schema_version: 1,
    content_quality: { status, reasons: status === "trusted" ? [] : [`${status} fixture`] },
    retrieval_readiness: { status: "not_applicable", reason: null },
    domain_coverage: answerDomainCoverage(),
    candidate_dispositions: [],
    missing_coverage: status === "shallow" ? ["shallow fixture"] : [],
    shallow_summary_findings: [],
    answerability_findings: [],
  };
}

function answerDomainCoverage() {
  return [
    "product_memory_model",
    "storage_retrieval",
    "command_workflows",
    "curation_apply_lifecycle",
    "evidence_provenance_candidates",
    "current_work_roadmap_decisions",
  ].map((domain) => ({
    domain,
    page_refs: [`${domain}.md`],
    section_refs: [`${domain}/overview`],
    representative_questions: [`How does ${domain} work?`],
    citations_seen: 1,
    body_chars_seen: 500,
    missing_topics: [],
  }));
}

function answerDomainForRole(role: string) {
  const map: Record<string, string> = {
    orientation_index: "product_memory_model",
    product_memory_model: "storage_retrieval",
    runtime_workflows: "command_workflows",
    architecture_data_flow: "curation_apply_lifecycle",
    current_work_roadmap: "evidence_provenance_candidates",
    decisions_terms: "current_work_roadmap_decisions",
  };
  return map[role] ?? "product_memory_model";
}

function fullCreationPages() {
  return [
    creationPage("index.md", "index", "orientation_index"),
    creationPage("product.md", "product", "product_memory_model"),
    creationPage("runtime.md", "runtime", "runtime_workflows"),
    creationPage("architecture.md", "architecture", "architecture_data_flow"),
    creationPage("roadmap.md", "roadmap", "current_work_roadmap"),
    creationPage("decisions.md", "decisions", "decisions_terms"),
  ];
}

function evidenceMapForPages(
  pages: Array<ReturnType<typeof creationPage>>,
  options: { missingDomain?: ProjectMemoryAnswerDomain } = {},
): ProjectMemoryEvidenceMap {
  const domains = answerDomainCoverage().map((coverage) => {
    const domain = coverage.domain as ProjectMemoryAnswerDomain;
    const hasSupport = domain !== options.missingDomain && pages.some((page) => page.answer_domains.includes(domain));
    return {
      domain,
      representative_questions: coverage.representative_questions,
      inspected_paths: hasSupport ? [`src/${domain}.ts`] : [],
      search_terms: [domain],
      search_results: hasSupport
        ? [{ path: `src/${domain}.ts`, line: 1, term: domain, excerpt: `evidence for ${domain}` }]
        : [],
      evidence_refs: hasSupport
        ? [{ kind: "repo_path" as const, ref: `src/${domain}.ts:1`, reason: `evidence for ${domain}` }]
        : [],
      missing_evidence: hasSupport ? [] : [`no evidence for ${domain}`],
    };
  });

  return {
    schema_version: 1,
    project_key: "demo",
    packet_ref: "input-packet.json",
    domains,
    leads_considered: [],
    discovery_steps: [{ kind: "bounded_repo_search", detail: "fixture evidence map" }],
    missing_domains: domains.filter((domain) => domain.evidence_refs.length === 0).map((domain) => domain.domain),
  };
}

function creationPage(
  path: string,
  id: string,
  role:
    | "orientation_index"
    | "product_memory_model"
    | "runtime_workflows"
    | "architecture_data_flow"
    | "current_work_roadmap"
    | "decisions_terms" = "orientation_index",
) {
  const answerDomain = answerDomainForRole(role);
  return {
    id,
    target: { path, path_kind: "new_wiki_page" },
    title: "Demo",
    purpose: "Index",
    answer_domains: [answerDomain],
    required_topics: ["Overview", "Details"],
    representative_questions: ["How does the demo project memory work?"],
    content_intent: "Create index",
    apply_payload: {
      schema_version: 1,
      pages: [
        {
          page_path: path,
          title: "Demo",
          purpose: "Index",
          sections: pageSections(answerDomain),
          evidence_refs: [{ kind: "project_state", ref: "bootstrap_state" }],
          repo_citations: [repoCitation()],
          inference: {
            label: "initial_project_memory",
            why_direct_repo_evidence_is_unavailable: "Creation summary is based on project state.",
          },
        },
      ],
    },
    inspected_surface_refs: ["README.md"],
    evidence_refs: [{ kind: "project_state", ref: "bootstrap_state" }],
    repo_citations: [repoCitation()],
    notes_for_apply: [],
  };
}

function pageSections(domain: string) {
  return [
    {
      heading: "Overview",
      level: 2,
      body: { paragraphs: [domainBody(domain, "Overview")] },
      evidence_refs: [{ kind: "project_state", ref: "bootstrap_state" }],
      repo_citations: [repoCitation()],
      inference: {
        label: "initial_project_memory",
        why_direct_repo_evidence_is_unavailable: "Creation summary is based on project state.",
      },
    },
    {
      heading: "Details",
      level: 2,
      body: { paragraphs: [domainBody(domain, "Details")] },
      evidence_refs: [{ kind: "project_state", ref: "bootstrap_state" }],
      repo_citations: [repoCitation()],
      inference: {
        label: "initial_project_memory",
        why_direct_repo_evidence_is_unavailable: "Creation summary is based on project state.",
      },
    },
  ];
}

function domainBody(domain: string, label: "Overview" | "Details"): string {
  return [
    `${label} for ${domain} explains how Myelin turns Project Memory into living repo documentation with cited markdown pages.`,
    `The ${domain} section distinguishes Session Memory continuity from curated Project Memory truth so candidates stay leads until repo evidence supports them.`,
    `For ${domain}, state/memory.db, sqlite, session_memories, embeddings, and derived markdown retrieval rows are named as separate storage and serving concepts.`,
    `The ${domain} workflow names project learn, memory query, memory index session, memory index project, memory inbox create, and memory inbox intake as operator surfaces.`,
    `The ${domain} lifecycle describes curator output, deterministic validation, apply journals, project-memory-changeset.json, retrieval sections, hint generation, and canonical markdown writes.`,
    `The ${domain} evidence trail points future agents to ROADMAP, ADR decisions, source files, and tests instead of letting generic prose stand in for documentation.`,
  ].join(" ");
}

function maintenanceItem(overrides: Record<string, unknown> = {}) {
  const operation = (overrides.operation as string | undefined) ?? "CREATE_ENTRY";
  const sectionFirst = ["PATCH_SECTION", "CREATE_SECTION", "CREATE_PAGE", "ATTACH_EVIDENCE", "MARK_STALE", "MARK_DISPUTED", "NOOP"].includes(operation);
  const targetEntryId = operation === "CREATE_ENTRY" ? undefined : "setup.cli";
  const proposedEntryId = operation === "CREATE_ENTRY" ? "setup.cli" : undefined;
  return {
    id: "item_1",
    operation,
    target: {
      target_kind: "existing_section",
      wiki_path: "setup/index.md",
      section_id: "setup",
      expected_section_hash: "sha256:setup",
      heading_path: ["Setup"],
      ownership_reason: "Setup section owns CLI setup memory.",
    },
    candidate_priority: "normal",
    candidate_disposition: "applied_to_project_memory",
    target_page: { path: "setup/index.md", path_kind: "existing_wiki_page" },
    target_entry_id: targetEntryId,
    proposed_entry_id: proposedEntryId,
    content_intent: "Document CLI setup command.",
    apply_payload: sectionFirst ? {
      schema_version: 1,
      entries: [],
      section: {
        heading: "Setup",
        level: 1,
        body: { paragraphs: ["Document CLI setup command."] },
        evidence_refs: [{ kind: "project_candidate", ref: "cand_1" }],
        repo_citations: [
          { path: "src/commands/project.ts", line_start: 1, line_end: 20, reason: "CLI command registration" },
        ],
      },
      page: null,
    } : {
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

function explicitNoopDecision(id: string, lookupRef: string) {
  return {
    id,
    source_packet_refs: [{ kind: "project_candidate", ref: "cand_1", required_for: "noop_support" }],
    checked_existing_memory_refs: [{ kind: "lookup_result", ref: lookupRef, required_for: "noop_support" }],
    reason: "already_trusted",
    explanation: "Existing memory covers the candidate.",
  };
}

function fallbackLookupResult(id: string, sourceId: string) {
  return {
    id,
    query: "ranking",
    source_kind: "project_candidate" as const,
    source_id: sourceId,
    retrieval_method: "fallback_markdown_search" as const,
    lookup_quality: "fallback" as const,
    lookup_freshness: "not_applicable" as const,
    apply_severity: "proposal_scoped" as const,
    degraded_reason: "fallback markdown search",
    hits: [],
    source_tools: ["project-memory-markdown-scan"],
  };
}

function staleLookupResult(id: string, sourceId: string) {
  return {
    ...fallbackLookupResult(id, sourceId),
    retrieval_method: "indexed_section_retrieval" as const,
    lookup_quality: "indexed" as const,
    lookup_freshness: "stale" as const,
    apply_severity: "proposal_scoped" as const,
    degraded_reason: "stale lookup result",
  };
}

function indexedLookupResult(id: string, sourceId: string) {
  return {
    ...fallbackLookupResult(id, sourceId),
    retrieval_method: "indexed_section_retrieval" as const,
    lookup_quality: "indexed" as const,
    lookup_freshness: "fresh" as const,
    apply_severity: "advisory" as const,
    degraded_reason: undefined,
  };
}
