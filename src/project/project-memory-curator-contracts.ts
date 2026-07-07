import type { ProcessRunner } from "../runtime/llm-client.ts";
import type { Provider } from "../runtime/config.ts";
import type { ProjectMemoryApplyPayload } from "./project-memory-apply-contracts.ts";
import type { ProjectMemoryDocumentationContract } from "./project-memory-orientation-contract.ts";
import type { ProjectMemoryPacket } from "./project-memory-packet.ts";
import type {
  ExplicitNoOpDecision,
  ProjectMemoryEvidenceDependency,
  ProjectMemoryExplicitNoOpDisposition,
} from "./project-memory-retrieval-contracts.ts";
import type {
  ProjectMemoryAnswerDomain,
  ProjectMemoryCandidateDisposition,
  ProjectMemoryQualityDiagnostics,
} from "./project-memory-quality-contract.ts";
export {
  PROJECT_MEMORY_ANSWER_DOMAINS,
  PROJECT_MEMORY_CANDIDATE_DISPOSITIONS,
  PROJECT_MEMORY_CONTENT_QUALITY_STATUSES,
  PROJECT_MEMORY_DOCUMENTATION_ROLES,
  PROJECT_MEMORY_RETRIEVAL_READINESS_STATUSES,
} from "./project-memory-quality-contract.ts";

export type {
  ProjectMemoryDocumentationContract,
  ProjectMemoryOrientationSurface,
  ProjectMemoryOrientationSurfaceDiagnostic,
} from "./project-memory-orientation-contract.ts";

export type {
  ProjectMemoryAnswerDomain,
  ProjectMemoryAnswerDomainCoverage,
  ProjectMemoryCandidateDisposition,
  ProjectMemoryContentQualityStatus,
  ProjectMemoryDocumentationRole,
  ProjectMemoryQualityDiagnostics,
  ProjectMemoryRetrievalReadinessStatus,
  ProjectMemoryRoleCoverage,
} from "./project-memory-quality-contract.ts";
import type { ProjectMemoryLeadPriority } from "./project-memory-producer-boundary.ts";

export const PROJECT_MEMORY_CURATOR_MODES = ["create", "maintain"] as const;

export const PROJECT_MEMORY_MAINTENANCE_OPERATIONS = [
  "PATCH_SECTION",
  "CREATE_SECTION",
  "CREATE_PAGE",
  "ATTACH_EVIDENCE",
  "MARK_STALE",
  "MARK_DISPUTED",
  "NOOP",
] as const;

export const PROJECT_MEMORY_LEGACY_MAINTENANCE_OPERATIONS = [
  "CREATE_ENTRY",
  "PATCH_ENTRY",
  "SUPERSEDE_ENTRY",
  "RETRACT_ENTRY",
] as const;

export const PROJECT_MEMORY_VALIDATION_OUTCOMES = ["eligible", "rejected", "quarantined", "noop"] as const;

export const PROJECT_MEMORY_LIFECYCLE_INTENTS = [
  "active",
  "stale_pending",
  "disputed",
  "superseded",
  "retracted",
] as const;

export const PROJECT_MEMORY_VALIDATOR_ISSUE_CATEGORIES = [
  "schema",
  "mode",
  "project_key",
  "packet_ref",
  "operation",
  "path",
  "evidence",
  "provenance",
  "repo_citation",
  "lifecycle",
  "risk",
  "budget",
  "degraded_context",
  "lookup_dependency",
  "explicit_noop",
  "protected_state",
  "provider",
] as const;

export const PROJECT_MEMORY_CURATOR_BUDGET_KEYS = ["max_items", "max_content_chars"] as const;

export const PROJECT_MEMORY_CURATOR_RUN_STATUSES = [
  "completed",
  "completed_with_pending_index",
  "failed",
  "needs_review",
] as const;

export const PROJECT_MEMORY_CURATOR_OUTPUT_CONTRACT_ARTIFACT = "curator-output-contract.json" as const;
export const PROJECT_MEMORY_CREATION_MIN_PAGES = 4 as const;

export type ProjectMemoryCuratorMode = (typeof PROJECT_MEMORY_CURATOR_MODES)[number];

export type ProjectMemoryTrustStatus = "uncurated" | "shallow" | "blocked" | "review_only" | "curated";

export type ProjectMemoryCreateTerminalState = {
  schema_version: 1;
  status: ProjectMemoryTrustStatus;
  quality_contract_version: "answer-domain-v1";
  latest_create_run_ref: string;
  evidence_map_ref?: "project-memory-evidence-map.json";
  validation_diagnostics_ref?: "curator-validation.json";
  usefulness_critique_ref?: "project-memory-usefulness-critique.json";
  terminal_reason: string;
  updated_at: string;
};

