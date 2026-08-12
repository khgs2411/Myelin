import { createHash } from "node:crypto";
import type { Database } from "bun:sqlite";
import { stableJson } from "../runtime/json.ts";
import { readLatestCuratorBatchChannelPlan, readDurableCuratorAffectedWorkSet } from "./curator-channel-plan.ts";
import {
  evaluateCuratorBatchCoverage,
  evaluatePersistedCuratorBatchCoverage,
} from "./curator-retrieval-service.ts";
import type { CuratorMemoryRevisionIdentity } from "./curator-retrieval-types.ts";
import { readSMCManifest } from "./manifest.ts";
import { hasExactCuratorMemoryFetchReceipt } from "./curator-fetch-receipts.ts";
import { readAuditInheritedSourceRefs } from "./audit-provenance.ts";
import {
  SessionMaintenanceCandidateSchema,
  SessionMaintenanceHandoffSchema,
  SessionMaintenanceMemorySchema,
  SessionMaintenanceProjectionMemoryDispositionSchema,
  SessionMaintenanceSourceDispositionSchema,
  type SessionMaintenanceProjectionMemoryDisposition,
} from "./output-contract.ts";
import {
  stagedSMCRecordId,
  reconstructSMCOverlay,
  type SMCOverlayDeltaRecord,
} from "./overlay-store.ts";
import {
  parseSMCBatchProposal,
  type SMCBatchProposal,
  type SMCDispositionReceiptReuse,
  type SMCProposalOperation,
} from "./proposal-contract.ts";

export const SMC_PROPOSAL_VALIDATION_ISSUE_CODES = [
  "proposal_contract_invalid",
  "proposal_identity_mismatch",
  "proposal_overlay_revision_stale",
  "proposal_channel_coverage_incomplete",
  "duplicate_source_disposition",
  "missing_source_disposition",
  "source_outside_work_batch",
  "duplicate_memory_disposition",
  "missing_memory_disposition",
  "memory_outside_affected_work_set",
  "memory_revision_mismatch",
  "disposition_receipt_reuse_invalid",
  "duplicate_staged_operation",
  "staged_record_not_found",
  "stable_final_id_mismatch",
  "duplicate_output_id",
  "output_id_collision",
  "invalid_lifecycle_target",
  "duplicate_source_reference",
  "source_reference_outside_work_batch",
  "source_disposition_conflict",
  "output_reference_invalid",
  "output_reference_mismatch",
  "output_provenance_missing",
  "handoff_memory_reference_invalid",
] as const;

export type SMCProposalValidationIssueCode = (typeof SMC_PROPOSAL_VALIDATION_ISSUE_CODES)[number];

export type SMCProposalValidationIssue = Readonly<{
  code: SMCProposalValidationIssueCode;
  path: string;
  message: string;
}>;

export type ValidatedSMCBatchProposal = Readonly<{
  valid: true;
  job_id: string;
  project_key: string;
  work_batch_id: string;
  manifest_digest: string;
  snapshot_token: string;
  expected_overlay_revision: number;
  response_digest: `sha256:${string}`;
  delta_digest: `sha256:${string}`;
  records: readonly SMCOverlayDeltaRecord[];
  proposal: SMCBatchProposal;
  issues: readonly [];
}>;

export type SMCProposalValidationResult = ValidatedSMCBatchProposal | Readonly<{
  valid: false;
  issues: readonly SMCProposalValidationIssue[];
}>;

export type SMCProposalValidationInput = Readonly<{
  job_id: string;
  project_key: string;
  attempt_id: string;
  owner_epoch: number;
  manifest_digest: string;
  snapshot_token: string;
  proposal: unknown;
}>;

type ParsedSMCProposalValidationInput = Omit<SMCProposalValidationInput, "proposal"> & {
  proposal: SMCBatchProposal;
};

