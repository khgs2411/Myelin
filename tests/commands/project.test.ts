import { afterEach, beforeEach, expect, test } from "bun:test";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { registerProjectCommands } from "../../src/commands/project.ts";
import { createCli } from "../../src/commands/registry.ts";
import { createRuntimeInboxItem } from "../../src/inbox/runtime-inbox-items.ts";
import { openMemoryDb } from "../../src/memory/db.ts";
import { writeJson } from "../../src/runtime/json.ts";

let root: string;
let oldCwd: string;

beforeEach(async () => {
  oldCwd = process.cwd();
  root = await mkdtemp(join(tmpdir(), "myelin-project-cli-"));
  process.chdir(root);
});

afterEach(async () => {
  process.chdir(oldCwd);
  await rm(root, { recursive: true, force: true });
});

test("project list shows active projects by default and legacy projects on request", async () => {
  await seedProject("active", "active");
  await seedProject("old-v1", "legacy");
  const cli = createCli("myelin");
  registerProjectCommands(cli);

  const active = await cli.run(["project", "list"]);
  expect(active.exitCode).toBe(0);
  expect(active.message).toContain("Active projects:");
  expect(active.message).toContain("- active [active]");
  expect(active.message).not.toContain("old-v1");
  expect(active.message).toContain("Use --include-legacy");

  const all = await cli.run(["project", "list", "--include-legacy"]);
  expect(all.exitCode).toBe(0);
  expect(all.message).toContain("- active [active]");
  expect(all.message).toContain("- old-v1 [legacy]");
});

test("project list --json emits active or legacy-aware project inventory", async () => {
  await seedProject("active", "active");
  await seedProject("old-v1", "legacy");
  const cli = createCli("myelin");
  registerProjectCommands(cli);

  const active = JSON.parse((await cli.run(["project", "list", "--json"])).message);
  expect(active.projects.map((project: { key: string }) => project.key)).toEqual(["active"]);

  const all = JSON.parse((await cli.run(["project", "list", "--include-legacy", "--json"])).message);
  expect(all.projects.map((project: { key: string; lifecycle: string }) => [project.key, project.lifecycle])).toEqual([
    ["active", "active"],
    ["old-v1", "legacy"],
  ]);
});

test("project list rejects unknown options", async () => {
  const cli = createCli("myelin");
  registerProjectCommands(cli);

  const result = await cli.run(["project", "list", "--all"]);

  expect(result.exitCode).toBe(1);
  expect(result.message).toContain("Unknown project list option: --all");
});

test("project packet emits a read-only Project Memory packet", async () => {
  await seedProject("active", "active");
  await writeJson(join(root, "projects", "active", "state", "bootstrap-state.json"), {
    status: "uncurated",
    missing: ["curated_project_memory"],
  });
  await mkdir(join(root, "projects", "active", "wiki"), { recursive: true });
  await writeFile(join(root, "projects", "active", "wiki", "index.md"), "# Project Memory\n\nShell only.\n", "utf8");
  const cli = createCli("myelin");
  registerProjectCommands(cli);

  const summary = await cli.run(["project", "packet", "active"]);
  expect(summary.exitCode).toBe(0);
  expect(summary.message).toContain("Project Memory packet for active");
  expect(summary.message).toContain("mode: create");
  expect(summary.message).toContain("wiki pages: 1");
  expect(summary.message).toContain("Use --json for the full packet.");

  const packet = JSON.parse((await cli.run(["project", "packet", "active", "--json"])).message);
  expect(packet.project_key).toBe("active");
  expect(packet.wiki.page_count).toBe(1);
  expect(packet.degraded_reasons).toContain(
    "state/memory.db is missing; Session Memory and pending handoff inputs are unavailable",
  );
  expect(await Bun.file(join(root, "state", "memory.db")).exists()).toBe(false);
});

test("project packet rejects unknown options and missing project keys", async () => {
  const cli = createCli("myelin");
  registerProjectCommands(cli);

  expect((await cli.run(["project", "packet"])).message).toContain(
    "Usage: myelin project packet <project-key> [--json]",
  );
  expect((await cli.run(["project", "packet", "active", "--full"])).message).toContain(
    "Unknown project packet option: --full",
  );
});