export type ProjectMemoryEvidenceKind =
  | "project_handoff"
  | "project_candidate"
  | "session_memory"
  | "wiki_page"
  | "lookup_result"
  | "project_state"
  | "repo_citation"
  | "inference";

export type ProjectMemoryEvidenceRef = {
  kind: ProjectMemoryEvidenceKind;
  ref: string;
  note?: string;
};

export type ProjectMemoryRepoCitation = {
  path: string;
  line_start?: number;
  line_end?: number;
  reason: string;
};

export type ProjectMemoryPathKind = "existing_wiki_page" | "new_wiki_page" | "project_state" | "run_artifact";

export type ProjectMemoryPathRef = {
  path: string;
  path_kind: ProjectMemoryPathKind;
};

export type ProjectMemoryRisk = {
  level: "low" | "medium" | "high";
  reasons: string[];
  requires_quarantine: boolean;
};

export type ProjectMemoryValidatorIssueCategory = (typeof PROJECT_MEMORY_VALIDATOR_ISSUE_CATEGORIES)[number];

export type ProjectMemoryValidationFinding = {
  severity: "info" | "warn" | "blocker";
  category: ProjectMemoryValidatorIssueCategory;
  code: string;
  item_id?: string;
  message: string;
  evidence_refs?: ProjectMemoryEvidenceRef[];
};

export type ProjectMemoryCuratorBudgetKey = (typeof PROJECT_MEMORY_CURATOR_BUDGET_KEYS)[number];

export type ProjectMemoryCuratorBudget = Partial<Record<ProjectMemoryCuratorBudgetKey, number>>;

export type ProjectMemoryCuratorPacketContext = {
  degraded: boolean;
  degraded_reasons: string[];
  budgets: ProjectMemoryCuratorBudget;
};

export type ProjectMemoryCuratorEnvelope = {
  schema_version: 1;
  project_key: string;
  mode: ProjectMemoryCuratorMode;
  packet_ref: {
    run_dir: string;
    artifact: "input-packet.json";
    packet_schema_version: ProjectMemoryPacket["schema_version"];
  };
  packet_context: ProjectMemoryCuratorPacketContext;
  summary: string;
  explicit_noop_decisions?: ExplicitNoOpDecision[];
};

export type ProjectMemoryCreationDraft = ProjectMemoryCuratorEnvelope & {
  mode: "create";
  quality_diagnostics: ProjectMemoryQualityDiagnostics;
  documentation_contract: ProjectMemoryDocumentationContract;
  brain_intent: {
    name: string;
    first_brain_summary: string;
    untrusted_existing_markdown_policy: "adopt" | "rewrite" | "ignore" | "quarantine_mixed";
  };
  pages: ProjectMemoryCreationPageDraft[];
  state_intent: {
    mark_project_memory_curated: boolean;
    freshness_intent: "initialize" | "leave_degraded";
  };
  evidence_refs: ProjectMemoryEvidenceRef[];
  repo_citations: ProjectMemoryRepoCitation[];
  risk: ProjectMemoryRisk;
};

export type ProjectMemoryCreationPageDraft = {
  id: string;
  target: ProjectMemoryPathRef;
  title: string;
  purpose: string;
  answer_domains: ProjectMemoryAnswerDomain[];
  required_topics: string[];
  representative_questions: string[];
  content_intent: string;
  apply_payload?: ProjectMemoryApplyPayload;
  inspected_surface_refs: string[];
  evidence_refs: ProjectMemoryEvidenceRef[];
  repo_citations: ProjectMemoryRepoCitation[];
  notes_for_apply: string[];
};

export type ProjectMemoryMaintenanceOperation =
  | (typeof PROJECT_MEMORY_MAINTENANCE_OPERATIONS)[number]
  | (typeof PROJECT_MEMORY_LEGACY_MAINTENANCE_OPERATIONS)[number];

export type ProjectMemorySectionTarget = {
  target_kind: "existing_section" | "new_section_in_existing_page" | "new_page";
  wiki_path: string;
  section_id?: string;
  expected_section_hash?: string;
  heading_path?: string[];
  ownership_reason: string;
};

export type ProjectMemoryMaintenanceProposal = ProjectMemoryCuratorEnvelope & {
  mode: "maintain";
  quality_diagnostics: ProjectMemoryQualityDiagnostics;
  items: ProjectMemoryMaintenanceProposalItem[];
  noop_inputs: ProjectMemoryNoopInput[];
  risk: ProjectMemoryRisk;
};

export type ProjectMemoryLifecycleIntent = (typeof PROJECT_MEMORY_LIFECYCLE_INTENTS)[number];