export function inspectSMCBatchProposal(
  db: Database,
  input: SMCProposalValidationInput,
): SMCProposalValidationResult {
  const issues: SMCProposalValidationIssue[] = [];
  let proposal: SMCBatchProposal;
  try {
    proposal = parseSMCBatchProposal(input.proposal);
  } catch (error) {
    add(issues, "proposal_contract_invalid", "proposal", message(error));
    return invalid(issues);
  }
  const parsedInput: ParsedSMCProposalValidationInput = { ...input, proposal };
  const manifest = readSMCManifest(db, parsedInput.job_id);
  if (!manifest
    || manifest.project_key !== parsedInput.project_key
    || manifest.manifest_digest !== parsedInput.manifest_digest
    || manifest.snapshot_token !== parsedInput.snapshot_token) {
    add(issues, "proposal_identity_mismatch", "$", "proposal does not match the immutable manifest identity");
    return invalid(issues);
  }
  const batch = db.query(
    "SELECT work_kind FROM smc_work_batches WHERE job_id = ? AND batch_id = ?",
  ).get(parsedInput.job_id, proposal.work_batch_id) as { work_kind: "evidence" | "audit" } | null;
  if (!batch) {
    add(issues, "proposal_identity_mismatch", "work_batch_id", "work batch does not belong to the anchor job");
    return invalid(issues);
  }
  const priorAcceptance = db.query(
    "SELECT 1 FROM smc_overlay_revisions WHERE job_id = ? AND work_batch_id = ? AND parent_revision = ?",
  ).get(parsedInput.job_id, proposal.work_batch_id, proposal.expected_overlay_revision);
  if (manifest.current_overlay_identity.revision !== proposal.expected_overlay_revision && !priorAcceptance) {
    add(issues, "proposal_overlay_revision_stale", "expected_overlay_revision", "proposal overlay revision is neither current nor an accepted batch parent");
  }
  let expectedOverlayDigest: string;
  try {
    expectedOverlayDigest = reconstructSMCOverlay(db, {
      job_id: parsedInput.job_id,
      revision: proposal.expected_overlay_revision,
    }).identity.digest;
  } catch (error) {
    add(issues, "proposal_overlay_revision_stale", "expected_overlay_revision", message(error));
    return invalid(issues);
  }
  const latestPlan = readLatestCuratorBatchChannelPlan(db, {
    job_id: parsedInput.job_id,
    work_batch_id: proposal.work_batch_id,
  });
  const workSet = readDurableCuratorAffectedWorkSet(db, {
    job_id: parsedInput.job_id,
    work_batch_id: proposal.work_batch_id,
  });
  if (!latestPlan || latestPlan.overlay_revision !== proposal.expected_overlay_revision
    || latestPlan.overlay_digest !== expectedOverlayDigest) {
    add(issues, "proposal_channel_coverage_incomplete", "$", "current batch has no complete channel plan for this overlay");
  } else {
    try {
      const coverage = priorAcceptance
        ? evaluatePersistedCuratorBatchCoverage(db, {
          job_id: parsedInput.job_id,
          work_batch_id: proposal.work_batch_id,
          overlay_revision: proposal.expected_overlay_revision,
        })
        : evaluateCuratorBatchCoverage(db, {
          job_id: parsedInput.job_id,
          project_key: parsedInput.project_key,
          work_batch_id: proposal.work_batch_id,
          attempt_id: parsedInput.attempt_id,
          owner_epoch: parsedInput.owner_epoch,
          manifest_digest: parsedInput.manifest_digest,
          snapshot_token: parsedInput.snapshot_token,
          overlay_revision: proposal.expected_overlay_revision,
        });
      if (!coverage.complete) {
        add(issues, "proposal_channel_coverage_incomplete", "$", `missing curator coverage: ${coverage.missing.join(", ")}`);
      }
    } catch (error) {
      add(issues, "proposal_channel_coverage_incomplete", "$", message(error));
    }
  }

  const selectedSourceIds = new Set((db.query(
    `SELECT source_id FROM smc_evidence_batch_members
     WHERE job_id = ? AND batch_id = ? ORDER BY ordinal`,
  ).all(parsedInput.job_id, proposal.work_batch_id) as Array<{ source_id: string }>).map((row) => row.source_id));
  validateSourceCoverage(proposal, selectedSourceIds, issues);

  const inheritedAuditSourceRefs = batch?.work_kind === "audit"
    ? readAuditInheritedSourceRefs(db, parsedInput.job_id, proposal.work_batch_id)
    : new Set<string>();
  const admittedProvenanceRefs = new Set([...selectedSourceIds, ...inheritedAuditSourceRefs]);

  const workById = new Map(workSet.map((member) => [member.stable_id, member.revision_identity]));
  const reused = new Map<string, SessionMaintenanceProjectionMemoryDisposition>();
  validateMemoryCoverage(db, parsedInput, batch?.work_kind ?? "evidence", workById, reused, issues);
  validateOperations(db, parsedInput, selectedSourceIds, admittedProvenanceRefs, batch?.work_kind ?? "evidence", issues);
  validateReferences(db, parsedInput, proposal, selectedSourceIds, admittedProvenanceRefs, reused, issues);
  if (batch?.work_kind === "audit") validateAuditFetchCoverage(db, manifest, proposal.work_batch_id, issues);

  if (issues.length > 0) return invalid(issues);
  const records = buildDeltaRecords(proposal, reused, batch?.work_kind ?? "evidence");
  validateProspectiveOverlay(db, parsedInput, records, admittedProvenanceRefs, issues);
  if (issues.length > 0) return invalid(issues);
  return {
    valid: true,
    job_id: parsedInput.job_id,
    project_key: parsedInput.project_key,
    work_batch_id: proposal.work_batch_id,
    manifest_digest: parsedInput.manifest_digest,
    snapshot_token: parsedInput.snapshot_token,
    expected_overlay_revision: proposal.expected_overlay_revision,
    response_digest: digest(proposal),
    delta_digest: digest(domainRecords(records)),
    records,
    proposal,
    issues: [],
  };
}

