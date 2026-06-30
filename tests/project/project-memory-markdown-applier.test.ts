import { afterEach, beforeEach, expect, test } from "bun:test";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ProjectMemoryMarkdownApplier } from "../../src/project/project-memory-markdown-applier.ts";
import { readJson, writeJson } from "../../src/runtime/json.ts";

let root: string;

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "myelin-markdown-applier-"));
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

test("promotes staged writes and records terminal apply journal", async () => {
  await seedProject();
  const run = await seedRun("run-1");
  const applier = new ProjectMemoryMarkdownApplier(root);

  const result = await applier.promoteStagedWrites({
    project_key: "demo",
    run_dir: "projects/demo/runs/project-learn/run-1",
    mode: "create",
    absolute_run_dir: run,
    curator_output_ref: "curator-creation-draft.json",
    staged_outputs_dir: join(run, "staged"),
    writes: [
      { canonical_project_path: "projects/demo/wiki/index.md", content: "# Demo\n", write_kind: "wiki_page" },
      { canonical_project_path: "projects/demo/state/project-memory.json", content: JSON.stringify({ status: "curated" }, null, 2) + "\n", write_kind: "project_state" },
    ],
  });

  expect(result.status).toBe("applied");
  expect(await readFile(join(root, "projects", "demo", "wiki", "index.md"), "utf8")).toBe("# Demo\n");
  expect(JSON.parse(await readFile(join(root, "projects", "demo", "state", "project-memory.json"), "utf8")).status).toBe("curated");

  const journal = await readJson<{ status: string; expected_writes: { write_kind: string }[]; observed_promotions: unknown[] }>(
    join(run, "project-memory-apply-journal.json"),
  );
  expect(journal.status).toBe("applied");
  expect(journal.expected_writes.map((write) => write.write_kind)).toEqual(["wiki_page", "project_state"]);
  expect(journal.observed_promotions).toHaveLength(2);
});

test("recovers incomplete journals by completing missing promotions", async () => {
  await seedProject();
  const run = await seedRun("run-recovery");
  const applier = new ProjectMemoryMarkdownApplier(root);

  await applier.promoteStagedWrites({
    project_key: "demo",
    run_dir: "projects/demo/runs/project-learn/run-recovery",
    mode: "create",
    absolute_run_dir: run,
    curator_output_ref: "curator-creation-draft.json",
    staged_outputs_dir: join(run, "staged"),
    writes: [
      { canonical_project_path: "projects/demo/wiki/index.md", content: "# Demo\n", write_kind: "wiki_page" },
      { canonical_project_path: "projects/demo/state/project-memory.json", content: JSON.stringify({ status: "curated" }, null, 2) + "\n", write_kind: "project_state" },
    ],
    stop_after_promotions_for_test: 1,
  });
  await writeJson(join(run, "project-memory-apply-result.json"), { status: "applied" });
  await writeJson(join(run, "project-memory-changeset.json"), { schema_version: 1 });

  const recovered = await applier.recoverFromJournal(join(run, "project-memory-apply-journal.json"));

  expect(recovered.status).toBe("applied");
  expect(JSON.parse(await readFile(join(root, "projects", "demo", "state", "project-memory.json"), "utf8")).status).toBe("curated");
  const journal = await readJson<{ status: string }>(join(run, "project-memory-apply-journal.json"));
  expect(journal.status).toBe("recovered");
});

test("keeps journals incomplete when canonical promotion lacks apply artifacts", async () => {
  await seedProject();
  const run = await seedRun("run-missing-artifacts");
  const applier = new ProjectMemoryMarkdownApplier(root);

  await applier.promoteStagedWrites({
    project_key: "demo",
    run_dir: "projects/demo/runs/project-learn/run-missing-artifacts",
    mode: "create",
    absolute_run_dir: run,
    curator_output_ref: "curator-creation-draft.json",
    staged_outputs_dir: join(run, "staged"),
    writes: [{ canonical_project_path: "projects/demo/wiki/index.md", content: "# Demo\n", write_kind: "wiki_page" }],
    finalize_journal_after_promotion: true,
    require_apply_artifacts_before_terminal: true,
  });

  const journal = await readJson<{ status: string }>(join(run, "project-memory-apply-journal.json"));
  expect(journal.status).toBe("promoting");
  expect(await applier.findIncompleteApplyJournals("demo")).toEqual([join(run, "project-memory-apply-journal.json")]);

  const recovered = await applier.recoverFromJournal(join(run, "project-memory-apply-journal.json"));
  expect(recovered.status).toBe("failed");
  expect(recovered.reason).toContain("apply result or changeset artifact is missing");
});

