import { afterEach, beforeEach, expect, test } from "bun:test";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openMemoryDb } from "../../src/memory/db.ts";
import { ProjectService } from "../../src/project/project-service.ts";
import { writeJson } from "../../src/runtime/json.ts";

let root: string;

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "myelin-project-service-"));
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

test("project service owns layout migration workflow", async () => {
  await mkdir(join(root, "projects", "demo"), { recursive: true });
  await writeFile(join(root, "projects", "demo", "index.md"), "# Demo\n", "utf8");
  const service = new ProjectService(root);

  const result = await service.migrateLayout("demo");

  expect(result.projectActions.length).toBeGreaterThan(0);
  expect(await readFile(join(root, "projects", "demo", "wiki", "index.md"), "utf8")).toBe("# Demo\n");
});

test("project service lists active projects unless legacy projects are requested", async () => {
  await writeJson(join(root, "projects", "active", "state", "project.json"), {
    key: "active",
    name: "Active",
    repo_paths: [join(root, "repos", "active")],
  });
  await writeJson(join(root, "projects", "old-v1", "state", "project.json"), {
    key: "old-v1",
    name: "Old V1",
    lifecycle: "legacy",
    repo_paths: [join(root, "repos", "old-v1")],
  });

  const service = new ProjectService(root);

  expect((await service.listProjects()).projects.map((project) => project.key)).toEqual(["active"]);
  expect((await service.listProjects({ includeLegacy: true })).projects.map((project) => project.key)).toEqual([
    "active",
    "old-v1",
  ]);
});

test("project service exposes the project learn curator facade without changing pipeline routing", async () => {
  await seedCuratorProject();
  seedMemoryDb();
  await seedSchema();
  const service = new ProjectService(root);

  const result = await service.runProjectLearn({
    projectKey: "demo",
    dryRun: false,
    review: false,
    now: new Date("2026-06-23T10:00:00.000Z"),
    runner: async (_command, options) => ({
      exitCode: 0,
      stdout: JSON.stringify(
        options?.stdin?.includes("Project Memory retrieval hint generator")
          ? hintGenerationOutput(options.stdin)
          : options?.stdin?.includes("auditing first-create Project Memory usefulness")
          ? usefulnessCritique()
          : creationDraft(),
      ),
      stderr: "",
    }),
  });

  expect(result.status).toBe("completed_with_pending_index");
  expect(result.artifacts.curator_output).toBe("curator-creation-draft.json");
  expect(result.artifacts.retrieval_index_result).toBe("project-memory-retrieval-index-result.json");
  expect(result.content_quality_status).toBe("trusted");
  expect(result.retrieval_readiness_status).toBe("pending");
  expect(result.stopped_before_writes).toBe(false);
});

function creationDraft() {
  return {
    schema_version: 1,
    project_key: "demo",
    mode: "create",
    packet_ref: {
      run_dir: "projects/demo/runs/project-learn/2026-06-23T10-00-00.000Z-run",
      artifact: "input-packet.json",
      packet_schema_version: 1,
    },
    packet_context: { degraded: false, degraded_reasons: [], budgets: { max_items: 25, max_content_chars: 4_000 } },
    summary: "Initial brain draft",
    quality_diagnostics: qualityDiagnostics(),
    documentation_contract: documentationContract(),
    brain_intent: {
      name: "Demo",
      first_brain_summary: "Create first brain",
      untrusted_existing_markdown_policy: "adopt",
    },
    pages: [
      creationPage("page_index", "index.md", "Demo", "Project Memory index", "orientation_index"),
      creationPage("page_product", "product.md", "Product", "Product and memory model", "product_memory_model"),
      creationPage("page_runtime", "runtime.md", "Runtime", "Runtime workflows", "runtime_workflows"),
      creationPage("page_architecture", "architecture.md", "Architecture", "Architecture and data flow", "architecture_data_flow"),
      creationPage("page_roadmap", "roadmap.md", "Roadmap", "Current work and roadmap", "current_work_roadmap"),
      creationPage("page_decisions", "decisions.md", "Decisions", "Decisions and terms", "decisions_terms"),
    ],
    state_intent: { mark_project_memory_curated: true, freshness_intent: "initialize" },
    evidence_refs: [{ kind: "project_state", ref: "bootstrap_state" }],
    repo_citations: [],
    risk: { level: "low", reasons: [], requires_quarantine: false },
  };
}