export function validateSMCBatchProposal(
  db: Database,
  input: SMCProposalValidationInput,
): ValidatedSMCBatchProposal {
  const result = inspectSMCBatchProposal(db, input);
  if (!result.valid) throw new SMCProposalValidationError(result.issues);
  return result;
}

export class SMCProposalValidationError extends Error {
  constructor(readonly issues: readonly SMCProposalValidationIssue[]) {
    super(issues.map((item) => `${item.code}:${item.path}`).join(";"));
    this.name = "SMCProposalValidationError";
  }
}

export function smcProposalDomainDeltaDigest(records: readonly SMCOverlayDeltaRecord[]): `sha256:${string}` {
  return digest(domainRecords(records));
}

function validateSourceCoverage(
  proposal: SMCBatchProposal,
  expected: ReadonlySet<string>,
  issues: SMCProposalValidationIssue[],
): void {
  const seen = new Set<string>();
  proposal.source_event_dispositions.forEach((item, index) => {
    const path = `source_event_dispositions[${index}].source_event_id`;
    if (seen.has(item.source_event_id)) add(issues, "duplicate_source_disposition", path, "duplicate source disposition");
    seen.add(item.source_event_id);
    if (!expected.has(item.source_event_id)) add(issues, "source_outside_work_batch", path, "source is outside the selected work batch");
  });
  for (const id of sorted(expected)) {
    if (!seen.has(id)) add(issues, "missing_source_disposition", "source_event_dispositions", `missing disposition for ${id}`);
  }
}

function validateMemoryCoverage(
  db: Database,
  input: ParsedSMCProposalValidationInput,
  workKind: "evidence" | "audit",
  workById: ReadonlyMap<string, CuratorMemoryRevisionIdentity>,
  reused: Map<string, SessionMaintenanceProjectionMemoryDisposition>,
  issues: SMCProposalValidationIssue[],
): void {
  const seen = new Set<string>();
  input.proposal.memory_dispositions.forEach((item, index) => {
    const path = `memory_dispositions[${index}]`;
    if (seen.has(item.memory_id)) add(issues, "duplicate_memory_disposition", `${path}.memory_id`, "duplicate memory disposition");
    seen.add(item.memory_id);
    const expected = workById.get(item.memory_id);
    if (!expected) add(issues, "memory_outside_affected_work_set", `${path}.memory_id`, "memory is outside the affected work set");
    else if (stableJson(expected) !== stableJson(item.revision_identity)) {
      add(issues, "memory_revision_mismatch", `${path}.revision_identity`, "memory revision identity is stale");
    }
  });
  input.proposal.disposition_receipt_reuses.forEach((reuse, index) => {
    const path = `disposition_receipt_reuses[${index}]`;
    if (seen.has(reuse.memory_id)) add(issues, "duplicate_memory_disposition", `${path}.memory_id`, "memory is covered more than once");
    seen.add(reuse.memory_id);
    const expected = workById.get(reuse.memory_id);
    if (!expected) add(issues, "memory_outside_affected_work_set", `${path}.memory_id`, "memory is outside the affected work set");
    else if (stableJson(expected) !== stableJson(reuse.revision_identity)) {
      add(issues, "memory_revision_mismatch", `${path}.revision_identity`, "receipt reuse revision identity is stale");
    }
    const disposition = workKind === "audit" ? null : resolveReceiptReuse(db, input, reuse);
    if (!disposition) add(issues, "disposition_receipt_reuse_invalid", path, "receipt reuse does not match an accepted same-revision disposition");
    else reused.set(reuse.memory_id, disposition);
  });
  for (const id of [...workById.keys()].sort(compareText)) {
    if (!seen.has(id)) add(issues, "missing_memory_disposition", "memory_dispositions", `missing disposition for ${id}`);
  }
}

