import { expect, test } from "bun:test";
import {
  PROJECT_MEMORY_CONTENT_QUALITY_STATUSES,
  PROJECT_MEMORY_ANSWER_DOMAINS,
  PROJECT_MEMORY_RETRIEVAL_READINESS_STATUSES,
  PROJECT_MEMORY_CREATION_MIN_PAGES,
  PROJECT_MEMORY_LIFECYCLE_INTENTS,
  PROJECT_MEMORY_MAINTENANCE_OPERATIONS,
} from "../../src/project/project-memory-curator-contracts.ts";
import { buildProjectMemoryCuratorOutputSchema } from "../../src/project/project-memory-curator-output-schema.ts";

test("creation curator output schema is mode-specific and run-bound", () => {
  const schema = buildProjectMemoryCuratorOutputSchema({
    projectKey: "demo",
    mode: "create",
    runDir: "projects/demo/runs/project-learn/run-1",
    packetSchemaVersion: 1,
  }) as Record<string, any>;

  expect(schema.properties.schema_version.const).toBe(1);
  expect(schema.properties.project_key.const).toBe("demo");
  expect(schema.properties.mode.const).toBe("create");
  expect(schema.properties.packet_ref.properties.artifact.const).toBe("input-packet.json");
  expect(schema.properties.packet_ref.properties.packet_schema_version.const).toBe(1);
  expect(schema.properties.packet_ref.properties.run_dir.const).toBe("projects/demo/runs/project-learn/run-1");
  expect(schema.properties.pages).toBeDefined();
  expect(schema.properties.quality_diagnostics.$ref).toBe("#/$defs/qualityDiagnostics");
  expect(schema.required).toContain("quality_diagnostics");
  expect(schema.properties.pages.minItems).toBe(PROJECT_MEMORY_CREATION_MIN_PAGES);
  expect(schema.properties.items).toBeUndefined();
});

test("creation schema encodes the known dogfood shape failures structurally", () => {
  const schema = buildProjectMemoryCuratorOutputSchema({
    projectKey: "demo",
    mode: "create",
    runDir: "projects/demo/runs/project-learn/run-1",
    packetSchemaVersion: 1,
  }) as Record<string, any>;
  const defs = schema.$defs;
  const creationPage = defs.creationPageDraft;
  const diagnostics = defs.qualityDiagnostics;
  const wikiPathPattern = new RegExp(defs.pageDraft.properties.page_path.pattern);

  expect(defs.evidenceRef.type).toBe("object");
  expect(schema.properties.evidence_refs.items.$ref).toBe("#/$defs/evidenceRef");
  expect(creationPage.required).toContain("apply_payload");
  expect(creationPage.required).toContain("answer_domains");
  expect(creationPage.required).toContain("required_topics");
  expect(creationPage.required).toContain("representative_questions");
  expect(creationPage.required).not.toContain("role");
  expect(creationPage.required).not.toContain("required_sections");
  expect(creationPage.required).toContain("inspected_surface_refs");
  expect(creationPage.properties.answer_domains.items.enum).toEqual([...PROJECT_MEMORY_ANSWER_DOMAINS]);
  expect(creationPage.properties.answer_domains.minItems).toBe(1);
  expect(creationPage.properties.required_topics.minItems).toBe(1);
  expect(creationPage.properties.representative_questions.minItems).toBe(1);
  expect(creationPage.properties.inspected_surface_refs.minItems).toBe(1);
  expect(schema.required).toContain("documentation_contract");
  expect(schema.properties.documentation_contract.$ref).toBe("#/$defs/documentationContract");
  expect(defs.documentationContract.required).toEqual([
    "inspected_default_surfaces",
    "curator_added_surfaces",
    "missing_orientation_surfaces",
    "missing_coverage",
    "shallow_summary_findings",
  ]);
  expect(creationPage.properties.target.properties.path_kind.enum).toEqual(["new_wiki_page", "existing_wiki_page"]);
  expect(creationPage.properties.target.properties.path_kind.enum).not.toContain("wiki_page");
  expect(creationPage.properties.repo_citations.minItems).toBe(1);
  expect(creationPage.properties.apply_payload.properties.pages.maxItems).toBe(1);
  expect(defs.pageDraft.required).toContain("sections");
  expect(defs.pageDraft.required).not.toContain("body");
  expect(defs.pageDraft.properties.sections.items.$ref).toBe("#/$defs/pageSectionDraft");
  expect(defs.pageSectionDraft.properties.repo_citations.minItems).toBe(1);
  expect(defs.pageDraft.properties.repo_citations.minItems).toBe(1);
  expect(wikiPathPattern.test("index.md")).toBe(true);
  expect(wikiPathPattern.test("project-memory-architecture.md")).toBe(true);
  expect(wikiPathPattern.test("/index.md")).toBe(false);
  expect(wikiPathPattern.test("../index.md")).toBe(false);
  expect(defs.inference.type).toBe("object");
  expect(defs.pageDraft.properties.inference.anyOf).toContainEqual({ $ref: "#/$defs/inference" });
  expect(defs.pageDraft.properties.inference.anyOf).toContainEqual({ type: "null" });
  expect(diagnostics.properties.content_quality.properties.status.enum).toEqual([...PROJECT_MEMORY_CONTENT_QUALITY_STATUSES]);
  expect(diagnostics.properties.retrieval_readiness.properties.status.enum).toEqual([...PROJECT_MEMORY_RETRIEVAL_READINESS_STATUSES]);
  expect(diagnostics.properties.retrieval_readiness.required).toContain("reason");
  expect(diagnostics.properties.domain_coverage.items.properties.domain.enum).toEqual([...PROJECT_MEMORY_ANSWER_DOMAINS]);
  expect(diagnostics.required).toContain("answerability_findings");
  expect(diagnostics.properties.role_coverage).toBeUndefined();
});