test("recovery fails closed when an unpromoted canonical file changed", async () => {
  await seedProject();
  await writeJson(join(root, "projects", "demo", "state", "project-memory.json"), { status: "old" });
  const run = await seedRun("run-hash-drift");
  const applier = new ProjectMemoryMarkdownApplier(root);

  await applier.promoteStagedWrites({
    project_key: "demo",
    run_dir: "projects/demo/runs/project-learn/run-hash-drift",
    mode: "create",
    absolute_run_dir: run,
    curator_output_ref: "curator-creation-draft.json",
    staged_outputs_dir: join(run, "staged"),
    writes: [
      { canonical_project_path: "projects/demo/wiki/index.md", content: "# Demo\n", write_kind: "wiki_page" },
      { canonical_project_path: "projects/demo/state/project-memory.json", content: JSON.stringify({ status: "curated" }, null, 2) + "\n", write_kind: "project_state" },
    ],
    stop_after_promotions_for_test: 1,
  });
  await writeJson(join(run, "project-memory-apply-result.json"), { status: "applied" });
  await writeJson(join(run, "project-memory-changeset.json"), { schema_version: 1 });
  await writeJson(join(root, "projects", "demo", "state", "project-memory.json"), { status: "operator-change" });

  const recovered = await applier.recoverFromJournal(join(run, "project-memory-apply-journal.json"));

  expect(recovered.status).toBe("failed");
  expect(recovered.reason).toContain("canonical file changed before promotion");
  expect(JSON.parse(await readFile(join(root, "projects", "demo", "state", "project-memory.json"), "utf8")).status).toBe("operator-change");
});

test("recovery fails closed when an observed promotion drifted before finalization", async () => {
  await seedProject();
  const run = await seedRun("run-observed-drift");
  const applier = new ProjectMemoryMarkdownApplier(root);

  await applier.promoteStagedWrites({
    project_key: "demo",
    run_dir: "projects/demo/runs/project-learn/run-observed-drift",
    mode: "create",
    absolute_run_dir: run,
    curator_output_ref: "curator-creation-draft.json",
    staged_outputs_dir: join(run, "staged"),
    writes: [{ canonical_project_path: "projects/demo/wiki/index.md", content: "# Demo\n", write_kind: "wiki_page" }],
    finalize_journal_after_promotion: false,
    require_apply_artifacts_before_terminal: true,
  });
  await writeJson(join(run, "project-memory-apply-result.json"), { status: "applied" });
  await writeJson(join(run, "project-memory-changeset.json"), { schema_version: 1 });
  await writeFile(join(root, "projects", "demo", "wiki", "index.md"), "# Operator edit\n", "utf8");

  const recovered = await applier.recoverFromJournal(join(run, "project-memory-apply-journal.json"));

  expect(recovered.status).toBe("failed");
  expect(recovered.reason).toContain("observed canonical file changed after promotion");
  const journal = await readJson<{ status: string }>(join(run, "project-memory-apply-journal.json"));
  expect(journal.status).toBe("failed");
  expect(await readFile(join(root, "projects", "demo", "wiki", "index.md"), "utf8")).toBe("# Operator edit\n");
});

test("applies creation drafts as trusted wiki pages and project memory state", async () => {
  await seedProject();
  const run = await seedRun("run-create");
  const applier = new ProjectMemoryMarkdownApplier(root);

  const result = await applier.applyCreationDraft({
    project_key: "demo",
    run_dir: "projects/demo/runs/project-learn/run-create",
    absolute_run_dir: run,
    draft: creationDraft(),
  });

  expect(result.status).toBe("applied");
  expect(await readFile(join(root, "projects", "demo", "wiki", "index.md"), "utf8")).toContain("# Demo");
  expect(await readFile(join(root, "projects", "demo", "wiki", "setup", "index.md"), "utf8")).toContain("# Setup");
  const state = JSON.parse(await readFile(join(root, "projects", "demo", "state", "project-memory.json"), "utf8"));
  expect(state.status).toBe("curated");
  expect(state.source_run_dir).toBe("projects/demo/runs/project-learn/run-create");

  const changeset = JSON.parse(await readFile(join(run, "project-memory-changeset.json"), "utf8"));
  expect(changeset.page_changes.map((page: { page_id: string }) => page.page_id).sort()).toEqual([
    "page_architecture",
    "page_index",
    "page_operations",
    "page_setup",
  ]);
  expect(changeset.page_changes[0].after_snippet.text.length).toBeGreaterThan(0);
});

test("rejects creation apply without a full documentation page set", async () => {
  await seedProject();
  const run = await seedRun("run-create-minimum");
  const draft = creationDraft();
  draft.pages = draft.pages.filter((page) => page.id === "page_index");
  const applier = new ProjectMemoryMarkdownApplier(root);

  const result = await applier.applyCreationDraft({
    project_key: "demo",
    run_dir: "projects/demo/runs/project-learn/run-create-minimum",
    absolute_run_dir: run,
    draft,
  });

  expect(result.status).toBe("skipped");
  expect(result.reason).toContain("publication minimum");
});