function resolveReceiptReuse(
  db: Database,
  input: ParsedSMCProposalValidationInput,
  reuse: SMCDispositionReceiptReuse,
): SessionMaintenanceProjectionMemoryDisposition | null {
  const manifest = readSMCManifest(db, input.job_id)!;
  if (reuse.policy_identity !== manifest.governing_identities.policy.digest
    || reuse.output_contract_identity !== manifest.governing_identities.output_contract.digest
    || reuse.tool_protocol_identity !== manifest.governing_identities.tool_protocol.digest
    || stableJson(reuse.invocation_identity) !== stableJson(manifest.governing_identities.invocation)
    || reuse.accepted_overlay_revision > input.proposal.expected_overlay_revision) return null;
  const row = db.query(
    `SELECT r.payload_json, r.payload_digest, v.overlay_digest
     FROM smc_overlay_revisions v
     JOIN smc_overlay_records r ON r.job_id = v.job_id AND r.revision = v.revision
     WHERE v.job_id = ? AND v.work_batch_id = ? AND v.revision = ?
       AND r.record_kind = 'memory_disposition' AND r.stable_key = ? AND r.operation = 'upsert'`,
  ).get(input.job_id, reuse.accepted_work_batch_id, reuse.accepted_overlay_revision, reuse.memory_id) as {
    payload_json: string; payload_digest: string; overlay_digest: string;
  } | null;
  if (!row || row.overlay_digest !== reuse.accepted_overlay_digest
    || row.payload_digest !== reuse.accepted_disposition_digest) return null;
  try {
    const disposition = SessionMaintenanceProjectionMemoryDispositionSchema.parse(JSON.parse(row.payload_json));
    return disposition.memory_id === reuse.memory_id
      && stableJson(disposition.revision_identity) === stableJson(reuse.revision_identity)
      ? disposition
      : null;
  } catch {
    return null;
  }
}

function validateOperations(
  db: Database,
  input: ParsedSMCProposalValidationInput,
  selectedSourceIds: ReadonlySet<string>,
  admittedProvenanceRefs: ReadonlySet<string>,
  workKind: "evidence" | "audit",
  issues: SMCProposalValidationIssue[],
): void {
  const overlay = reconstructSMCOverlay(db, { job_id: input.job_id, revision: input.proposal.expected_overlay_revision });
  const existingStable = new Set(overlay.records.map((record) => `${record.record_kind}\u0000${record.stable_key}`));
  const operationKeys = new Set<string>();
  const outputIds = new Map<string, string>();
  input.proposal.staged_operations.forEach((operation, index) => {
    const path = `staged_operations[${index}]`;
    const key = `${operation.record_kind}\u0000${operation.stable_key}`;
    if (operationKeys.has(key)) add(issues, "duplicate_staged_operation", path, "duplicate staged record operation");
    operationKeys.add(key);
    if (operation.operation === "discard") {
      if (!existingStable.has(key)) add(issues, "staged_record_not_found", path, "discard target does not exist in the current overlay");
      return;
    }
    const id = operation.value.id;
    const existingRecord = overlay.records.find((record) =>
      record.record_kind === operation.record_kind && record.stable_key === operation.stable_key);
    if (existingRecord?.final_id !== undefined && existingRecord.final_id !== null && existingRecord.final_id !== id) {
      add(issues, "stable_final_id_mismatch", `${path}.value.id`, "an accepted staged record cannot change its final id");
    }
    const prior = outputIds.get(id);
    if (prior) add(issues, "duplicate_output_id", `${path}.value.id`, `${id} is already used by ${prior}`);
    outputIds.set(id, `${operation.record_kind}/${operation.stable_key}`);
    validateSourceRefs(operation, path, selectedSourceIds, admittedProvenanceRefs, workKind, existingRecord?.payload, issues);
    if (outputIdExists(db, input.job_id, operation.record_kind, id, operation.stable_key)) {
      add(issues, "output_id_collision", `${path}.value.id`, `${id} collides with existing canonical or staged state`);
    }
    if (operation.record_kind === "handoff") {
      const seenMemoryRefs = new Set<string>();
      operation.value.source_session_memory_ids.forEach((memoryId, refIndex) => {
        if (seenMemoryRefs.has(memoryId)) add(issues, "handoff_memory_reference_invalid", `${path}.value.source_session_memory_ids[${refIndex}]`, "duplicate handoff memory reference");
        seenMemoryRefs.add(memoryId);
      });
    }
  });
}

