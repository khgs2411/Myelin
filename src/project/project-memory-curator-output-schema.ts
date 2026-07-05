import {
  PROJECT_MEMORY_LIFECYCLE_INTENTS,
  PROJECT_MEMORY_MAINTENANCE_OPERATIONS,
  PROJECT_MEMORY_CREATION_MIN_PAGES,
  type ProjectMemoryCuratorMode,
} from "./project-memory-curator-contracts.ts";
import {
  PROJECT_MEMORY_LOOKUP_FRESHNESS_VALUES,
  PROJECT_MEMORY_LOOKUP_QUALITIES,
} from "./project-memory-retrieval-contracts.ts";
import {
  PROJECT_MEMORY_CANDIDATE_DISPOSITIONS,
  PROJECT_MEMORY_CONTENT_QUALITY_STATUSES,
  PROJECT_MEMORY_ANSWER_DOMAINS,
  PROJECT_MEMORY_RETRIEVAL_READINESS_STATUSES,
} from "./project-memory-quality-contract.ts";

type JsonSchema = Record<string, unknown>;

export type ProjectMemoryCuratorOutputSchemaInput = {
  projectKey: string;
  mode: ProjectMemoryCuratorMode;
  runDir: string;
  packetSchemaVersion: 1;
};

const WIKI_MARKDOWN_PATH_PATTERN = "^([A-Za-z0-9_-][A-Za-z0-9_.-]*/)*[A-Za-z0-9_-][A-Za-z0-9_.-]*\\.md$";

export function buildProjectMemoryCuratorOutputSchema(input: ProjectMemoryCuratorOutputSchemaInput): JsonSchema {
  return input.mode === "create" ? creationSchema(input) : maintenanceSchema(input);
}

function creationSchema(input: ProjectMemoryCuratorOutputSchemaInput): JsonSchema {
  return objectSchema({
    schema_version: constNumber(1),
    project_key: constString(input.projectKey),
    mode: constString("create"),
    packet_ref: packetRefSchema(input),
    packet_context: { $ref: "#/$defs/packetContext" },
    summary: stringSchema(),
    explicit_noop_decisions: arrayOf({ $ref: "#/$defs/explicitNoopDecision" }),
    quality_diagnostics: { $ref: "#/$defs/qualityDiagnostics" },
    documentation_contract: { $ref: "#/$defs/documentationContract" },
    brain_intent: objectSchema({
      name: stringSchema(),
      first_brain_summary: stringSchema(),
      untrusted_existing_markdown_policy: {
        type: "string",
        enum: ["adopt", "rewrite", "ignore", "quarantine_mixed"],
      },
    }, ["name", "first_brain_summary", "untrusted_existing_markdown_policy"]),
    pages: arrayOf({ $ref: "#/$defs/creationPageDraft" }, PROJECT_MEMORY_CREATION_MIN_PAGES),
    state_intent: objectSchema({
      mark_project_memory_curated: { type: "boolean" },
      freshness_intent: { type: "string", enum: ["initialize", "leave_degraded"] },
    }, ["mark_project_memory_curated", "freshness_intent"]),
    evidence_refs: arrayOf({ $ref: "#/$defs/evidenceRef" }, 1),
    repo_citations: arrayOf({ $ref: "#/$defs/repoCitation" }),
    risk: { $ref: "#/$defs/risk" },
  }, [
    "schema_version",
    "project_key",
    "mode",
    "packet_ref",
    "packet_context",
    "summary",
    "explicit_noop_decisions",
    "quality_diagnostics",
    "documentation_contract",
    "brain_intent",
    "pages",
    "state_intent",
    "evidence_refs",
    "repo_citations",
    "risk",
  ], {
    $defs: commonDefs({
      creationPageDraft: objectSchema({
        id: stringSchema(),
        target: wikiTargetSchema(["new_wiki_page", "existing_wiki_page"]),
        title: stringSchema(),
        purpose: stringSchema(),
        answer_domains: arrayOf({ type: "string", enum: [...PROJECT_MEMORY_ANSWER_DOMAINS] }, 1),
        required_topics: stringArraySchema(1),
        representative_questions: stringArraySchema(1),
        content_intent: stringSchema(),
        apply_payload: applyPayloadSchema("create"),
        inspected_surface_refs: stringArraySchema(1),
        evidence_refs: arrayOf({ $ref: "#/$defs/evidenceRef" }, 1),
        repo_citations: arrayOf({ $ref: "#/$defs/repoCitation" }, 1),
        notes_for_apply: stringArraySchema(),
      }, [
        "id",
        "target",
        "title",
        "purpose",
        "answer_domains",
        "required_topics",
        "representative_questions",
        "content_intent",
        "apply_payload",
        "inspected_surface_refs",
        "evidence_refs",
        "repo_citations",
        "notes_for_apply",
      ]),
    }, { pageRepoCitationsMinItems: 1 }),
  });
}

