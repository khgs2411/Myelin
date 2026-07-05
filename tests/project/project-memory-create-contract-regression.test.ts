import { expect, test } from "bun:test";
import type { ProjectMemoryPacket } from "../../src/project/project-memory-packet.ts";
import { validateCuratorOutput } from "../../src/project/project-memory-curator-validator.ts";

test("rejects June 30 style role-shaped create output as shallow", () => {
  const result = validateCuratorOutput(packetFixtureForCreate(), oldRoleShapedCreateOutput());

  expect(result.ok).toBe(false);
  expect(result.quality_diagnostics?.content_quality.status).not.toBe("trusted");
  expect(result.global_findings.map((finding) => finding.code)).toEqual(
    expect.arrayContaining(["creation_page_answer_domains_required", "apply_payload_page_sections_required"]),
  );
});

function oldRoleShapedCreateOutput() {
  return {
    schema_version: 1,
    project_key: "llm-wiki",
    mode: "create",
    packet_ref: {
      run_dir: "projects/llm-wiki/runs/project-learn/test-run",
      artifact: "input-packet.json",
      packet_schema_version: 1,
    },
    packet_context: { degraded: false, degraded_reasons: [], budgets: { max_items: null, max_content_chars: null } },
    summary: "Creates role pages.",
    explicit_noop_decisions: [],
    quality_diagnostics: trustedButOldRoleDiagnostics(),
    documentation_contract: validDocumentationContract(),
    brain_intent: {
      name: "llm-wiki",
      first_brain_summary: "Project Memory",
      untrusted_existing_markdown_policy: "rewrite",
    },
    pages: ["index", "product", "runtime", "architecture"].map((id) => oldRolePage(id)),
    state_intent: { mark_project_memory_curated: true, freshness_intent: "initialize" },
    evidence_refs: [{ kind: "repo_citation", ref: "docs/ROADMAP.md" }],
    repo_citations: [{ path: "docs/ROADMAP.md", line_start: 1, line_end: 20, reason: "roadmap" }],
    risk: { level: "low", reasons: [], requires_quarantine: false },
  };
}

function oldRolePage(id: string) {
  return {
    id,
    target: { path: `${id}.md`, path_kind: "new_wiki_page" },
    title: id,
    purpose: "Role-shaped page",
    role: "product_memory_model",
    content_intent: "Create role page",
    apply_payload: {
      schema_version: 1,
      pages: [
        {
          page_path: `${id}.md`,
          title: id,
          purpose: "Role-shaped page",
          body: { paragraphs: ["Generic project memory overview. ".repeat(20)] },
          evidence_refs: [{ kind: "repo_citation", ref: "docs/ROADMAP.md" }],
          repo_citations: [{ path: "docs/ROADMAP.md", line_start: 1, line_end: 20, reason: "roadmap" }],
          inference: null,
        },
      ],
    },
    required_sections: ["Overview", "Details"],
    inspected_surface_refs: ["docs/ROADMAP.md"],
    evidence_refs: [{ kind: "repo_citation", ref: "docs/ROADMAP.md" }],
    repo_citations: [{ path: "docs/ROADMAP.md", line_start: 1, line_end: 20, reason: "roadmap" }],
    notes_for_apply: [],
  };
}

function trustedButOldRoleDiagnostics() {
  return {
    schema_version: 1,
    content_quality: { status: "trusted", reasons: [] },
    retrieval_readiness: { status: "not_applicable", reason: null },
    domain_coverage: [],
    role_coverage: [],
    candidate_dispositions: [],
    missing_coverage: [],
    shallow_summary_findings: [],
    answerability_findings: [],
  };
}

function validDocumentationContract() {
  return {
    inspected_default_surfaces: [],
    curator_added_surfaces: [],
    missing_orientation_surfaces: [],
    missing_coverage: [],
    shallow_summary_findings: [],
  };
}

function packetFixtureForCreate(): ProjectMemoryPacket {
  return {
    schema_version: 1,
    project_key: "llm-wiki",
    mode: "create",
    project: { key: "llm-wiki", name: "llm-wiki", lifecycle: "active", repo_paths: ["/repo/llm-wiki"] },
    state: { bootstrap_state: { status: "uncurated" }, project_memory: null, freshness: null, pages_manifest: null },
    wiki: { page_count: 0, pages: [], sections: [] },
    pending: { project_handoffs: [], project_candidates: [] },
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