function validateSourceRefs(
  operation: Extract<SMCProposalOperation, { operation: "upsert" }>,
  path: string,
  selected: ReadonlySet<string>,
  admittedProvenanceRefs: ReadonlySet<string>,
  workKind: "evidence" | "audit",
  priorPayload: unknown,
  issues: SMCProposalValidationIssue[],
): void {
  const refs = operation.value.source_event_refs;
  const priorRefs = sourceRefs(priorPayload);
  const seen = new Set<string>();
  refs.forEach((id, index) => {
    if (seen.has(id)) add(issues, "duplicate_source_reference", `${path}.value.source_event_refs[${index}]`, "duplicate source reference");
    seen.add(id);
    if (!admittedProvenanceRefs.has(id) && !priorRefs.has(id)) {
      add(issues, "source_reference_outside_work_batch", `${path}.value.source_event_refs[${index}]`, "source reference is neither selected evidence nor preserved staged provenance");
    }
  });
  if (refs.length === 0 || !refs.some((id) => workKind === "audit" ? admittedProvenanceRefs.has(id) : selected.has(id))) {
    add(issues, "output_provenance_missing", `${path}.value.source_event_refs`, "staged output requires provenance from the current work batch");
  }
}

function validateReferences(
  db: Database,
  input: ParsedSMCProposalValidationInput,
  proposal: SMCBatchProposal,
  selected: ReadonlySet<string>,
  admittedProvenanceRefs: ReadonlySet<string>,
  reused: ReadonlyMap<string, SessionMaintenanceProjectionMemoryDisposition>,
  issues: SMCProposalValidationIssue[],
): void {
  const requiredSourcesByRef = new Map<string, Set<string>>();
  const priorOverlay = reconstructSMCOverlay(db, { job_id: input.job_id, revision: proposal.expected_overlay_revision });
  const resolvableRefs = acceptedOverlayOutputRefs(priorOverlay.records);
  for (const operation of proposal.staged_operations) {
    if (operation.operation === "discard") {
      const prior = priorOverlay.records.find((record) =>
        record.record_kind === operation.record_kind && record.stable_key === operation.stable_key);
      if (prior?.final_id) resolvableRefs.delete(outputRef(operation.record_kind, prior.final_id));
      continue;
    }
    const ref = outputRef(operation.record_kind, operation.value.id);
    resolvableRefs.add(ref);
    for (const sourceId of operation.value.source_event_refs) {
      if (selected.has(sourceId)) addRef(requiredSourcesByRef, ref, sourceId);
    }
  }
  proposal.memory_dispositions.forEach((disposition, index) => {
    const ref = `memory_dispositions/${disposition.memory_id}`;
    resolvableRefs.add(ref);
    const seen = new Set<string>();
    disposition.source_event_refs.forEach((sourceId, sourceIndex) => {
      if (seen.has(sourceId)) {
        add(issues, "duplicate_source_reference", `memory_dispositions[${index}].source_event_refs[${sourceIndex}]`, "duplicate source reference");
      }
      seen.add(sourceId);
      if (!admittedProvenanceRefs.has(sourceId)) {
        add(issues, "source_reference_outside_work_batch", `memory_dispositions[${index}].source_event_refs[${sourceIndex}]`, "disposition source reference is outside the work batch");
      } else {
        addRef(requiredSourcesByRef, ref, sourceId);
      }
    });
  });
  for (const memoryId of reused.keys()) resolvableRefs.add(`memory_dispositions/${memoryId}`);

  const declaredRefs = new Set<string>();
  proposal.source_event_dispositions.forEach((disposition, index) => {
    const required = refsForSource(requiredSourcesByRef, disposition.source_event_id);
    if (disposition.disposition === "no_output") {
      if (required.size > 0) add(issues, "source_disposition_conflict", `source_event_dispositions[${index}]`, "no_output source is cited by a proposed output");
      return;
    }
    const declared = new Set(disposition.output_refs);
    if (declared.size !== disposition.output_refs.length) {
      add(issues, "output_reference_mismatch", `source_event_dispositions[${index}].output_refs`, "output references contain duplicates");
    }
    disposition.output_refs.forEach((ref, refIndex) => {
      declaredRefs.add(ref);
      if (!isCanonicalOutputRef(ref)) add(issues, "output_reference_invalid", `source_event_dispositions[${index}].output_refs[${refIndex}]`, "output reference is not canonical");
      else if (!resolvableRefs.has(ref)) add(issues, "output_reference_invalid", `source_event_dispositions[${index}].output_refs[${refIndex}]`, "output reference does not resolve to staged state or an explicit disposition receipt");
    });
    for (const ref of required) {
      if (!declared.has(ref)) add(issues, "output_reference_mismatch", `source_event_dispositions[${index}].output_refs`, `missing provenance reference ${ref}`);
    }
  });
  const checked = new Set(proposal.checked_output_refs);
  if (checked.size !== proposal.checked_output_refs.length || !sameSet(checked, declaredRefs)) {
    add(issues, "output_reference_mismatch", "checked_output_refs", "checked output references must exactly match used-source declarations");
  }
}