function maintenanceSchema(input: ProjectMemoryCuratorOutputSchemaInput): JsonSchema {
  return objectSchema({
    schema_version: constNumber(1),
    project_key: constString(input.projectKey),
    mode: constString("maintain"),
    packet_ref: packetRefSchema(input),
    packet_context: { $ref: "#/$defs/packetContext" },
    summary: stringSchema(),
    explicit_noop_decisions: arrayOf({ $ref: "#/$defs/explicitNoopDecision" }),
    quality_diagnostics: { $ref: "#/$defs/qualityDiagnostics" },
    items: arrayOf({ $ref: "#/$defs/maintenanceItem" }),
    noop_inputs: arrayOf({ $ref: "#/$defs/noopInput" }),
    risk: { $ref: "#/$defs/risk" },
  }, [
    "schema_version",
    "project_key",
    "mode",
    "packet_ref",
    "packet_context",
    "summary",
    "explicit_noop_decisions",
    "quality_diagnostics",
    "items",
    "noop_inputs",
    "risk",
  ], {
    $defs: commonDefs({
      maintenanceItem: objectSchema({
        id: stringSchema(),
        operation: { type: "string", enum: [...PROJECT_MEMORY_MAINTENANCE_OPERATIONS] },
        target: { $ref: "#/$defs/sectionTarget" },
        candidate_priority: { type: "string", enum: ["high", "normal", "low"] },
        candidate_disposition: { type: "string", enum: [...PROJECT_MEMORY_CANDIDATE_DISPOSITIONS] },
        missing_coverage_diagnostic: nullable(stringSchema()),
        content_intent: stringSchema(),
        apply_payload: applyPayloadSchema("maintain"),
        source_packet_refs: arrayOf({ $ref: "#/$defs/evidenceRef" }, 1),
        evidence_refs: arrayOf({ $ref: "#/$defs/evidenceRef" }, 1),
        evidence_dependencies: arrayOf({ $ref: "#/$defs/evidenceDependency" }),
        repo_citations: arrayOf({ $ref: "#/$defs/repoCitation" }),
        inference: nullable({ $ref: "#/$defs/inference" }),
        applicability: { $ref: "#/$defs/applicability" },
        lifecycle_intent: { type: "string", enum: [...PROJECT_MEMORY_LIFECYCLE_INTENTS] },
        risk: { $ref: "#/$defs/risk" },
        preconditions: stringArraySchema(),
        expected_outcome: stringSchema(),
      }, [
        "id",
        "operation",
        "target",
        "candidate_priority",
        "candidate_disposition",
        "missing_coverage_diagnostic",
        "content_intent",
        "apply_payload",
        "source_packet_refs",
        "evidence_refs",
        "evidence_dependencies",
        "repo_citations",
        "inference",
        "applicability",
        "lifecycle_intent",
        "risk",
        "preconditions",
        "expected_outcome",
      ]),
      sectionTarget: objectSchema({
        target_kind: { type: "string", enum: ["existing_section", "new_section_in_existing_page", "new_page"] },
        wiki_path: wikiPathSchema(),
        section_id: nullable(stringSchema()),
        expected_section_hash: stringSchema(),
        heading_path: stringArraySchema(),
        ownership_reason: stringSchema(),
      }, ["target_kind", "wiki_path", "section_id", "expected_section_hash", "heading_path", "ownership_reason"]),
      noopInput: objectSchema({
        source_packet_ref: { $ref: "#/$defs/evidenceRef" },
        reason: {
          type: "string",
          enum: ["already_trusted", "not_durable", "belongs_to_other_layer", "insufficient_evidence"],
        },
        notes: stringSchema(),
      }, ["source_packet_ref", "reason", "notes"]),
    }),
  });
}