test("project reset requires explicit clean confirmation", async () => {
  const cli = createCli("myelin");
  registerProjectCommands(cli);

  expect((await cli.run(["project", "reset", "active"])).message).toContain(
    "Usage: myelin project reset <project-key> --clean --confirm <project-key> [--json]",
  );
  expect((await cli.run(["project", "reset", "active", "--clean", "--confirm", "other"])).message).toContain(
    "Usage: myelin project reset <project-key> --clean --confirm <project-key> [--json]",
  );
});

test("project reset clean rebootstrap preserves root memory db", async () => {
  await seedProject("active", "active");
  await mkdir(join(root, "repos", "active"), { recursive: true });
  await mkdir(join(root, "state"), { recursive: true });
  await writeFile(join(root, "state", "memory.db"), "memory", "utf8");
  await mkdir(join(root, "projects", "active", "wiki"), { recursive: true });
  await writeFile(join(root, "projects", "active", "wiki", "old.md"), "# Old\n", "utf8");
  await writeJson(join(root, "projects", "active", "state", "project-memory.json"), { status: "curated" });
  const cli = createCli("myelin");
  registerProjectCommands(cli);

  const result = await cli.run(["project", "reset", "active", "--clean", "--confirm", "active", "--json"]);
  const response = JSON.parse(result.message);

  expect(result.exitCode).toBe(0);
  expect(response).toMatchObject({
    project_key: "active",
    reset_scope: "project_shell",
    bootstrap_status: "rebootstrapped",
  });
  expect(await readFile(join(root, "state", "memory.db"), "utf8")).toBe("memory");
  expect(await Bun.file(join(root, "projects", "active", "wiki", "old.md")).exists()).toBe(false);
  expect(await Bun.file(join(root, "projects", "active", "state", "project-memory.json")).exists()).toBe(false);
  expect(await Bun.file(join(root, "projects", "active", "state", "bootstrap-state.json")).exists()).toBe(true);
});

test("project learn routes through curator service and writes curator artifacts", async () => {
  await seedProject("active", "active");
  await writeJson(join(root, "projects", "active", "state", "bootstrap-state.json"), {
    status: "uncurated",
    missing: ["curated_project_memory"],
  });
  await mkdir(join(root, "projects", "active", "wiki"), { recursive: true });
  await writeFile(join(root, "projects", "active", "wiki", "index.md"), "# Active\n", "utf8");
  seedMemoryDb();
  await seedSchema();
  const cli = createCli("myelin");
  registerProjectCommands(cli, {
    now: () => new Date("2026-06-23T10:00:00.000Z"),
    runner: async (_command, options) => ({
      exitCode: 0,
      stdout: JSON.stringify(
        options?.stdin?.includes("Project Memory retrieval hint generator")
          ? hintGenerationOutput("active", options.stdin)
          : options?.stdin?.includes("auditing first-create Project Memory usefulness")
          ? usefulnessCritique("active")
          : creationDraft("active", "projects/active/runs/project-learn/2026-06-23T10-00-00.000Z-run"),
      ),
      stderr: "",
    }),
  });

  const result = await cli.run(["project", "learn", "active", "--json"]);
  const response = JSON.parse(result.message);

  expect(result.exitCode).toBe(0);
  expect(response.status).toBe("completed_with_pending_index");
  expect(response.project_key).toBe("active");
  expect(response.artifacts.curator_output).toBe("curator-creation-draft.json");
  expect(response.artifacts.curator_output_contract).toBe("curator-output-contract.json");
  expect(response.artifacts.apply_journal).toBe("project-memory-apply-journal.json");
  expect(response.artifacts.retrieval_index_result).toBe("project-memory-retrieval-index-result.json");
  expect(response.content_quality_status).toBe("trusted");
  expect(response.retrieval_readiness_status).toBe("pending");
  expect(response.stopped_before_writes).toBe(false);
  expect(await readFile(join(root, response.run_dir, "summary.md"), "utf8")).toContain("stopped_before_writes: false");
  expect(await readFile(join(root, response.run_dir, "summary.md"), "utf8")).toContain("status: completed_with_pending_index");
});