export type ProjectMemoryMaintenanceProposalItem = {
  id: string;
  operation: ProjectMemoryMaintenanceOperation;
  target: ProjectMemorySectionTarget;
  candidate_priority: ProjectMemoryLeadPriority;
  candidate_disposition: ProjectMemoryCandidateDisposition;
  missing_coverage_diagnostic?: string;
  target_page?: ProjectMemoryPathRef;
  target_entry_id?: string;
  proposed_entry_id?: string;
  content_intent: string;
  apply_payload?: ProjectMemoryApplyPayload;
  source_packet_refs: ProjectMemoryEvidenceRef[];
  evidence_refs: ProjectMemoryEvidenceRef[];
  evidence_dependencies?: ProjectMemoryEvidenceDependency[];
  repo_citations: ProjectMemoryRepoCitation[];
  inference?: {
    label: string;
    why_direct_repo_evidence_is_unavailable: string;
  };
  applicability: {
    branches?: string[];
    repo_paths?: string[];
    commands?: string[];
    notes?: string;
  };
  lifecycle_intent: ProjectMemoryLifecycleIntent;
  risk: ProjectMemoryRisk;
  preconditions: string[];
  expected_outcome: string;
};

export type ProjectMemoryNoopInput = {
  source_packet_ref: ProjectMemoryEvidenceRef;
  reason: ProjectMemoryExplicitNoOpDisposition;
  notes: string;
};

export type ProjectMemoryCuratorOutput = ProjectMemoryCreationDraft | ProjectMemoryMaintenanceProposal;

export type ProjectMemoryValidationOutcome = (typeof PROJECT_MEMORY_VALIDATION_OUTCOMES)[number];

export type ProjectMemoryItemValidation = {
  item_id: string;
  outcome: ProjectMemoryValidationOutcome;
  findings: ProjectMemoryValidationFinding[];
};

export type ProjectMemoryCuratorValidationResult = {
  ok: boolean;
  mode: ProjectMemoryCuratorMode;
  project_key: string;
  quality_diagnostics?: ProjectMemoryQualityDiagnostics;
  global_findings: ProjectMemoryValidationFinding[];
  item_results: ProjectMemoryItemValidation[];
  eligible_item_ids: string[];
  rejected_item_ids: string[];
  quarantined_item_ids: string[];
  noop_refs: string[];
};

export type RunProjectMemoryCuratorInput = {
  projectKey: string;
  dryRun: boolean;
  review: boolean;
  provider?: Provider;
  modelOverride?: string;
  env?: NodeJS.ProcessEnv;
  runner?: ProcessRunner;
  now?: Date;
  recreate?: boolean;
};

export type ProjectMemoryCuratorRunStatus = (typeof PROJECT_MEMORY_CURATOR_RUN_STATUSES)[number];

export type ProjectMemoryCuratorRunResult = {
  status: ProjectMemoryCuratorRunStatus;
  project_key: string;
  mode: ProjectMemoryCuratorMode;
  run_id: string;
  run_dir: string;
  content_quality_status?: ProjectMemoryQualityDiagnostics["content_quality"]["status"];
  retrieval_readiness_status?: ProjectMemoryQualityDiagnostics["retrieval_readiness"]["status"];
  quality_diagnostics_ref?: "curator-validation.json";
  artifacts: {
    input_packet: string;
    curator_output: string;
    curator_output_contract?: typeof PROJECT_MEMORY_CURATOR_OUTPUT_CONTRACT_ARTIFACT;
    curator_validation: string;
    curator_run_result: string;
    summary: string;
    prompt_budget?: "prompt-budget.json";
    evidence_map?: "project-memory-evidence-map.json";
    runtime_inbox_intake?: "runtime-inbox-intake.json";
    apply_journal?: "project-memory-apply-journal.json";
    apply_result?: "project-memory-apply-result.json";
    changeset?: "project-memory-changeset.json";
    retrieval_sections?: "project-memory-retrieval-sections.json";
    hint_generation?: "project-memory-hint-generation-result.json";
    retrieval_index_result?: "project-memory-retrieval-index-result.json";
    usefulness_critique?: "project-memory-usefulness-critique.json";
    subject_manifest?: "reports/documentation-subject-manifest.json";
    planner_report?: "reports/documentation-planner-report.json";
    subject_reports?: string[];
    maintenance_report?: "reports/documentation-maintenance-report.json";
    file_authoring_runs?: string[];
    pre_maintenance_wiki?: "pre-maintenance-wiki";
  };
  curation_kind?: "agent_authored" | "human_reviewed";
  run_kind?: "create" | "maintenance" | "create_then_maintenance" | "recreate";
  validation_ok: boolean;
  stopped_before_writes: boolean;
  dry_run: boolean;
  review: boolean;
  applied_page_ids?: string[];
  applied_item_ids?: string[];
  changed_files?: string[];
  source_consumptions?: string[];
  stopped_reason?: string;
  failure_kind?: "provider_failed_before_output" | "curator_output_invalid_json";
};