test("maintenance curator output schema imports operation and lifecycle enums", () => {
  const schema = buildProjectMemoryCuratorOutputSchema({
    projectKey: "demo",
    mode: "maintain",
    runDir: "projects/demo/runs/project-learn/run-2",
    packetSchemaVersion: 1,
  }) as Record<string, any>;
  const item = schema.$defs.maintenanceItem;

  expect(schema.properties.mode.const).toBe("maintain");
  expect(schema.properties.items).toBeDefined();
  expect(schema.properties.quality_diagnostics.$ref).toBe("#/$defs/qualityDiagnostics");
  expect(schema.required).toContain("quality_diagnostics");
  expect(schema.properties.pages).toBeUndefined();
  expect(item.properties.operation.enum).toEqual([...PROJECT_MEMORY_MAINTENANCE_OPERATIONS]);
  expect(item.properties.lifecycle_intent.enum).toEqual([...PROJECT_MEMORY_LIFECYCLE_INTENTS]);
  expect(schema.$defs.entryDraft.properties.lifecycle.enum).toEqual([...PROJECT_MEMORY_LIFECYCLE_INTENTS]);
  expect(item.properties.target.$ref).toBe("#/$defs/sectionTarget");
  expect(schema.$defs.sectionTarget.properties.target_kind.enum).toEqual([
    "existing_section",
    "new_section_in_existing_page",
    "new_page",
  ]);
  expect(schema.$defs.sectionTarget.properties.expected_section_hash).toEqual({ type: "string", minLength: 1 });
  expect(item.properties.candidate_priority.enum).toEqual(["high", "normal", "low"]);
  expect(item.required).toEqual(expect.arrayContaining(["target", "candidate_priority", "candidate_disposition"]));
  expect(item.required).toContain("apply_payload");
  expect(item.properties.target_page).toBeUndefined();
  expect(item.properties.target_entry_id).toBeUndefined();
  expect(item.properties.proposed_entry_id).toBeUndefined();
});