test("project learn human output reports pending retrieval index after successful writes", async () => {
  await seedProject("pending-index", "active");
  await writeJson(join(root, "projects", "pending-index", "state", "bootstrap-state.json"), {
    status: "uncurated",
    missing: ["curated_project_memory"],
  });
  await mkdir(join(root, "projects", "pending-index", "wiki"), { recursive: true });
  await writeFile(join(root, "projects", "pending-index", "wiki", "index.md"), "# Pending Index\n", "utf8");
  seedMemoryDb();
  await seedSchema();
  const cli = createCli("myelin");
  registerProjectCommands(cli, {
    now: () => new Date("2026-06-28T10:00:00.000Z"),
    runner: async (_command, options) => ({
      exitCode: 0,
      stdout: JSON.stringify(
        options?.stdin?.includes("Project Memory retrieval hint generator")
          ? hintGenerationOutput("pending-index", options.stdin, false)
          : options?.stdin?.includes("auditing first-create Project Memory usefulness")
          ? usefulnessCritique("pending-index")
          : creationDraft("pending-index", "projects/pending-index/runs/project-learn/2026-06-28T10-00-00.000Z-run"),
      ),
      stderr: "",
    }),
  });

  const result = await cli.run(["project", "learn", "pending-index"]);

  expect(result.exitCode).toBe(0);
  expect(result.message).toContain("Project learn completed_with_pending_index for pending-index.");
  expect(result.message).toContain("pending retrieval index: yes");
});

test("project learn JSON includes runtime inbox intake artifact when intake runs", async () => {
  await seedProject("active", "active");
  await writeJson(join(root, "projects", "active", "state", "bootstrap-state.json"), {
    status: "uncurated",
    missing: ["curated_project_memory"],
  });
  await mkdir(join(root, "projects", "active", "wiki"), { recursive: true });
  await writeFile(join(root, "projects", "active", "wiki", "index.md"), "# Active\n", "utf8");
  seedMemoryDb();
  await seedSchema();
  const inbox = await createRuntimeInboxItem(root, {
    projectKey: "active",
    targetLayer: "project",
    title: "Runtime inbox candidate",
    body: "Runtime inbox candidate visible to project learn.",
    rationale: "Project learn should run intake before packet construction.",
    evidenceRefs: [],
    targetHint: null,
    confidence: "medium",
    risk: "low",
    creator: "operator:test",
    now: new Date("2026-06-25T10:00:00.000Z"),
    id: "2026-06-25T10-00-00Z_a1b2c3",
  });
  if (inbox.status !== "created") throw new Error("failed to create inbox fixture");
  const cli = createCli("myelin");
  registerProjectCommands(cli, {
    now: () => new Date("2026-06-25T11:00:00.000Z"),
    runner: async (_command, options) => ({
      exitCode: 0,
      stdout: JSON.stringify(
        options?.stdin?.includes("Project Memory retrieval hint generator")
          ? hintGenerationOutput("active", options.stdin)
          : options?.stdin?.includes("auditing first-create Project Memory usefulness")
          ? usefulnessCritique("active")
          : creationDraft("active", "projects/active/runs/project-learn/2026-06-25T11-00-00.000Z-run"),
      ),
      stderr: "",
    }),
  });

  const result = await cli.run(["project", "learn", "active", "--json"]);
  const response = JSON.parse(result.message);

  expect(result.exitCode).toBe(0);
  expect(response.artifacts.runtime_inbox_intake).toBe("runtime-inbox-intake.json");
  expect(await Bun.file(join(root, response.run_dir, "runtime-inbox-intake.json")).exists()).toBe(true);
});

test("project ingest is not a Project Memory command", async () => {
  const cli = createCli("myelin");
  registerProjectCommands(cli);

  const result = await cli.run(["project", "ingest", "active"]);

  expect(result.exitCode).toBe(1);
  expect(result.message).toContain("Unknown command");
});