function commonDefs(
  extra: Record<string, JsonSchema>,
  options: { pageRepoCitationsMinItems?: number } = {},
): Record<string, JsonSchema> {
  const pageRepoCitationsMinItems = options.pageRepoCitationsMinItems ?? 0;
  return {
    packetContext: objectSchema({
      degraded: { type: "boolean" },
      degraded_reasons: stringArraySchema(),
      budgets: {
        type: "object",
        additionalProperties: false,
        required: ["max_items", "max_content_chars"],
        properties: {
          max_items: nullable({ type: "number" }),
          max_content_chars: nullable({ type: "number" }),
        },
      },
    }, ["degraded", "degraded_reasons", "budgets"]),
    evidenceRef: objectSchema({
      kind: {
        type: "string",
        enum: [
          "project_handoff",
          "project_candidate",
          "session_memory",
          "wiki_page",
          "lookup_result",
          "project_state",
          "repo_citation",
          "inference",
        ],
      },
      ref: stringSchema(),
      note: nullable(stringSchema()),
    }, ["kind", "ref", "note"]),
    evidenceDependency: objectSchema({
      kind: {
        type: "string",
        enum: ["lookup_result", "canonical_section", "project_candidate", "project_handoff", "session_memory", "repo_citation"],
      },
      ref: stringSchema(),
      required_for: {
        type: "string",
        enum: ["target_selection", "dedupe", "supersession", "conflict_check", "content_support", "noop_support"],
      },
      minimum_quality: nullable({ type: "string", enum: [...PROJECT_MEMORY_LOOKUP_QUALITIES] }),
      minimum_freshness: nullable({ type: "string", enum: [...PROJECT_MEMORY_LOOKUP_FRESHNESS_VALUES] }),
    }, ["kind", "ref", "required_for", "minimum_quality", "minimum_freshness"]),
    explicitNoopDecision: objectSchema({
      id: stringSchema(),
      source_packet_refs: arrayOf({ $ref: "#/$defs/evidenceDependency" }, 1),
      checked_existing_memory_refs: arrayOf({ $ref: "#/$defs/evidenceDependency" }, 1),
      reason: {
        type: "string",
        enum: ["already_trusted", "not_durable", "belongs_to_other_layer", "duplicate_or_superseded"],
      },
      explanation: stringSchema(),
    }, ["id", "source_packet_refs", "checked_existing_memory_refs", "reason", "explanation"]),
    qualityDiagnostics: objectSchema({
      schema_version: constNumber(1),
      content_quality: objectSchema({
        status: { type: "string", enum: [...PROJECT_MEMORY_CONTENT_QUALITY_STATUSES] },
        reasons: stringArraySchema(),
      }, ["status", "reasons"]),
      retrieval_readiness: objectSchema({
        status: { type: "string", enum: [...PROJECT_MEMORY_RETRIEVAL_READINESS_STATUSES] },
        reason: nullable(stringSchema()),
      }, ["status", "reason"]),
      domain_coverage: arrayOf(objectSchema({
        domain: { type: "string", enum: [...PROJECT_MEMORY_ANSWER_DOMAINS] },
        page_refs: stringArraySchema(),
        section_refs: stringArraySchema(),
        representative_questions: stringArraySchema(),
        citations_seen: { type: "number" },
        body_chars_seen: { type: "number" },
        missing_topics: stringArraySchema(),
      }, ["domain", "page_refs", "section_refs", "representative_questions", "citations_seen", "body_chars_seen", "missing_topics"])),
      candidate_dispositions: arrayOf(objectSchema({
        source_ref: stringSchema(),
        disposition: { type: "string", enum: [...PROJECT_MEMORY_CANDIDATE_DISPOSITIONS] },
        reason: stringSchema(),
      }, ["source_ref", "disposition", "reason"])),
      missing_coverage: stringArraySchema(),
      shallow_summary_findings: stringArraySchema(),
      answerability_findings: stringArraySchema(),
    }, [
      "schema_version",
      "content_quality",
      "retrieval_readiness",
      "domain_coverage",
      "candidate_dispositions",
      "missing_coverage",
      "shallow_summary_findings",
      "answerability_findings",
    ]),
    documentationContract: objectSchema({
      inspected_default_surfaces: stringArraySchema(),
      curator_added_surfaces: arrayOf(objectSchema({
        path: stringSchema(),
        reason: stringSchema(),
      }, ["path", "reason"])),
      missing_orientation_surfaces: arrayOf(objectSchema({
        path: stringSchema(),
        reason: { type: "string", enum: ["not_present", "present_not_inspected"] },
      }, ["path", "reason"])),
      missing_coverage: stringArraySchema(),
      shallow_summary_findings: stringArraySchema(),
    }, [
      "inspected_default_surfaces",
      "curator_added_surfaces",
      "missing_orientation_surfaces",
      "missing_coverage",
      "shallow_summary_findings",
    ]),
    repoCitation: objectSchema({
      path: stringSchema(),
      line_start: nullable({ type: "number" }),
      line_end: nullable({ type: "number" }),
      reason: stringSchema(),
    }, ["path", "line_start", "line_end", "reason"]),
    risk: objectSchema({
      level: { type: "string", enum: ["low", "medium", "high"] },
      reasons: stringArraySchema(),
      requires_quarantine: { type: "boolean" },
    }, ["level", "reasons", "requires_quarantine"]),
    markdownLines: objectSchema({
      paragraphs: stringArraySchema(1),
      bullets: stringArraySchema(),
      warnings: stringArraySchema(),
    }, ["paragraphs", "bullets", "warnings"]),
    inference: objectSchema({
      label: stringSchema(),
      basis: nullable(stringSchema()),
      why_direct_repo_evidence_is_unavailable: stringSchema(),
    }, ["label", "basis", "why_direct_repo_evidence_is_unavailable"]),
    applicability: objectSchema({
      branches: stringArraySchema(),
      repo_paths: stringArraySchema(),
      commands: stringArraySchema(),
      notes: nullable(stringSchema()),
    }, ["branches", "repo_paths", "commands", "notes"]),
    pageDraft: objectSchema({
      page_path: wikiPathSchema(),
      title: stringSchema(),
      purpose: stringSchema(),
      sections: arrayOf({ $ref: "#/$defs/pageSectionDraft" }, 1),
      evidence_refs: arrayOf({ $ref: "#/$defs/evidenceRef" }, 1),
      repo_citations: arrayOf({ $ref: "#/$defs/repoCitation" }, pageRepoCitationsMinItems),
      inference: nullable({ $ref: "#/$defs/inference" }),
    }, ["page_path", "title", "purpose", "sections", "evidence_refs", "repo_citations", "inference"]),
    pageSectionDraft: objectSchema({
      heading: stringSchema(),
      level: { type: "number" },
      body: { $ref: "#/$defs/markdownLines" },
      evidence_refs: arrayOf({ $ref: "#/$defs/evidenceRef" }, 1),
      repo_citations: arrayOf({ $ref: "#/$defs/repoCitation" }, 1),
      inference: nullable({ $ref: "#/$defs/inference" }),
    }, ["heading", "level", "body", "evidence_refs", "repo_citations", "inference"]),
    entryDraft: objectSchema({
      entry_id: stringSchema(),
      title: stringSchema(),
      body: { $ref: "#/$defs/markdownLines" },
      lifecycle: { type: "string", enum: [...PROJECT_MEMORY_LIFECYCLE_INTENTS] },
      evidence_refs: arrayOf({ $ref: "#/$defs/evidenceRef" }, 1),
      repo_citations: arrayOf({ $ref: "#/$defs/repoCitation" }),
      inference: nullable({ $ref: "#/$defs/inference" }),
      applicability: { $ref: "#/$defs/applicability" },
    }, ["entry_id", "title", "body", "lifecycle", "evidence_refs", "repo_citations", "inference", "applicability"]),
    sectionDraft: objectSchema({
      heading: stringSchema(),
      level: { type: "number" },
      body: { $ref: "#/$defs/markdownLines" },
      evidence_refs: arrayOf({ $ref: "#/$defs/evidenceRef" }, 1),
      repo_citations: arrayOf({ $ref: "#/$defs/repoCitation" }),
      inference: nullable({ $ref: "#/$defs/inference" }),
    }, ["heading", "level", "body", "evidence_refs", "repo_citations", "inference"]),
    ...extra,
  };
}