test("maintenance schema includes source refs, lookup dependencies, and explicit no-op decisions", () => {
  const schema = buildProjectMemoryCuratorOutputSchema({
    projectKey: "demo",
    mode: "maintain",
    runDir: "projects/demo/runs/project-learn/run-2",
    packetSchemaVersion: 1,
  }) as Record<string, any>;
  const item = schema.$defs.maintenanceItem;
  const noop = schema.$defs.explicitNoopDecision;

  expect(item.properties.source_packet_refs.items.$ref).toBe("#/$defs/evidenceRef");
  expect(item.properties.evidence_refs.items.$ref).toBe("#/$defs/evidenceRef");
  expect(item.properties.evidence_dependencies.items.$ref).toBe("#/$defs/evidenceDependency");
  expect(schema.$defs.evidenceDependency.required).toEqual([
    "kind",
    "ref",
    "required_for",
    "minimum_quality",
    "minimum_freshness",
  ]);
  expect(noop.properties.source_packet_refs.items.$ref).toBe("#/$defs/evidenceDependency");
  expect(noop.properties.checked_existing_memory_refs.items.$ref).toBe("#/$defs/evidenceDependency");
  expect(noop.properties.reason.enum).toContain("duplicate_or_superseded");
  expect(noop.properties.reason.enum).not.toContain("insufficient_evidence");
});

test("curator output schemas are strict structured-output objects", () => {
  for (const mode of ["create", "maintain"] as const) {
    const schema = buildProjectMemoryCuratorOutputSchema({
      projectKey: "demo",
      mode,
      runDir: "projects/demo/runs/project-learn/run",
      packetSchemaVersion: 1,
    }) as Record<string, any>;

    expect(schema.type).toBe("object");
    expect(schema.anyOf).toBeUndefined();
    expectStrictObjectsRequireEveryProperty(schema);
    expectEveryConstHasType(schema);
    expectNoUnsupportedRegexLookaround(schema);
  }
});

function expectStrictObjectsRequireEveryProperty(schema: any): void {
  if (!schema || typeof schema !== "object") return;
  if (schema.type === "object" && schema.properties) {
    expect(schema.additionalProperties).toBe(false);
    expect([...(schema.required ?? [])].sort()).toEqual(Object.keys(schema.properties).sort());
  }
  for (const value of Object.values(schema.properties ?? {})) expectStrictObjectsRequireEveryProperty(value);
  for (const value of Object.values(schema.$defs ?? {})) expectStrictObjectsRequireEveryProperty(value);
  if (schema.items) expectStrictObjectsRequireEveryProperty(schema.items);
  for (const value of schema.anyOf ?? []) expectStrictObjectsRequireEveryProperty(value);
}

function expectEveryConstHasType(schema: any): void {
  if (!schema || typeof schema !== "object") return;
  if ("const" in schema) expect(schema.type).toBeDefined();
  for (const value of Object.values(schema.properties ?? {})) expectEveryConstHasType(value);
  for (const value of Object.values(schema.$defs ?? {})) expectEveryConstHasType(value);
  if (schema.items) expectEveryConstHasType(schema.items);
  for (const value of schema.anyOf ?? []) expectEveryConstHasType(value);
}

function expectNoUnsupportedRegexLookaround(schema: any): void {
  if (!schema || typeof schema !== "object") return;
  if (typeof schema.pattern === "string") expect(schema.pattern).not.toContain("(?");
  for (const value of Object.values(schema.properties ?? {})) expectNoUnsupportedRegexLookaround(value);
  for (const value of Object.values(schema.$defs ?? {})) expectNoUnsupportedRegexLookaround(value);
  if (schema.items) expectNoUnsupportedRegexLookaround(schema.items);
  for (const value of schema.anyOf ?? []) expectNoUnsupportedRegexLookaround(value);
}