test("rejects creation apply with a no-domain-pages rationale instead of documentation pages", async () => {
  await seedProject();
  const run = await seedRun("run-create-rationale");
  const draft = creationDraft();
  draft.pages = draft.pages.filter((page) => page.id === "page_index");
  const indexPage = draft.pages[0];
  if (!indexPage) throw new Error("missing index page fixture");
  indexPage.notes_for_apply = ["no-domain-pages: project has only an index-worthy memory surface"];
  const applier = new ProjectMemoryMarkdownApplier(root);

  const result = await applier.applyCreationDraft({
    project_key: "demo",
    run_dir: "projects/demo/runs/project-learn/run-create-rationale",
    absolute_run_dir: run,
    draft,
  });

  expect(result.status).toBe("skipped");
  expect(result.reason).toContain("publication minimum");
});

test("applies maintenance CREATE_ENTRY and PATCH_ENTRY to existing wiki pages", async () => {
  await seedCuratedProject();
  const run = await seedRun("run-maintain");
  const applier = new ProjectMemoryMarkdownApplier(root);

  const createResult = await applier.applyMaintenanceProposal({
    project_key: "demo",
    run_dir: "projects/demo/runs/project-learn/run-maintain",
    absolute_run_dir: run,
    proposal: maintenanceProposal([maintenanceItem("create_setup", "CREATE_ENTRY")]),
    eligible_item_ids: ["create_setup"],
  });

  expect(createResult.status).toBe("applied");
  expect(await readFile(join(root, "projects", "demo", "wiki", "setup", "index.md"), "utf8")).toContain('id="setup.cli"');
  const changeset = JSON.parse(await readFile(join(run, "project-memory-changeset.json"), "utf8"));
  expect(changeset.item_changes[0].item_id).toBe("create_setup");
  expect(changeset.item_changes[0].after_snippet.text).toContain("Document CLI setup command.");
  expect(changeset.file_changes[0].path).toBe("projects/demo/wiki/setup/index.md");
  const sourceState = JSON.parse(await readFile(join(root, "projects", "demo", "state", "project-memory-source-consumptions.json"), "utf8"));
  expect(sourceState.records[0]).toMatchObject({
    source_ref: "cand_1",
    source_kind: "project_candidate",
    consumed_by_run: "projects/demo/runs/project-learn/run-maintain",
    terminal_decision: "applied_to_project_memory",
  });

  const patchRun = await seedRun("run-maintain-patch");
  const patchResult = await applier.applyMaintenanceProposal({
    project_key: "demo",
    run_dir: "projects/demo/runs/project-learn/run-maintain-patch",
    absolute_run_dir: patchRun,
    proposal: maintenanceProposal([maintenanceItem("patch_setup", "PATCH_ENTRY", { body: { paragraphs: ["Updated CLI command behavior."] } })]),
    eligible_item_ids: ["patch_setup"],
  });

  expect(patchResult.status).toBe("applied");
  const page = await readFile(join(root, "projects", "demo", "wiki", "setup", "index.md"), "utf8");
  expect(page).toContain("Updated CLI command behavior.");
  expect(page).not.toContain("Document CLI setup command.");
});

test("skips maintenance apply without trusted project-memory state", async () => {
  await seedProject();
  const run = await seedRun("run-maintain-untrusted");
  const applier = new ProjectMemoryMarkdownApplier(root);

  const result = await applier.applyMaintenanceProposal({
    project_key: "demo",
    run_dir: "projects/demo/runs/project-learn/run-maintain-untrusted",
    absolute_run_dir: run,
    proposal: maintenanceProposal([maintenanceItem("create_setup", "CREATE_ENTRY")]),
    eligible_item_ids: ["create_setup"],
  });

  expect(result.status).toBe("skipped");
  expect(result.reason).toContain("trusted Project Memory state");
});

async function seedProject(): Promise<void> {
  await mkdir(join(root, "projects", "demo", "wiki"), { recursive: true });
  await mkdir(join(root, "projects", "demo", "state"), { recursive: true });
  await writeFile(join(root, "projects", "demo", "wiki", "index.md"), "# Old\n", "utf8");
}

async function seedCuratedProject(): Promise<void> {
  await seedProject();
  await writeJson(join(root, "projects", "demo", "state", "project-memory.json"), { status: "curated" });
  await mkdir(join(root, "projects", "demo", "wiki", "setup"), { recursive: true });
  await writeFile(join(root, "projects", "demo", "wiki", "setup", "index.md"), "# Setup\n", "utf8");
}