function buildDeltaRecords(
  proposal: SMCBatchProposal,
  reused: ReadonlyMap<string, SessionMaintenanceProjectionMemoryDisposition>,
  workKind: "evidence" | "audit",
): SMCOverlayDeltaRecord[] {
  const records: SMCOverlayDeltaRecord[] = proposal.staged_operations.map((operation) => operation.operation === "discard"
    ? { record_kind: operation.record_kind, operation: "discard", stable_key: operation.stable_key }
    : {
      record_kind: operation.record_kind,
      operation: "upsert",
      stable_key: operation.stable_key,
      final_id: operation.value.id,
      payload: operation.value,
    });
  for (const disposition of proposal.memory_dispositions) records.push(dispositionRecord({
    ...disposition,
    work_kind: workKind,
    source_event_refs: [...disposition.source_event_refs].sort(compareText),
  }));
  for (const disposition of reused.values()) records.push(dispositionRecord(disposition));
  for (const disposition of proposal.source_event_dispositions) records.push({
    record_kind: "source_disposition",
    operation: "upsert",
    stable_key: disposition.source_event_id,
    payload: disposition.disposition === "used"
      ? { ...disposition, output_refs: [...disposition.output_refs].sort(compareText) }
      : disposition,
  });
  return records.sort(compareDeltaRecords);
}

function validateAuditFetchCoverage(
  db: Database,
  manifest: NonNullable<ReturnType<typeof readSMCManifest>>,
  workBatchId: string,
  issues: SMCProposalValidationIssue[],
): void {
  const members = db.query(
    `SELECT memory_id, revision, state_digest FROM smc_audit_batch_members
     WHERE job_id = ? AND batch_id = ? ORDER BY ordinal`,
  ).all(manifest.job_id, workBatchId) as Array<{ memory_id: string; revision: number; state_digest: string }>;
  for (const member of members) {
    if (!hasExactCuratorMemoryFetchReceipt(db, manifest, { work_batch_id: workBatchId, ...member })) {
      add(issues, "proposal_channel_coverage_incomplete", "memory_dispositions",
        `audit target ${member.memory_id} requires an exact full-record fetch receipt`);
    }
  }
}