test("project learn reports validation failures in human-readable output", async () => {
  await seedProject("active", "active");
  await writeJson(join(root, "projects", "active", "state", "bootstrap-state.json"), { status: "curated" });
  await writeJson(join(root, "projects", "active", "state", "project-memory.json"), { status: "curated" });
  await mkdir(join(root, "projects", "active", "wiki"), { recursive: true });
  await writeFile(join(root, "projects", "active", "wiki", "index.md"), "# Active\n", "utf8");
  await seedSchema();
  const cli = createCli("myelin");
  registerProjectCommands(cli, {
    now: () => new Date("2026-06-23T10:30:00.000Z"),
    runner: async () => ({
      exitCode: 0,
      stdout: JSON.stringify({
        schema_version: 1,
        project_key: "active",
        mode: "maintain",
        packet_ref: {
          run_dir: "projects/active/runs/project-learn/2026-06-23T10-30-00.000Z-run",
          artifact: "input-packet.json",
          packet_schema_version: 1,
        },
        packet_context: { degraded: false, degraded_reasons: [], budgets: { max_items: 25, max_content_chars: 4_000 } },
        summary: "bad",
        items: [],
        noop_inputs: [],
        risk: { level: "low", reasons: [], requires_quarantine: false },
      }),
      stderr: "",
    }),
  });

  const result = await cli.run(["project", "learn", "active"]);

  expect(result.exitCode).toBe(0);
  expect(result.message).toContain("Project learn needs_review for active.");
  expect(result.message).toContain("validation: failed");
  expect(result.message).toContain("stopped_before_writes: true");
  expect(result.message).toContain("stopped: Project Memory content quality is not trusted");
});

async function seedProject(key: string, lifecycle: "active" | "legacy"): Promise<void> {
  const repoPath = join(root, "repos", key);
  await writeJson(join(root, "projects", key, "state", "project.json"), {
    key,
    name: key,
    lifecycle,
    repo_paths: [repoPath],
  });
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

function creationDraft(projectKey: string, runDir: string) {
  return {
    schema_version: 1,
    project_key: projectKey,
    mode: "create",
    packet_ref: { run_dir: runDir, artifact: "input-packet.json", packet_schema_version: 1 },
    packet_context: { degraded: false, degraded_reasons: [], budgets: { max_items: 25, max_content_chars: 4_000 } },
    summary: "Initial brain",
    quality_diagnostics: qualityDiagnostics(),
    documentation_contract: documentationContract(),
    brain_intent: {
      name: projectKey,
      first_brain_summary: "Create first brain",
      untrusted_existing_markdown_policy: "adopt",
    },
    pages: [
      creationPage("index", "index.md", projectKey, "Project Memory index", "orientation_index"),
      creationPage("product", "product.md", "Product", "Product and memory model", "product_memory_model"),
      creationPage("runtime", "runtime.md", "Runtime", "Runtime workflows", "runtime_workflows"),
      creationPage("architecture", "architecture.md", "Architecture", "Architecture and data flow", "architecture_data_flow"),
      creationPage("roadmap", "roadmap.md", "Roadmap", "Current work and roadmap", "current_work_roadmap"),
      creationPage("decisions", "decisions.md", "Decisions", "Decisions and terms", "decisions_terms"),
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

function usefulnessCritique(projectKey: string) {
  return {
    schema_version: 1,
    project_key: projectKey,
    verdict: "pass",
    reasons: ["useful Project Memory"],
    weak_sections: [],
    evidence_map_ref: "project-memory-evidence-map.json",
    rendered_markdown_refs: ["index.md", "product.md", "runtime.md", "architecture.md", "roadmap.md", "decisions.md"],
  };
}

function hintGenerationOutput(projectKey: string, prompt: string | undefined, valid = true) {
  const payload = JSON.parse((prompt ?? "").slice((prompt ?? "").indexOf("{")));
  return {
    schema_version: 1,
    project_key: projectKey,
    category: null,
    entries: valid
      ? payload.sections.map((section: { wiki_path: string; section_id: string; section_hash: string; heading_path: string[] }) => ({
          wiki_path: section.wiki_path,
          section_id: section.section_id,
          section_hash: section.section_hash,
          keywords: section.heading_path,
          aliases: [],
          topics: ["project-memory"],
          query_phrases: [`How does ${section.heading_path.join(" ")} work?`],
          confidence: "high",
        }))
      : [],
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