function creationPage(
  id: string,
  path: string,
  title: string,
  purpose: string,
  role:
    | "orientation_index"
    | "product_memory_model"
    | "runtime_workflows"
    | "architecture_data_flow"
    | "current_work_roadmap"
    | "decisions_terms",
) {
  return {
    id,
    target: { path, path_kind: "new_wiki_page" },
    title,
    purpose,
    role,
    answer_domains: [answerDomainForRole(role)],
    required_topics: ["Overview", "Details"],
    representative_questions: [`How does ${title} work?`],
    content_intent: `Create ${title}`,
    apply_payload: {
      schema_version: 1,
      pages: [
        {
          page_path: path,
          title,
          purpose,
          sections: [
            {
              heading: "Overview",
              level: 2,
              body: { paragraphs: [domainBody(answerDomainForRole(role), "Overview")] },
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
              body: { paragraphs: [domainBody(answerDomainForRole(role), "Details")] },
              evidence_refs: [{ kind: "project_state", ref: "bootstrap_state" }],
              repo_citations: [repoCitation()],
              inference: {
                label: "initial_project_memory",
                why_direct_repo_evidence_is_unavailable: "Creation summary is based on project state.",
              },
            },
          ],
          evidence_refs: [{ kind: "project_state", ref: "bootstrap_state" }],
          repo_citations: [repoCitation()],
          inference: {
            label: "initial_project_memory",
            why_direct_repo_evidence_is_unavailable: "Creation summary is based on project state.",
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
}

function repoCitation() {
  return { path: "README.md", line_start: 1, line_end: 5, reason: "Project overview" };
}

function qualityDiagnostics() {
  return {
    schema_version: 1,
    content_quality: { status: "trusted", reasons: [] },
    retrieval_readiness: { status: "not_applicable", reason: null },
    domain_coverage: answerDomainCoverage(),
    role_coverage: [
      "orientation_index",
      "product_memory_model",
      "runtime_workflows",
      "architecture_data_flow",
      "current_work_roadmap",
      "decisions_terms",
    ].map((role) => ({
      role,
      page_ref: `${role}.md`,
      sections_seen: 2,
      citations_seen: 1,
      body_chars_seen: 500,
    })),
    candidate_dispositions: [],
    missing_coverage: [],
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

function usefulnessCritique() {
  return {
    schema_version: 1,
    project_key: "demo",
    verdict: "pass",
    reasons: ["useful Project Memory"],
    weak_sections: [],
    evidence_map_ref: "project-memory-evidence-map.json",
    rendered_markdown_refs: ["index.md", "product.md", "runtime.md", "architecture.md", "roadmap.md", "decisions.md"],
  };
}

function hintGenerationOutput(prompt: string | undefined) {
  const payload = JSON.parse((prompt ?? "").slice((prompt ?? "").indexOf("{")));
  return {
    schema_version: 1,
    project_key: "demo",
    category: null,
    entries: payload.sections.map((section: { wiki_path: string; section_id: string; section_hash: string; heading_path: string[] }) => ({
      wiki_path: section.wiki_path,
      section_id: section.section_id,
      section_hash: section.section_hash,
      keywords: section.heading_path,
      aliases: [],
      topics: ["project-memory"],
      query_phrases: [`How does ${section.heading_path.join(" ")} work?`],
      confidence: "high",
    })),
  };
}

function documentationContract() {
  return {
    inspected_default_surfaces: ["docs/ROADMAP.md", "docs/adr/", "src/memory/", "src/project/", "src/commands/"],
    curator_added_surfaces: [],
    missing_orientation_surfaces: [],
    missing_coverage: [],
    shallow_summary_findings: [],
  };
}

async function seedCuratorProject(): Promise<void> {
  const repoPath = join(root, "repos", "demo");
  await writeJson(join(root, "projects", "demo", "state", "project.json"), {
    key: "demo",
    name: "Demo",
    repo_paths: [repoPath],
  });
  await writeJson(join(root, "projects", "demo", "state", "bootstrap-state.json"), { status: "uncurated" });
  await mkdir(join(root, "projects", "demo", "wiki"), { recursive: true });
  await writeFile(join(root, "projects", "demo", "wiki", "index.md"), "# Demo\n", "utf8");
  await seedRepoEvidence(repoPath);
}

async function seedRepoEvidence(repoPath: string): Promise<void> {
  await mkdir(join(repoPath, "src", "memory"), { recursive: true });
  await mkdir(join(repoPath, "src", "commands"), { recursive: true });
  await mkdir(join(repoPath, "src", "project"), { recursive: true });
  await mkdir(join(repoPath, "docs", "adr"), { recursive: true });
  await writeFile(join(repoPath, "MY_VISION.md"), "Project Memory is living repo documentation from Session Memory leads.\n", "utf8");
  await writeFile(join(repoPath, "docs", "ROADMAP.md"), "Step 5 Step 6 ADR roadmap decisions.\n", "utf8");
  await writeFile(join(repoPath, "src", "memory", "db.ts"), "state/memory.db sqlite session_memories project memory retrieval embeddings\n", "utf8");
  await writeFile(join(repoPath, "src", "commands", "project.ts"), "project learn memory query memory index session memory inbox intake\n", "utf8");
  await writeFile(join(repoPath, "src", "project", "project-memory-curator-service.ts"), "validateCuratorOutput applyCreationDraft curator-validation.json project-memory-changeset.json\n", "utf8");
  await writeFile(join(repoPath, "src", "project", "project-memory-candidate-intake-service.ts"), "project_candidate project_handoff lead source_event_refs producer_kind\n", "utf8");
  await writeFile(join(repoPath, "docs", "adr", "0063-use-answer-domain-project-memory-documentation-map.md"), "ADR answer domain map\n", "utf8");
  await writeFile(join(repoPath, "docs", "adr", "0064-use-two-pass-project-memory-evidence-workflow.md"), "ADR evidence workflow\n", "utf8");
  await writeFile(join(repoPath, "docs", "adr", "0065-require-independent-first-create-usefulness-critique.md"), "ADR usefulness critique\n", "utf8");
  await writeFile(join(repoPath, "docs", "adr", "0066-allow-clean-project-shell-rebootstrap-reset.md"), "ADR reset\n", "utf8");
}

async function seedSchema(): Promise<void> {
  await mkdir(join(root, "schema", "rules"), { recursive: true });
  await writeFile(join(root, "schema", "global.md"), "Project schema\n", "utf8");
  await writeJson(join(root, "schema", "rules", "source-classification.json"), {
    rule: "source-classification",
    description: "Source classification.",
    required_fields: ["source_kind"],
    source_kind: ["handoff"],
    ownership: ["project"],
    action: ["update-existing-pages"],
  });
  await writeJson(join(root, "schema", "rules", "memory-scopes.json"), {
    rule: "memory-scopes",
    description: "Memory scopes.",
    scopes: [
      { key: "project", summary: "Project memory." },
      { key: "practice", summary: "Practice memory." },
    ],
    phase_0_active: ["project"],
    phase_0_deferred: ["practice"],
  });
  await writeJson(join(root, "schema", "rules", "page-taxonomy.json"), {
    rule: "page-taxonomy",
    description: "Page taxonomy.",
    categories: [{ key: "setup", summary: "Setup." }],
  });
}

function seedMemoryDb(): void {
  const db = openMemoryDb(root);
  db.close();
}