function validateProspectiveOverlay(
  db: Database,
  input: ParsedSMCProposalValidationInput,
  delta: readonly SMCOverlayDeltaRecord[],
  admittedProvenanceRefs: ReadonlySet<string>,
  issues: SMCProposalValidationIssue[],
): void {
  const current = reconstructSMCOverlay(db, {
    job_id: input.job_id,
    revision: input.proposal.expected_overlay_revision,
  });
  const records = new Map(current.records.map((record) => [
    `${record.record_kind}\u0000${record.stable_key}`,
    { record_kind: record.record_kind, stable_key: record.stable_key, final_id: record.final_id, payload: record.payload },
  ]));
  for (const record of delta) {
    const key = `${record.record_kind}\u0000${record.stable_key}`;
    if (record.operation === "discard") records.delete(key);
    else records.set(key, {
      record_kind: record.record_kind,
      stable_key: record.stable_key,
      final_id: record.final_id ?? null,
      payload: record.payload,
    });
  }

  const resolvable = new Set<string>();
  const outputSources = new Map<string, readonly string[]>();
  const memoryIds = new Set<string>();
  const handoffs: Array<{ stable_key: string; source_session_memory_ids: readonly string[] }> = [];
  const dispositions: SessionMaintenanceProjectionMemoryDisposition[] = [];
  const sourceDispositions = new Map<string, ReturnType<typeof SessionMaintenanceSourceDispositionSchema.parse>>();
  const outputIds = new Map<string, string>();

  for (const record of records.values()) {
    try {
      if (record.record_kind === "memory") {
        const value = SessionMaintenanceMemorySchema.parse(record.payload);
        validateProspectiveOutputId(record, value.id, outputIds, issues);
        memoryIds.add(value.id);
        const ref = outputRef("memory", value.id);
        resolvable.add(ref);
        outputSources.set(ref, value.source_event_refs);
      } else if (record.record_kind === "candidate") {
        const value = SessionMaintenanceCandidateSchema.parse(record.payload);
        validateProspectiveOutputId(record, value.id, outputIds, issues);
        const ref = outputRef("candidate", value.id);
        resolvable.add(ref);
        outputSources.set(ref, value.source_event_refs);
      } else if (record.record_kind === "handoff") {
        const value = SessionMaintenanceHandoffSchema.parse(record.payload);
        validateProspectiveOutputId(record, value.id, outputIds, issues);
        const ref = outputRef("handoff", value.id);
        resolvable.add(ref);
        outputSources.set(ref, value.source_event_refs);
        handoffs.push({ stable_key: record.stable_key, source_session_memory_ids: value.source_session_memory_ids });
      } else if (record.record_kind === "memory_disposition") {
        const value = SessionMaintenanceProjectionMemoryDispositionSchema.parse(record.payload);
        dispositions.push(value);
        const ref = `memory_dispositions/${value.memory_id}`;
        resolvable.add(ref);
        outputSources.set(ref, value.source_event_refs);
      } else if (record.record_kind === "source_disposition") {
        const value = SessionMaintenanceSourceDispositionSchema.parse(record.payload);
        sourceDispositions.set(value.source_event_id, value);
      }
    } catch (error) {
      add(issues, "output_reference_invalid", `prospective_overlay.${record.record_kind}/${record.stable_key}`, message(error));
    }
  }

  const frozenSources = new Set((db.query(
    "SELECT source_id FROM smc_evidence_snapshot WHERE job_id = ?",
  ).all(input.job_id) as Array<{ source_id: string }>).map((row) => row.source_id));
  for (const [ref, sourceIds] of outputSources) {
    for (const sourceId of sourceIds) {
      const disposition = sourceDispositions.get(sourceId);
      const inheritedAuditRef = admittedProvenanceRefs.has(sourceId) && !frozenSources.has(sourceId);
      if (!inheritedAuditRef && (!frozenSources.has(sourceId) || !disposition || disposition.disposition !== "used"
        || !disposition.output_refs.includes(ref))) {
        add(issues, "output_provenance_missing", `prospective_overlay.${ref}`, `source ${sourceId} does not close to a used source disposition`);
      }
    }
  }
  for (const disposition of sourceDispositions.values()) {
    if (disposition.disposition === "no_output") {
      const cited = [...outputSources.values()].some((refs) => refs.includes(disposition.source_event_id));
      if (cited) add(issues, "source_disposition_conflict", `prospective_overlay.source_dispositions/${disposition.source_event_id}`, "no_output source remains cited by retained output state");
      continue;
    }
    for (const ref of disposition.output_refs) {
      if (!resolvable.has(ref)) {
        add(issues, "output_reference_invalid", `prospective_overlay.source_dispositions/${disposition.source_event_id}`, `${ref} does not resolve after the proposed delta`);
      }
    }
  }

  for (const disposition of dispositions) {
    if (disposition.disposition === "supersede"
      && (disposition.replacement_memory_id === disposition.memory_id
        || !memoryIds.has(disposition.replacement_memory_id))) {
      add(issues, "invalid_lifecycle_target", `prospective_overlay.memory_dispositions/${disposition.memory_id}`, "supersession replacement does not resolve in retained or newly proposed staged memory");
    }
  }
  const frozenMemoryIds = new Set((db.query(
    "SELECT memory_id FROM smc_memory_snapshot WHERE job_id = ?",
  ).all(input.job_id) as Array<{ memory_id: string }>).map((row) => row.memory_id));
  for (const handoff of handoffs) {
    for (const memoryId of handoff.source_session_memory_ids) {
      if (!memoryIds.has(memoryId) && !frozenMemoryIds.has(memoryId)) {
        add(issues, "handoff_memory_reference_invalid", `prospective_overlay.handoffs/${handoff.stable_key}`, `${memoryId} does not resolve in the frozen or staged memory view`);
      }
    }
  }
}

function validateProspectiveOutputId(
  record: { record_kind: string; stable_key: string; final_id: string | null | undefined },
  id: string,
  seen: Map<string, string>,
  issues: SMCProposalValidationIssue[],
): void {
  const owner = `${record.record_kind}/${record.stable_key}`;
  if (record.final_id !== id) {
    add(issues, "stable_final_id_mismatch", `prospective_overlay.${owner}`, "staged final id does not match payload id");
  }
  const prior = seen.get(id);
  if (prior && prior !== owner) add(issues, "duplicate_output_id", `prospective_overlay.${owner}`, `${id} is already used by ${prior}`);
  seen.set(id, owner);
}