async function seedRun(id: string): Promise<string> {
  const run = join(root, "projects", "demo", "runs", "project-learn", id);
  await mkdir(run, { recursive: true });
  await writeJson(join(run, "input-packet.json"), { schema_version: 1, project_key: "demo" });
  await writeJson(join(run, "curator-creation-draft.json"), { schema_version: 1, project_key: "demo" });
  await writeJson(join(run, "curator-validation.json"), { ok: true, mode: "create", project_key: "demo" });
  return run;
}

function creationDraft() {
  return {
    schema_version: 1 as const,
    project_key: "demo",
    mode: "create" as const,
    packet_ref: { run_dir: "projects/demo/runs/project-learn/run-create", artifact: "input-packet.json" as const, packet_schema_version: 1 as const },
    packet_context: { degraded: false, degraded_reasons: [], budgets: { max_items: 25, max_content_chars: 4_000 } },
    summary: "Initial brain",
    brain_intent: { name: "Demo", first_brain_summary: "Create first brain", untrusted_existing_markdown_policy: "adopt" as const },
    pages: [
      creationPage("page_index", "index.md", "Demo", "Project Memory index"),
      creationPage("page_setup", "setup/index.md", "Setup", "Setup workflows"),
      creationPage("page_architecture", "architecture.md", "Architecture", "Architecture and data flow"),
      creationPage("page_operations", "operations.md", "Operations", "Operations and current work"),
    ],
    state_intent: { mark_project_memory_curated: true, freshness_intent: "initialize" as const },
    evidence_refs: [{ kind: "project_state" as const, ref: "bootstrap_state" }],
    repo_citations: [],
    risk: { level: "low" as const, reasons: [], requires_quarantine: false },
  };
}

function creationPage(id: string, path: string, title: string, purpose: string) {
  return {
    id,
    target: { path, path_kind: "new_wiki_page" as const },
    title,
    purpose,
    content_intent: `Create ${title}`,
    apply_payload: {
      schema_version: 1 as const,
      pages: [{ page_path: path, title, purpose, body: { paragraphs: [`${title} describes ${purpose}.`] }, evidence_refs: [{ kind: "project_state" as const, ref: "bootstrap_state" }], repo_citations: [repoCitation()], inference: { label: "initial_project_memory", why_direct_repo_evidence_is_unavailable: "Creation summary is based on project state." } }],
    },
    required_sections: ["Overview"],
    evidence_refs: [{ kind: "project_state" as const, ref: "bootstrap_state" }],
    repo_citations: [repoCitation()],
    notes_for_apply: [] as string[],
  };
}

function repoCitation() {
  return { path: "README.md", line_start: 1, line_end: 5, reason: "Project overview" };
}

function maintenanceProposal(items: ReturnType<typeof maintenanceItem>[]) {
  return {
    schema_version: 1 as const,
    project_key: "demo",
    mode: "maintain" as const,
    packet_ref: { run_dir: "projects/demo/runs/project-learn/run-maintain", artifact: "input-packet.json" as const, packet_schema_version: 1 as const },
    packet_context: { degraded: false, degraded_reasons: [], budgets: { max_items: 25, max_content_chars: 4_000 } },
    summary: "maintenance",
    items,
    noop_inputs: [],
    risk: { level: "low" as const, reasons: [], requires_quarantine: false },
  };
}

function maintenanceItem(id: string, operation: string, overrides: { body?: { paragraphs: string[] }; lifecycle?: string } = {}) {
  const lifecycle = overrides.lifecycle ?? "active";
  return {
    id,
    operation: operation as "CREATE_ENTRY",
    target_page: { path: "setup/index.md", path_kind: "existing_wiki_page" as const },
    target_entry_id: operation === "CREATE_ENTRY" ? undefined : "setup.cli",
    proposed_entry_id: operation === "CREATE_ENTRY" ? "setup.cli" : undefined,
    content_intent: "Document CLI setup command.",
    apply_payload: {
      schema_version: 1 as const,
      entries: [{ entry_id: "setup.cli", title: "Setup CLI", body: overrides.body ?? { paragraphs: ["Document CLI setup command."] }, lifecycle: lifecycle as "active", evidence_refs: [{ kind: "project_candidate" as const, ref: "cand_1", note: "durable setup" }], repo_citations: [{ path: "src/commands/project.ts", line_start: 1, line_end: 20, reason: "CLI command registration" }], applicability: { commands: ["myelin project learn demo"] } }],
    },
    source_packet_refs: [{ kind: "project_candidate" as const, ref: "cand_1" }],
    evidence_refs: [{ kind: "project_candidate" as const, ref: "cand_1" }],
    repo_citations: [{ path: "src/commands/project.ts", line_start: 1, line_end: 20, reason: "CLI command registration" }],
    applicability: { commands: ["myelin project learn demo"] },
    lifecycle_intent: lifecycle as "active",
    risk: { level: "low" as const, reasons: [], requires_quarantine: false },
    preconditions: ["setup page exists"],
    expected_outcome: "setup page changes",
  };
}