function packetRefSchema(input: ProjectMemoryCuratorOutputSchemaInput): JsonSchema {
  return objectSchema({
    run_dir: constString(input.runDir),
    artifact: constString("input-packet.json"),
    packet_schema_version: constNumber(input.packetSchemaVersion),
  }, ["run_dir", "artifact", "packet_schema_version"]);
}

function applyPayloadSchema(mode: ProjectMemoryCuratorMode): JsonSchema {
  if (mode === "create") {
    return objectSchema(
      { schema_version: constNumber(1), pages: arrayOf({ $ref: "#/$defs/pageDraft" }, 1, 1) },
      ["schema_version", "pages"],
    );
  }
  return objectSchema(
    { schema_version: constNumber(1), entries: arrayOf({ $ref: "#/$defs/entryDraft" }), section: nullable({ $ref: "#/$defs/sectionDraft" }), page: nullable({ $ref: "#/$defs/pageDraft" }) },
    ["schema_version", "entries", "section", "page"],
  );
}

function wikiTargetSchema(pathKinds: string[]): JsonSchema {
  return objectSchema({
    path: wikiPathSchema(),
    path_kind: { type: "string", enum: pathKinds },
  }, ["path", "path_kind"]);
}

function wikiPathSchema(): JsonSchema {
  return { type: "string", minLength: 1, pattern: WIKI_MARKDOWN_PATH_PATTERN };
}

function stringSchema(): JsonSchema {
  return { type: "string", minLength: 1 };
}

function constString(value: string): JsonSchema {
  return { type: "string", const: value };
}

function constNumber(value: number): JsonSchema {
  return { type: "number", const: value };
}

function stringArraySchema(minItems = 0): JsonSchema {
  return arrayOf(stringSchema(), minItems);
}

function arrayOf(items: JsonSchema, minItems = 0, maxItems?: number): JsonSchema {
  return {
    type: "array",
    ...(minItems > 0 ? { minItems } : {}),
    ...(maxItems !== undefined ? { maxItems } : {}),
    items,
  };
}

function nullable(schema: JsonSchema): JsonSchema {
  return { anyOf: [schema, { type: "null" }] };
}

function objectSchema(
  properties: Record<string, JsonSchema>,
  required: string[],
  extra: Record<string, unknown> = {},
): JsonSchema {
  return {
    type: "object",
    additionalProperties: false,
    ...(required.length > 0 ? { required } : {}),
    properties,
    ...extra,
  };
}