function dispositionRecord(disposition: SessionMaintenanceProjectionMemoryDisposition): SMCOverlayDeltaRecord {
  return {
    record_kind: "memory_disposition",
    operation: "upsert",
    stable_key: disposition.memory_id,
    base_memory_id: disposition.revision_identity.origin === "base" ? disposition.memory_id : null,
    payload: disposition,
  };
}

function outputIdExists(db: Database, jobId: string, kind: string, id: string, stableKey: string): boolean {
  const table = kind === "memory" ? "session_memories" : kind === "candidate" ? "memory_candidates" : null;
  if (table && db.query(`SELECT 1 FROM ${table} WHERE id = ?`).get(id)) return true;
  if (kind === "handoff") {
    for (const tableName of ["project_handoff_instructions", "practice_handoff_instructions", "personal_handoff_instructions"]) {
      if (db.query(`SELECT 1 FROM ${tableName} WHERE id = ?`).get(id)) return true;
    }
  }
  const stagedId = stagedSMCRecordId(jobId, kind as "memory" | "candidate" | "handoff", stableKey);
  const row = db.query(
    `SELECT 1 FROM smc_overlay_records
     WHERE job_id = ? AND record_kind = ? AND final_id = ? AND staged_id <> ? LIMIT 1`,
  ).get(jobId, kind, id, stagedId);
  return Boolean(row);
}

function outputRef(kind: "memory" | "candidate" | "handoff", id: string): string {
  return `${kind === "memory" ? "session_memories" : kind === "candidate" ? "memory_candidates" : "handoff_instructions"}/${id}`;
}

function acceptedOverlayOutputRefs(records: ReturnType<typeof reconstructSMCOverlay>["records"]): Set<string> {
  return new Set(records.flatMap((record) => {
    if (record.operation !== "upsert" || !record.final_id) return [];
    if (record.record_kind !== "memory" && record.record_kind !== "candidate" && record.record_kind !== "handoff") return [];
    return [outputRef(record.record_kind, record.final_id)];
  }));
}

function isCanonicalOutputRef(value: string): boolean {
  return /^(?:session_memories|memory_candidates|handoff_instructions|memory_dispositions)\/[^/\s]+$/u.test(value);
}

function addRef(map: Map<string, Set<string>>, ref: string, sourceId: string): void {
  const sources = map.get(ref) ?? new Set<string>();
  sources.add(sourceId);
  map.set(ref, sources);
}

function refsForSource(map: ReadonlyMap<string, ReadonlySet<string>>, sourceId: string): Set<string> {
  return new Set([...map.entries()].filter(([, sources]) => sources.has(sourceId)).map(([ref]) => ref));
}

function sourceRefs(value: unknown): Set<string> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return new Set();
  const refs = (value as Record<string, unknown>).source_event_refs;
  return new Set(Array.isArray(refs) ? refs.filter((item): item is string => typeof item === "string") : []);
}

function domainRecords(records: readonly SMCOverlayDeltaRecord[]): unknown[] {
  return records.map((record) => ({
    record_kind: record.record_kind,
    stable_key: record.stable_key,
    operation: record.operation,
    base_memory_id: record.base_memory_id ?? null,
    final_id: record.final_id ?? null,
    payload: record.payload ?? null,
  })).sort((left, right) => compareText(`${left.record_kind}\u0000${left.stable_key}`, `${right.record_kind}\u0000${right.stable_key}`));
}

function compareDeltaRecords(left: SMCOverlayDeltaRecord, right: SMCOverlayDeltaRecord): number {
  return compareText(`${left.record_kind}\u0000${left.stable_key}`, `${right.record_kind}\u0000${right.stable_key}`);
}

function invalid(issues: SMCProposalValidationIssue[]): Extract<SMCProposalValidationResult, { valid: false }> {
  return { valid: false, issues: issues.sort((left, right) => compareText(left.path, right.path) || compareText(left.code, right.code)) };
}

function add(issues: SMCProposalValidationIssue[], code: SMCProposalValidationIssueCode, path: string, value: string): void {
  issues.push({ code, path, message: value });
}

function sameSet(left: ReadonlySet<string>, right: ReadonlySet<string>): boolean {
  return left.size === right.size && [...left].every((value) => right.has(value));
}

function sorted(values: ReadonlySet<string>): string[] {
  return [...values].sort(compareText);
}

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function digest(value: unknown): `sha256:${string}` {
  return `sha256:${createHash("sha256").update(stableJson(value), "utf8").digest("hex")}`;
}

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
