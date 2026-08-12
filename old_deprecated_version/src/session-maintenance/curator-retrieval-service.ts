import type { Database } from "bun:sqlite";
import { createHash, createHmac, randomBytes } from "node:crypto";
import type { EmbeddingTransport } from "../memory/embedding-types.ts";
import type { ActiveEmbeddingContract } from "../runtime/config.ts";
import { embeddingProviderFailureCode } from "../memory/embedding-provider-errors.ts";
import { executeTrustedCoordinatorEmbedding } from "../memory/embedding-service.ts";
import { normalizeSessionMemorySearchQuery, sessionMemorySearchTokens } from "../memory/session-memory-text.ts";
import { cosineDistance, decodeFloat32Vector } from "../memory/sqlite-vec.ts";
import { stableJson } from "../runtime/json.ts";
import {
  listSMCCoverageReceipts,
  readSMCCoverageReceipt,
  recordSMCCoverageReceiptInOpenTransaction,
  type SMCCuratorChannelHit,
  type SMCCuratorQueryMaterialization,
  type SMCCuratorQueryPagePayload,
  type SMCCuratorWorkSetPayload,
  type SMCCoverageReceipt,
} from "./coverage-receipts.ts";
import {
  ensureCuratorBatchChannelPlan,
  normalizeCuratorMetadataValue,
  readCuratorBatchChannelPlan,
  readDurableCuratorAffectedWorkSet,
  readLatestCuratorBatchChannelPlan,
  type CuratorBatchChannelPlan,
  type CuratorChannelObligation,
} from "./curator-channel-plan.ts";
import {
  CURATOR_RETRIEVAL_CHANNELS,
  decodeCanonicalCuratorCursor,
  validateCuratorQueryRequest,
  type CuratorAffectedWorkSetMember,
  type CuratorChannelDiagnostic,
  type CuratorCursorEnvelope,
  type CuratorMemoryRevisionIdentity,
  type CuratorQueryMatch,
  type CuratorQueryRequest,
  type CuratorQueryResult,
  type CuratorRetrievalChannel,
} from "./curator-retrieval-types.ts";
import { readSMCManifest, type SMCManifest } from "./manifest.ts";
import { reconstructSMCOverlay, type SMCOverlayRecord } from "./overlay-store.ts";
import { validateSMCOverlaySearchIndex } from "./overlay-index-service.ts";
import {
  CuratorActionChargeError,
  effectiveCuratorBudgets,
  recordCuratorActionChargeInOpenTransaction,
  requireCuratorActionCharge,
} from "./curator-action-charges.ts";

type SearchableMemory = {
  stable_id: string;
  title: string | null;
  summary: string;
  memory_kind: string;
  revision_identity: CuratorMemoryRevisionIdentity;
  normalized_text: string;
  vector: number[];
  contexts: Array<Record<string, unknown>>;
  links: Array<Record<string, unknown>>;
  source_refs: string[];
  payload: Record<string, unknown>;
  overlay: boolean;
};

type StoredMaterializationPayload = {
  kind: "curator_query_materialization";
  materialization: SMCCuratorQueryMaterialization;
  page: SMCCuratorQueryPagePayload;
};
type StoredPagePayload = { kind: "curator_query_page"; page: SMCCuratorQueryPagePayload };
type ObligationHit = { memory: SearchableMemory; distance?: number };
type CuratorQueryPageResult = Extract<CuratorQueryResult, { kind: "page" }>;
type CuratorQueryResultHook = (db: Database, result: CuratorQueryPageResult) => void;

class CuratorQueryResultHookError extends Error {
  constructor(readonly cause: unknown) {
    super("curator query result hook failed");
  }
}

export function prepareCuratorBatchChannelPlan(
  db: Database,
  input: {
    job_id: string; project_key: string; work_batch_id: string; attempt_id: string; owner_epoch: number;
    manifest_digest: string; snapshot_token: string; overlay_revision: number;
  },
): CuratorBatchChannelPlan {
  const manifest = readSMCManifest(db, input.job_id);
  if (!manifest || !matchesManifestIdentity(manifest, input) || !runningIdentityMatches(db, input)) {
    throw new Error("curator_identity_mismatch");
  }
  return ensureCuratorBatchChannelPlan(db, {
    job_id: input.job_id,
    work_batch_id: input.work_batch_id,
    manifest_digest: input.manifest_digest,
    snapshot_token: input.snapshot_token,
    overlay_revision: input.overlay_revision,
    overlay_digest: manifest.current_overlay_identity.digest,
  });
}

export async function queryCuratorMemory(
  db: Database,
  request: CuratorQueryRequest,
  dependencies: {
    embedding_transport: EmbeddingTransport;
    on_result_in_open_transaction?: CuratorQueryResultHook;
  },
): Promise<CuratorQueryResult> {
  const manifest = readSMCManifest(db, request.job_id);
  if (!manifest || !matchesManifestIdentity(manifest, request) || !runningIdentityMatches(db, request)) {
    return blocked("curator_identity_mismatch", "query identity does not match the running anchor", false);
  }
  if (request.cursor !== undefined && request.cursor !== null
    && (typeof request.cursor !== "string" || !decodeCanonicalCuratorCursor(request.cursor))) {
    return blocked("curator_request_invalid", "cursor must be a non-empty canonical cursor envelope", false);
  }
  let overlay;
  try {
    overlay = reconstructSMCOverlay(db, { job_id: request.job_id, revision: request.overlay_revision });
  } catch (error) {
    return blocked("curator_identity_mismatch", message(error), false);
  }
  let currentPlan: CuratorBatchChannelPlan;
  try {
    currentPlan = request.cursor
      ? readLatestCuratorBatchChannelPlan(db, request) ?? ensureCuratorBatchChannelPlan(db, {
        ...planIdentity(request, manifest.current_overlay_identity.digest),
      })
      : ensureCuratorBatchChannelPlan(db, { ...planIdentity(request, manifest.current_overlay_identity.digest) });
  } catch (error) {
    return blocked("curator_channel_plan_input_drift", message(error), false);
  }
  if (currentPlan.plan_revision !== request.plan_revision || currentPlan.plan_digest !== request.plan_digest) {
    return blocked("curator_channel_plan_stale", "query does not reference the latest coordinator channel plan", false, currentPlan);
  }
  const plan = readCuratorBatchChannelPlan(db, request);
  if (!plan || plan.plan_digest !== request.plan_digest) {
    return blocked("curator_channel_plan_missing", "query channel plan is missing or invalid", false, currentPlan);
  }
  const admitted = new Set(plan.obligations.map((item) => item.id));
  const text = new Set(plan.obligations.filter((item) => item.kind === "text").map((item) => item.id));
  const validation = validateCuratorQueryRequest(request, {
    max_page_limit: manifest.workflow_budgets.retrieval_page_item_limit,
    text_obligation_ids: text,
    admitted_obligation_ids: admitted,
  });
  if (validation) {
    const code = validation.includes("unadmitted") ? "curator_query_value_not_admitted" : "curator_request_invalid";
    return blocked(code, validation, false);
  }
  const obligations = request.obligation_ids.map((id) => plan.obligations.find((item) => item.id === id)!);
  const queryDigest = digest(queryDigestInput(request, manifest, obligations));
  if (request.cursor) return paginateStoredMaterialization(db, {
    request,
    manifest,
    query_digest: queryDigest,
    on_result_in_open_transaction: dependencies.on_result_in_open_transaction,
  });

  const rootReceiptId = `smc_query_${queryDigest.slice(7)}`;
  const existing = readSMCCoverageReceipt(db, rootReceiptId);
  if (existing) return pageFromExistingRoot(db, {
    request,
    manifest,
    query_digest: queryDigest,
    receipt_id: rootReceiptId,
    on_result_in_open_transaction: dependencies.on_result_in_open_transaction,
  });

  let memories: SearchableMemory[];
  try {
    memories = loadSearchableMemoryView(db, manifest, overlay.records, overlay.masked_base_memory_ids);
  } catch (error) {
    return blocked("curator_overlay_unsearchable", message(error), false);
  }
  let execution;
  try {
    execution = await executeObligations(request, obligations, manifest, memories, dependencies.embedding_transport);
  } catch (error) {
    const code = embeddingProviderFailureCode(error) ?? "embedding_provider_unavailable";
    return blocked(code, message(error), code !== "embedding_provider_configuration");
  }
  const keys = execution.entries.map((entry) => entry.key);
  const orderedHits = mergeOrderedHits(execution.entries);
  let effectiveWorkSetLimit: number;
  try {
    effectiveWorkSetLimit = effectiveCuratorBudgets(db, manifest).max_affected_work_set_size;
  } catch (error) {
    return chargeBlocked(error);
  }
  const materialization: SMCCuratorQueryMaterialization = {
    schema_version: 1,
    query_digest: queryDigest,
    cursor_secret: randomBytes(32).toString("hex"),
    request_identity_digest: digest(materializationIdentity(request)),
    plan_revision: plan.plan_revision,
    plan_digest: plan.plan_digest,
    obligation_ids: request.obligation_ids,
    obligation_channel_keys: keys,
    channel_hits: Object.fromEntries(execution.entries.map((entry) => [entry.key, entry.hits.map((hit) => ({
      stable_id: hit.memory.stable_id,
      revision_identity: hit.memory.revision_identity,
      ...(hit.distance === undefined ? {} : { semantic_distance: hit.distance }),
    } satisfies SMCCuratorChannelHit))])),
    ordered_hits: orderedHits,
    diagnostics: execution.diagnostics,
    frozen_controls: {
      page_item_limit: manifest.workflow_budgets.retrieval_page_item_limit,
      semantic_distance_threshold_micros: manifest.workflow_budgets.semantic_distance_threshold_micros,
      semantic_qualifying_result_ceiling: manifest.workflow_budgets.semantic_qualifying_result_ceiling,
      max_affected_work_set_size: effectiveWorkSetLimit,
    },
    truncated: execution.truncated,
  };
  return persistPage(db, {
    request,
    manifest,
    materialization,
    root_receipt_id: rootReceiptId,
    offset: 0,
    on_result_in_open_transaction: dependencies.on_result_in_open_transaction,
  });
}

export function readCuratorAffectedWorkSet(
  db: Database,
  input: { job_id: string; work_batch_id: string },
): CuratorAffectedWorkSetMember[] {
  return readDurableCuratorAffectedWorkSet(db, input);
}

export function evaluateCuratorBatchCoverage(
  db: Database,
  input: {
    job_id: string; project_key: string; work_batch_id: string; attempt_id: string; owner_epoch: number;
    manifest_digest: string; snapshot_token: string; overlay_revision: number;
  },
): { complete: true; plan: CuratorBatchChannelPlan } | { complete: false; code: "curator_channel_coverage_incomplete"; missing: string[]; plan: CuratorBatchChannelPlan } {
  const plan = prepareCuratorBatchChannelPlan(db, input);
  return evaluateCoverageAgainstPlan(db, input.job_id, input.work_batch_id, plan);
}

export function evaluatePersistedCuratorBatchCoverage(
  db: Database,
  input: { job_id: string; work_batch_id: string; overlay_revision: number },
): { complete: true; plan: CuratorBatchChannelPlan } | { complete: false; code: "curator_channel_coverage_incomplete"; missing: string[]; plan: CuratorBatchChannelPlan } {
  const row = db.query(
    `SELECT plan_revision FROM smc_curator_batch_channel_plans
     WHERE job_id = ? AND work_batch_id = ? AND overlay_revision = ?
     ORDER BY plan_revision DESC LIMIT 1`,
  ).get(input.job_id, input.work_batch_id, input.overlay_revision) as { plan_revision: number } | null;
  if (!row) throw new Error("curator_historical_channel_plan_missing");
  const plan = readCuratorBatchChannelPlan(db, {
    job_id: input.job_id,
    work_batch_id: input.work_batch_id,
    plan_revision: row.plan_revision,
  });
  if (!plan) throw new Error("curator_historical_channel_plan_missing");
  return evaluateCoverageAgainstPlan(db, input.job_id, input.work_batch_id, plan);
}

function evaluateCoverageAgainstPlan(
  db: Database,
  jobId: string,
  workBatchId: string,
  plan: CuratorBatchChannelPlan,
): { complete: true; plan: CuratorBatchChannelPlan } | { complete: false; code: "curator_channel_coverage_incomplete"; missing: string[]; plan: CuratorBatchChannelPlan } {
  const manifest = readSMCManifest(db, jobId);
  if (!manifest) throw new Error("curator_identity_mismatch");
  const covered = new Set<string>();
  const receipts = listSMCCoverageReceipts(db, { job_id: jobId, work_batch_id: workBatchId, receipt_kind: "query" });
  for (const root of receipts) {
    const materialization = readMaterialization(root);
    if (!materialization) continue;
    const keys = validateCompleteMaterializationPageChain({ db, root, materialization, receipts, plan, manifest });
    if (keys) for (const key of keys) covered.add(key);
  }
  const required = plan.obligations.flatMap((obligation) =>
    obligation.required_channels.map((channel) => obligationChannelKey(obligation.id, channel)));
  const missing = required.filter((key) => !covered.has(key));
  return missing.length === 0 ? { complete: true, plan } : { complete: false, code: "curator_channel_coverage_incomplete", missing, plan };
}

function validateCompleteMaterializationPageChain(input: {
  db: Database;
  root: SMCCoverageReceipt;
  materialization: SMCCuratorQueryMaterialization;
  receipts: readonly SMCCoverageReceipt[];
  plan: CuratorBatchChannelPlan;
  manifest: SMCManifest;
}): readonly string[] | null {
  const { db, root, materialization, receipts, plan, manifest } = input;
  if (!sameCoverageIdentity(root, plan) || root.channel !== null || root.truncated !== materialization.truncated) return null;
  if (materialization.schema_version !== 1
    || materialization.plan_revision !== plan.plan_revision
    || materialization.plan_digest !== plan.plan_digest
    || root.id !== `smc_query_${materialization.query_digest.slice(7)}`
    || !validDigest(materialization.query_digest)
    || !validDigest(materialization.request_identity_digest)
    || materialization.frozen_controls.page_item_limit !== manifest.workflow_budgets.retrieval_page_item_limit
    || materialization.frozen_controls.semantic_distance_threshold_micros !== manifest.workflow_budgets.semantic_distance_threshold_micros
    || materialization.frozen_controls.semantic_qualifying_result_ceiling !== manifest.workflow_budgets.semantic_qualifying_result_ceiling
    || materialization.frozen_controls.max_affected_work_set_size > effectiveCuratorBudgets(db, manifest).max_affected_work_set_size) return null;

  const obligations = materialization.obligation_ids.map((id) => plan.obligations.find((item) => item.id === id));
  if (obligations.some((item) => !item) || new Set(materialization.obligation_ids).size !== materialization.obligation_ids.length) return null;
  const expectedKeys = obligations.flatMap((item) => item!.required_channels.map((channel) => obligationChannelKey(item!.id, channel)));
  if (!sameStrings(materialization.obligation_channel_keys, expectedKeys)
    || !sameStrings(Object.keys(materialization.channel_hits).sort(compareText), [...expectedKeys].sort(compareText))) return null;
  const diagnosticKeys = materialization.diagnostics.map((item) => obligationChannelKey(item.obligation_id, item.channel));
  if (!sameStrings(diagnosticKeys, expectedKeys)) return null;
  for (const diagnostic of materialization.diagnostics) {
    const key = obligationChannelKey(diagnostic.obligation_id, diagnostic.channel);
    const hits = materialization.channel_hits[key];
    if (!hits || !diagnostic.applicable || diagnostic.materialized_count !== hits.length
      || diagnostic.qualifying_count < diagnostic.materialized_count
      || diagnostic.complete === diagnostic.truncated) return null;
  }
  const orderedIds = materialization.ordered_hits.map((item) => item.stable_id);
  if (new Set(orderedIds).size !== orderedIds.length) return null;
  const channelIds = new Set(Object.values(materialization.channel_hits).flatMap((hits) => hits.map((hit) => hit.stable_id)));
  if (channelIds.size !== orderedIds.length || orderedIds.some((id) => !channelIds.has(id))) return null;

  const byId = new Map(receipts.map((receipt) => [receipt.id, receipt]));
  let offset = 0;
  let pageLimit: number | null = null;
  while (true) {
    const receipt = offset === 0 ? root : byId.get(`${root.id}_page_${offset}`);
    if (!receipt || !sameCoverageIdentity(receipt, plan) || receipt.channel !== null) return null;
    const page = readStoredPage(receipt, offset === 0);
    if (!page
      || page.schema_version !== 1
      || page.materialization_receipt_id !== root.id
      || page.materialization_receipt_digest !== (offset === 0 ? null : root.receipt_digest)
      || page.query_digest !== materialization.query_digest
      || page.offset !== offset
      || !Number.isSafeInteger(page.page_limit) || page.page_limit <= 0
      || !Number.isSafeInteger(page.public_result_envelope_bytes) || page.public_result_envelope_bytes <= 0) return null;
    pageLimit ??= page.page_limit;
    if (page.page_limit !== pageLimit) return null;
    const expectedIds = orderedIds.slice(offset, offset + pageLimit);
    if (!sameStrings(page.ordered_ids, expectedIds)) return null;
    const nextOffset = offset + expectedIds.length < orderedIds.length ? offset + expectedIds.length : null;
    if (page.next_offset !== nextOffset
      || receipt.truncated !== materialization.truncated
      || receipt.complete !== (nextOffset === null && !materialization.truncated)) return null;
    if (nextOffset === null) return materialization.truncated ? null : expectedKeys;
    if (nextOffset <= offset) return null;
    offset = nextOffset;
  }
}

function readStoredPage(receipt: SMCCoverageReceipt, root: boolean): SMCCuratorQueryPagePayload | null {
  if (!isRecord(receipt.payload)) return null;
  if (root) {
    const payload = receipt.payload as Partial<StoredMaterializationPayload>;
    return payload.kind === "curator_query_materialization" && isRecord(payload.materialization) && isRecord(payload.page)
      ? payload.page as SMCCuratorQueryPagePayload
      : null;
  }
  const payload = receipt.payload as Partial<StoredPagePayload>;
  return payload.kind === "curator_query_page" && isRecord(payload.page) ? payload.page as SMCCuratorQueryPagePayload : null;
}

function sameCoverageIdentity(receipt: SMCCoverageReceipt, plan: CuratorBatchChannelPlan): boolean {
  return receipt.receipt_kind === "query"
    && receipt.job_id === plan.job_id
    && receipt.work_batch_id === plan.work_batch_id
    && receipt.manifest_digest === plan.manifest_digest
    && receipt.snapshot_token === plan.snapshot_token
    && receipt.overlay_revision === plan.overlay_revision;
}

function sameStrings(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

async function executeObligations(
  request: CuratorQueryRequest,
  obligations: readonly CuratorChannelObligation[],
  manifest: SMCManifest,
  memories: SearchableMemory[],
  transport: EmbeddingTransport,
) {
  const entries: Array<{ key: string; obligation_id: string; channel: CuratorRetrievalChannel; hits: ObligationHit[] }> = [];
  const diagnostics: CuratorChannelDiagnostic[] = [];
  let truncated = false;
  for (const obligation of obligations) {
    for (const channel of obligation.required_channels) {
      let hits: ObligationHit[] = [];
      let qualifyingCount = 0;
      let channelTruncated = false;
      if (channel === "lexical") {
        hits = lexicalHits(memories, request.query_text!);
        qualifyingCount = hits.length;
      } else if (channel === "semantic") {
        const embedded = await executeTrustedCoordinatorEmbedding({
          contract: queryContract(manifest), transport, text: normalizeSessionMemorySearchQuery(request.query_text!),
        });
        const threshold = manifest.workflow_budgets.semantic_distance_threshold_micros / 1_000_000;
        const qualifying = memories.map((memory) => ({ memory, distance: cosineDistance(embedded.embedding, memory.vector) }))
          .filter((hit) => hit.distance <= threshold)
          .filter((hit) => matchesEvidenceScope(hit.memory, obligation.selector.scope))
          .sort((left, right) => left.distance - right.distance || compareText(left.memory.stable_id, right.memory.stable_id));
        qualifyingCount = qualifying.length;
        const ceiling = manifest.workflow_budgets.semantic_qualifying_result_ceiling;
        channelTruncated = qualifying.length > ceiling;
        hits = qualifying.slice(0, ceiling);
      } else if (channel === "exact") {
        const id = String(obligation.selector.memory_id);
        hits = memories.filter((memory) => memory.stable_id === id).map((memory) => ({ memory }));
        qualifyingCount = hits.length;
      } else if (channel === "filter") {
        hits = memories.filter((memory) => matchesMetadata(memory, obligation.selector)).map((memory) => ({ memory }));
        qualifyingCount = hits.length;
      } else if (channel === "link") {
        const seed = String(obligation.selector.stable_id);
        hits = memories.filter((memory) => memory.links.some((link) =>
          String(link.source_memory_id ?? "") === seed || String(link.target_memory_id ?? "") === seed)).map((memory) => ({ memory }));
        qualifyingCount = hits.length;
      } else {
        hits = memories.filter((memory) => memory.overlay).map((memory) => ({ memory }));
        qualifyingCount = hits.length;
      }
      if (channel !== "lexical" && channel !== "semantic") {
        hits.sort((left, right) => compareText(left.memory.stable_id, right.memory.stable_id));
      }
      if (channel !== "semantic") hits = hits.filter((hit) => matchesEvidenceScope(hit.memory, obligation.selector.scope));
      qualifyingCount = hits.length;
      const key = obligationChannelKey(obligation.id, channel);
      entries.push({ key, obligation_id: obligation.id, channel, hits });
      diagnostics.push({
        obligation_id: obligation.id, channel, applicable: true, qualifying_count: qualifyingCount,
        materialized_count: hits.length, truncated: channelTruncated, complete: !channelTruncated,
      });
      truncated ||= channelTruncated;
    }
  }
  return { entries, diagnostics, truncated };
}

function matchesEvidenceScope(
  memory: SearchableMemory,
  rawScope: unknown,
): boolean {
  if (!isRecord(rawScope)) return true;
  const entries = Object.entries(rawScope).filter(([field, value]) =>
    (field === "repo_path" || field === "git_branch" || field === "git_commit") && typeof value === "string");
  if (entries.length === 0) return true;
  return memory.contexts.some((context) => entries.every(([field, expected]) =>
    normalizeCuratorMetadataValue(field, String(context[field] ?? "")) === expected));
}

function loadSearchableMemoryView(
  db: Database,
  manifest: SMCManifest,
  overlayRecords: readonly SMCOverlayRecord[],
  maskedBaseIds: readonly string[],
): SearchableMemory[] {
  const masked = new Set(maskedBaseIds);
  const baseRows = db.query(
    `SELECT m.*, t.normalized_text, t.normalized_text_hash, v.vector_bytes,
            v.embedding_contract_id, v.embedding_provider, v.embedding_model, v.embedding_dimensions,
            v.embedding_purpose, v.embedding_format_version,
            v.normalized_text_hash AS vector_normalized_text_hash
     FROM smc_memory_snapshot m
     JOIN smc_memory_snapshot_search_texts t ON t.job_id = m.job_id AND t.memory_id = m.memory_id
     JOIN smc_memory_snapshot_vectors v ON v.job_id = m.job_id AND v.memory_id = m.memory_id
     WHERE m.job_id = ? AND m.project_key = ? ORDER BY m.memory_id`,
  ).all(manifest.job_id, manifest.project_key) as Array<Record<string, any>>;
  if (baseRows.length !== manifest.active_memory_count) throw new Error("frozen base coverage mismatch");
  const base = baseRows.filter((row) => !masked.has(row.memory_id)).map((row): SearchableMemory => {
    if (row.embedding_contract_id !== manifest.embedding_contract_id
      || row.embedding_provider !== manifest.embedding_provider || row.embedding_model !== manifest.embedding_model
      || row.embedding_dimensions !== manifest.embedding_dimensions || row.embedding_purpose !== "retrieval_document"
      || row.embedding_format_version !== manifest.embedding_format_version
      || row.normalized_text_hash !== row.vector_normalized_text_hash) {
      throw new Error(`frozen retrieval identity mismatch for ${row.memory_id}`);
    }
    return {
      stable_id: row.memory_id, title: row.title, summary: row.summary, memory_kind: row.memory_kind,
      revision_identity: { origin: "base", revision: row.revision, state_digest: row.state_digest },
      normalized_text: row.normalized_text,
      vector: decodeFloat32Vector(row.vector_bytes, manifest.embedding_dimensions),
      contexts: db.query(`SELECT repo_path, git_branch, git_commit, git_worktree_id, source_event_ref FROM smc_memory_snapshot_contexts WHERE job_id = ? AND memory_id = ? ORDER BY ordinal`).all(manifest.job_id, row.memory_id) as Array<Record<string, unknown>>,
      links: db.query(`SELECT source_memory_id, target_memory_id, relationship, reason, source_event_refs_json FROM smc_memory_snapshot_links WHERE job_id = ? AND (source_memory_id = ? OR target_memory_id = ?) ORDER BY source_memory_id, target_memory_id, relationship, reason, link_id`).all(manifest.job_id, row.memory_id, row.memory_id) as Array<Record<string, unknown>>,
      source_refs: parseStringArray(row.source_event_refs_json), payload: parseObject(row.payload_json), overlay: false,
    };
  });
  const overlayContract = { provider: manifest.embedding_provider as ActiveEmbeddingContract["provider"], model: manifest.embedding_model, dimensions: manifest.embedding_dimensions, purpose: "retrieval_document" as const, formatVersion: manifest.embedding_format_version };
  const overlay = overlayRecords.filter((record) => record.record_kind === "memory").map((record): SearchableMemory => {
    if (!validateSMCOverlaySearchIndex({ payload: record.payload, search_index: record.search_index, contract: overlayContract })) {
      throw new Error(`staged memory ${record.staged_id} has no complete matching-contract search index`);
    }
    const payload = parseObjectValue(record.payload);
    return {
      stable_id: record.staged_id, title: typeof payload.title === "string" ? payload.title : null,
      summary: String(payload.summary ?? ""), memory_kind: String(payload.memory_kind ?? "continuity"),
      revision_identity: { origin: "overlay", overlay_revision: manifest.current_overlay_identity.revision, overlay_digest: manifest.current_overlay_identity.digest, payload_digest: record.payload_digest! },
      normalized_text: record.search_index!.normalized_text, vector: [...record.search_index!.vector],
      contexts: Array.isArray(payload.contexts) ? payload.contexts.filter(isRecord) : [],
      links: Array.isArray(payload.links) ? payload.links.filter(isRecord) : [],
      source_refs: Array.isArray(payload.source_event_refs) ? payload.source_event_refs.map(String) : [],
      payload: isRecord(payload.payload) ? payload.payload : {}, overlay: true,
    };
  });
  return [...base, ...overlay].sort((left, right) => compareText(left.stable_id, right.stable_id));
}

function lexicalHits(memories: SearchableMemory[], text: string): ObligationHit[] {
  const tokens = sessionMemorySearchTokens(text);
  const normalized = normalizeSessionMemorySearchQuery(text);
  return memories.map((memory) => {
    const candidate = normalizeSessionMemorySearchQuery(memory.normalized_text);
    const score = tokens.reduce((total, token) => total + (candidate.includes(token) ? 1 : 0), 0)
      + (normalized && candidate.includes(normalized) ? tokens.length + 1 : 0);
    return { memory, score };
  }).filter((hit) => hit.score > 0)
    .sort((left, right) => right.score - left.score || compareText(left.memory.stable_id, right.memory.stable_id))
    .map(({ memory }) => ({ memory }));
}

function matchesMetadata(memory: SearchableMemory, selector: Readonly<Record<string, unknown>>): boolean {
  const field = String(selector.field);
  const expected = String(selector.value);
  if (field === "repo_path" || field === "git_branch" || field === "git_commit") {
    return memory.contexts.some((context) => normalizeCuratorMetadataValue(field, String(context[field] ?? "")) === expected);
  }
  if (field === "source_ref") return memory.source_refs.includes(expected)
    || memory.contexts.some((context) => context.source_event_ref === expected);
  const values = memory.payload[field === "topic" ? "topics" : "entities"];
  const list = Array.isArray(values) ? values : values === undefined ? [] : [values];
  return list.some((value) => normalizeCuratorMetadataValue(field, String(value)) === expected);
}

function mergeOrderedHits(entries: readonly { obligation_id: string; channel: CuratorRetrievalChannel; hits: ObligationHit[] }[]): CuratorQueryMatch[] {
  const merged = new Map<string, { match: CuratorQueryMatch; rank: number }>();
  entries.forEach((entry, entryIndex) => entry.hits.forEach((hit, rank) => {
    const existing = merged.get(hit.memory.stable_id);
    const channels = new Set(existing?.match.channels ?? []); channels.add(entry.channel);
    const obligations = new Set(existing?.match.obligation_ids ?? []); obligations.add(entry.obligation_id);
    const match: CuratorQueryMatch = {
      stable_id: hit.memory.stable_id, title: hit.memory.title, summary: hit.memory.summary,
      memory_kind: hit.memory.memory_kind, revision_identity: hit.memory.revision_identity,
      channels: CURATOR_RETRIEVAL_CHANNELS.filter((channel) => channels.has(channel)),
      obligation_ids: [...obligations].sort(compareText),
      ...(hit.distance === undefined ? existing?.match.semantic_distance === undefined ? {} : { semantic_distance: existing.match.semantic_distance } : { semantic_distance: hit.distance }),
    };
    merged.set(hit.memory.stable_id, { match, rank: Math.min(existing?.rank ?? Number.MAX_SAFE_INTEGER, rank * entries.length + entryIndex) });
  }));
  return [...merged.values()].sort((left, right) => left.rank - right.rank || compareText(left.match.stable_id, right.match.stable_id)).map((item) => item.match);
}

function persistPage(db: Database, input: { request: CuratorQueryRequest; manifest: SMCManifest; materialization: SMCCuratorQueryMaterialization; root_receipt_id: string; offset: number; root_receipt_digest?: string; on_result_in_open_transaction?: CuratorQueryResultHook }): CuratorQueryResult {
  const matches = input.materialization.ordered_hits.slice(input.offset, input.offset + input.request.page_limit);
  const nextOffset = input.offset + matches.length < input.materialization.ordered_hits.length ? input.offset + matches.length : null;
  const pageId = input.offset === 0 ? input.root_receipt_id : `${input.root_receipt_id}_page_${input.offset}`;
  const priorWorkSet = readDurableCuratorAffectedWorkSet(db, input.request);
  const workSet = mergeWorkSet(priorWorkSet, matches);
  let effectiveBudgets;
  try {
    effectiveBudgets = effectiveCuratorBudgets(db, input.manifest);
  } catch (error) {
    return chargeBlocked(error);
  }
  if (workSet.length > effectiveBudgets.max_affected_work_set_size) {
    return blocked("curator_work_set_budget_exceeded", "returned page would exceed the effective affected-work-set budget", false);
  }
  const nextCursor = nextOffset === null ? null : encodeCursor({ root_receipt_id: input.root_receipt_id, offset: nextOffset, query_digest: input.materialization.query_digest, cursor_secret: input.materialization.cursor_secret });
  const workSetReceiptId = `${pageId}_work_set`;
  const placeholderResult = publicPageResult({
    request: input.request, materialization: input.materialization, pageId, receiptDigest: `sha256:${"0".repeat(64)}`,
    matches, nextCursor, workSetReceiptId,
  });
  const publicBytes = Buffer.byteLength(stableJson(placeholderResult), "utf8");
  const page: SMCCuratorQueryPagePayload = {
    schema_version: 1, materialization_receipt_id: input.root_receipt_id,
    materialization_receipt_digest: input.root_receipt_digest ?? null, query_digest: input.materialization.query_digest,
    offset: input.offset, page_limit: input.request.page_limit, ordered_ids: matches.map((match) => match.stable_id),
    next_offset: nextOffset, public_result_envelope_bytes: publicBytes,
  };
  try {
    const stored = db.transaction(() => {
      const queryReceipt = recordSMCCoverageReceiptInOpenTransaction(db, {
        id: pageId, ...identityForReceipt(input.request), receipt_kind: "query", channel: null,
        overlay_revision: input.request.overlay_revision, complete: nextOffset === null && !input.materialization.truncated,
        truncated: input.materialization.truncated,
        payload: input.offset === 0
          ? { kind: "curator_query_materialization", materialization: input.materialization, page } satisfies StoredMaterializationPayload
          : { kind: "curator_query_page", page: { ...page, materialization_receipt_digest: input.root_receipt_digest! } } satisfies StoredPagePayload,
        created_at: new Date().toISOString(),
      });
      const workPayload: SMCCuratorWorkSetPayload = { schema_version: 1, query_receipt_id: queryReceipt.id, query_receipt_digest: queryReceipt.receipt_digest, members: workSet };
      const workSetReceipt = recordSMCCoverageReceiptInOpenTransaction(db, {
        id: workSetReceiptId, ...identityForReceipt(input.request), receipt_kind: "work_set", channel: null,
        overlay_revision: input.request.overlay_revision, complete: false, truncated: false,
        payload: workPayload, created_at: new Date().toISOString(),
      });
      const result = publicPageResult({ request: input.request, materialization: input.materialization, pageId: queryReceipt.id, receiptDigest: queryReceipt.receipt_digest, matches, nextCursor, workSetReceiptId: workSetReceipt.id });
      if (Buffer.byteLength(stableJson(result), "utf8") !== publicBytes) throw new Error("curator_public_envelope_measurement_mismatch");
      recordCuratorActionChargeInOpenTransaction(db, input.manifest, {
        ...queryChargeIdentity(input.request.job_id, input.materialization.query_digest, input.offset),
        action_kind: "query",
        result_digest: digest(result),
        // Query budget is charged once per deterministic materialization. The
        // coordinator owns page continuation, so corpus size cannot multiply
        // the provider/query allowance.
        query_count: input.offset === 0 ? 1 : 0,
        // Retrieval pages are coordinator-owned durable state and never enter
        // the provider envelope. Only provider-visible record fetches consume
        // the cumulative returned-result byte budget.
        result_bytes: 0,
        manifest_digest: input.manifest.manifest_digest,
        created_at: new Date().toISOString(),
      });
      runQueryResultHook(db, result, input.on_result_in_open_transaction);
      return result;
    }).immediate();
    return stored;
  } catch (error) {
    if (error instanceof CuratorQueryResultHookError) throw error.cause;
    if (error instanceof CuratorActionChargeError) return chargeBlocked(error);
    return blocked("curator_identity_mismatch", message(error), false);
  }
}

function publicPageResult(input: { request: CuratorQueryRequest; materialization: SMCCuratorQueryMaterialization; pageId: string; receiptDigest: string; matches: readonly CuratorQueryMatch[]; nextCursor: string | null; workSetReceiptId: string }): Extract<CuratorQueryResult, { kind: "page" }> {
  return {
    kind: "page", receipt_id: input.pageId, receipt_digest: input.receiptDigest,
    query_digest: input.materialization.query_digest, plan_revision: input.materialization.plan_revision,
    plan_digest: input.materialization.plan_digest, snapshot_token: input.request.snapshot_token,
    overlay_revision: input.request.overlay_revision, matches: input.matches,
    diagnostics: input.materialization.diagnostics, next_cursor: input.nextCursor,
    complete: input.nextCursor === null && !input.materialization.truncated,
    truncated: input.materialization.truncated, affected_work_set_receipt_id: input.workSetReceiptId,
  };
}

function paginateStoredMaterialization(db: Database, input: { request: CuratorQueryRequest; manifest: SMCManifest; query_digest: string; on_result_in_open_transaction?: CuratorQueryResultHook }): CuratorQueryResult {
  const decoded = decodeCursor(input.request.cursor!);
  if (!decoded) return blocked("curator_cursor_invalid", "cursor is malformed", false);
  const root = readSMCCoverageReceipt(db, decoded.root_receipt_id);
  if (!root) return blocked("curator_cursor_invalid", "cursor does not resolve to a persisted query", false);
  const materialization = readMaterialization(root);
  if (!materialization) return blocked("curator_cursor_invalid", "cursor root is not a curator materialization", false);
  const expected = cursorSignature({
    schema_version: decoded.schema_version,
    root_receipt_id: decoded.root_receipt_id,
    offset: decoded.offset,
    query_digest: decoded.query_digest,
  }, materialization.cursor_secret);
  if (decoded.signature !== expected) return blocked("curator_cursor_invalid", "cursor signature is invalid", false);
  if (decoded.query_digest !== input.query_digest || materialization.query_digest !== input.query_digest
    || root.snapshot_token !== input.request.snapshot_token || root.overlay_revision !== input.request.overlay_revision
    || materialization.plan_digest !== input.request.plan_digest) return blocked("curator_cursor_stale", "cursor does not match the frozen query plan/view", false);
  if (!Number.isSafeInteger(decoded.offset) || decoded.offset <= 0 || decoded.offset >= materialization.ordered_hits.length) return blocked("curator_cursor_invalid", "cursor offset is outside the materialized hit set", false);
  const existing = readSMCCoverageReceipt(db, `${root.id}_page_${decoded.offset}`);
  if (existing) return resultFromStoredPage(db, input.request, input.manifest, root, existing, materialization, input.on_result_in_open_transaction);
  return persistPage(db, { request: input.request, manifest: input.manifest, materialization, root_receipt_id: root.id, root_receipt_digest: root.receipt_digest, offset: decoded.offset, on_result_in_open_transaction: input.on_result_in_open_transaction });
}

function resultFromStoredPage(db: Database, request: CuratorQueryRequest, manifest: SMCManifest, root: NonNullable<ReturnType<typeof readSMCCoverageReceipt>>, receipt: NonNullable<ReturnType<typeof readSMCCoverageReceipt>>, materialization: SMCCuratorQueryMaterialization, onResult?: CuratorQueryResultHook): CuratorQueryResult {
  if (!isRecord(receipt.payload)) return blocked("curator_cursor_stale", "stored page payload is invalid", false);
  const page = (receipt.payload as Partial<StoredPagePayload>).page;
  if (!page || page.materialization_receipt_id !== root.id || page.materialization_receipt_digest !== root.receipt_digest || page.query_digest !== materialization.query_digest) return blocked("curator_cursor_stale", "stored page does not match materialization", false);
  const byId = new Map(materialization.ordered_hits.map((match) => [match.stable_id, match]));
  const matches = page.ordered_ids.map((id) => byId.get(id)).filter((item): item is CuratorQueryMatch => Boolean(item));
  const work = readSMCCoverageReceipt(db, `${receipt.id}_work_set`);
  if (matches.length !== page.ordered_ids.length || !work) return blocked("curator_cursor_stale", "stored page or work-set receipt is incomplete", false);
  const next = page.next_offset === null ? null : encodeCursor({ root_receipt_id: root.id, offset: page.next_offset, query_digest: materialization.query_digest, cursor_secret: materialization.cursor_secret });
  const result = publicPageResult({ request, materialization, pageId: receipt.id, receiptDigest: receipt.receipt_digest, matches, nextCursor: next, workSetReceiptId: work.id });
  return requireChargedQueryReplay(db, manifest, materialization.query_digest, page.offset, result, onResult);
}

function pageFromExistingRoot(db: Database, input: { request: CuratorQueryRequest; manifest: SMCManifest; query_digest: string; receipt_id: string; on_result_in_open_transaction?: CuratorQueryResultHook }): CuratorQueryResult {
  const root = readSMCCoverageReceipt(db, input.receipt_id)!;
  const materialization = readMaterialization(root);
  if (!materialization || materialization.query_digest !== input.query_digest || materialization.plan_digest !== input.request.plan_digest) return blocked("curator_cursor_stale", "stored materialization does not match query", false);
  const payload = root.payload as StoredMaterializationPayload;
  const matches = materialization.ordered_hits.slice(0, payload.page.ordered_ids.length);
  const work = readSMCCoverageReceipt(db, `${root.id}_work_set`);
  if (!work) return blocked("curator_cursor_stale", "stored query is missing work-set receipt", false);
  const next = payload.page.next_offset === null ? null : encodeCursor({ root_receipt_id: root.id, offset: payload.page.next_offset, query_digest: materialization.query_digest, cursor_secret: materialization.cursor_secret });
  const result = publicPageResult({ request: input.request, materialization, pageId: root.id, receiptDigest: root.receipt_digest, matches, nextCursor: next, workSetReceiptId: work.id });
  return requireChargedQueryReplay(db, input.manifest, materialization.query_digest, 0, result, input.on_result_in_open_transaction);
}

function readMaterialization(receipt: ReturnType<typeof readSMCCoverageReceipt>): SMCCuratorQueryMaterialization | null {
  if (!receipt || !isRecord(receipt.payload)) return null;
  const payload = receipt.payload as Partial<StoredMaterializationPayload>;
  if (payload.kind !== "curator_query_materialization" || !isRecord(payload.materialization)) return null;
  const value = payload.materialization as Partial<SMCCuratorQueryMaterialization>;
  return typeof value.cursor_secret === "string" && /^[0-9a-f]{64}$/.test(value.cursor_secret) ? value as SMCCuratorQueryMaterialization : null;
}

function mergeWorkSet(current: readonly CuratorAffectedWorkSetMember[], page: readonly CuratorQueryMatch[]): CuratorAffectedWorkSetMember[] {
  const values = new Map(current.map((member) => [member.stable_id, member]));
  for (const match of page) {
    const prior = values.get(match.stable_id);
    if (prior && stableJson(prior.revision_identity) !== stableJson(match.revision_identity)) throw new Error(`curator_work_set_revision_conflict: ${match.stable_id}`);
    values.set(match.stable_id, { stable_id: match.stable_id, revision_identity: match.revision_identity });
  }
  return [...values.values()].sort((left, right) => compareText(left.stable_id, right.stable_id));
}

function requireChargedQueryReplay(
  db: Database,
  manifest: SMCManifest,
  queryDigest: string,
  offset: number,
  result: Extract<CuratorQueryResult, { kind: "page" }>,
  onResult?: CuratorQueryResultHook,
): CuratorQueryResult {
  try {
    db.transaction(() => {
      const identity = queryChargeIdentity(manifest.job_id, queryDigest, offset);
      requireCuratorActionCharge(db, manifest, {
        ...identity,
        action_kind: "query",
        result_digest: digest(result),
        query_count: offset === 0 ? 1 : 0,
        result_bytes: 0,
        manifest_digest: manifest.manifest_digest,
      });
      runQueryResultHook(db, result, onResult);
    }).immediate();
    return result;
  } catch (error) {
    if (error instanceof CuratorQueryResultHookError) throw error.cause;
    return chargeBlocked(error);
  }
}

function runQueryResultHook(db: Database, result: CuratorQueryPageResult, hook?: CuratorQueryResultHook): void {
  if (!hook) return;
  try {
    hook(db, result);
  } catch (error) {
    throw new CuratorQueryResultHookError(error);
  }
}

function queryChargeIdentity(jobId: string, queryDigest: string, offset: number) {
  const request = { schema_version: 1, action_kind: "query" as const, job_id: jobId, query_digest: queryDigest, offset };
  return { action_key: `curator_action_${digest(request).slice(7)}`, job_id: jobId, request_digest: digest(request) };
}

function queryDigestInput(request: CuratorQueryRequest, manifest: SMCManifest, obligations: readonly CuratorChannelObligation[]) {
  return { schema_version: 1, identity: materializationIdentity(request), plan_digest: request.plan_digest,
    obligations: obligations.map((item) => ({ id: item.id, kind: item.kind, required_channels: item.required_channels, selector: item.selector })),
    normalized_query_text: request.query_text === undefined ? null : normalizeSessionMemorySearchQuery(request.query_text),
    page_limit: request.page_limit, controls: { semantic_distance_threshold_micros: manifest.workflow_budgets.semantic_distance_threshold_micros,
      semantic_qualifying_result_ceiling: manifest.workflow_budgets.semantic_qualifying_result_ceiling,
      max_affected_work_set_size: manifest.workflow_budgets.max_affected_work_set_size, policy_identity: manifest.governing_identities.policy } };
}

function materializationIdentity(request: CuratorQueryRequest) {
  return { job_id: request.job_id, project_key: request.project_key, work_batch_id: request.work_batch_id,
    manifest_digest: request.manifest_digest, snapshot_token: request.snapshot_token,
    overlay_revision: request.overlay_revision, plan_revision: request.plan_revision, plan_digest: request.plan_digest };
}
function identityForReceipt(request: CuratorQueryRequest) { return { job_id: request.job_id, project_key: request.project_key, work_batch_id: request.work_batch_id, attempt_id: request.attempt_id, owner_epoch: request.owner_epoch, manifest_digest: request.manifest_digest, snapshot_token: request.snapshot_token }; }
function planIdentity(request: CuratorQueryRequest, overlayDigest: string) { return { job_id: request.job_id, work_batch_id: request.work_batch_id, manifest_digest: request.manifest_digest, snapshot_token: request.snapshot_token, overlay_revision: request.overlay_revision, overlay_digest: overlayDigest }; }
function matchesManifestIdentity(manifest: SMCManifest, request: Pick<CuratorQueryRequest, "project_key" | "manifest_digest" | "snapshot_token" | "overlay_revision">): boolean { return manifest.project_key === request.project_key && manifest.manifest_digest === request.manifest_digest && manifest.snapshot_token === request.snapshot_token && manifest.current_overlay_identity.revision === request.overlay_revision; }
function runningIdentityMatches(db: Database, input: Pick<CuratorQueryRequest, "attempt_id" | "work_batch_id" | "job_id" | "project_key" | "owner_epoch">): boolean { return Boolean(db.query(`SELECT 1 FROM session_memory_anchor_jobs a JOIN project_session_mutation_fences f ON f.project_key = a.project_key AND f.owner_id = a.job_id AND f.owner_kind = 'anchor_job' JOIN session_memory_anchor_attempts t ON t.job_id = a.job_id AND t.id = ? JOIN smc_work_batches b ON b.job_id = a.job_id AND b.batch_id = ? WHERE a.job_id = ? AND a.project_key = ? AND a.phase = 'running' AND f.phase = 'running' AND t.status = 'running' AND a.owner_epoch = ? AND f.owner_epoch = ? AND t.owner_epoch = ?`).get(input.attempt_id, input.work_batch_id, input.job_id, input.project_key, input.owner_epoch, input.owner_epoch, input.owner_epoch)); }
function queryContract(manifest: SMCManifest): ActiveEmbeddingContract { return { provider: manifest.embedding_provider as ActiveEmbeddingContract["provider"], model: manifest.embedding_model, dimensions: manifest.embedding_dimensions, purpose: "retrieval_query", formatVersion: manifest.embedding_format_version }; }
function obligationChannelKey(obligationId: string, channel: CuratorRetrievalChannel): string { return `${obligationId}:${channel}`; }

type UnsignedCursorPayload = Omit<CuratorCursorEnvelope, "signature">;
function encodeCursor(input: Omit<UnsignedCursorPayload, "schema_version"> & { cursor_secret: string }): string {
  const unsigned: UnsignedCursorPayload = {
    schema_version: 1,
    root_receipt_id: input.root_receipt_id,
    offset: input.offset,
    query_digest: input.query_digest,
  };
  return Buffer.from(stableJson({ ...unsigned, signature: cursorSignature(unsigned, input.cursor_secret) }), "utf8").toString("base64url");
}
function decodeCursor(value: string): CuratorCursorEnvelope | null { return decodeCanonicalCuratorCursor(value); }
function cursorSignature(input: UnsignedCursorPayload, cursorSecret: string): string {
  return `sha256:${createHmac("sha256", cursorSecret).update(stableJson(input), "utf8").digest("hex")}`;
}
function parseStringArray(value: string): string[] { try { const parsed = JSON.parse(value); return Array.isArray(parsed) ? parsed.map(String) : []; } catch { return []; } }
function parseObject(value: string): Record<string, unknown> { try { return parseObjectValue(JSON.parse(value)); } catch { return {}; } }
function parseObjectValue(value: unknown): Record<string, unknown> { return isRecord(value) ? value : {}; }
function isRecord(value: unknown): value is Record<string, unknown> { return typeof value === "object" && value !== null && !Array.isArray(value); }
function compareText(left: string, right: string): number { return left < right ? -1 : left > right ? 1 : 0; }
function validDigest(value: string): boolean { return /^sha256:[0-9a-f]{64}$/u.test(value); }
function digest(value: unknown): `sha256:${string}` { return `sha256:${createHash("sha256").update(stableJson(value), "utf8").digest("hex")}`; }
function message(error: unknown): string { return error instanceof Error ? error.message : String(error); }
function chargeBlocked(error: unknown): CuratorQueryResult {
  return error instanceof CuratorActionChargeError
    ? blocked(error.code, error.message, false)
    : blocked("curator_action_charge_invalid", message(error), false);
}
function blocked(code: Extract<CuratorQueryResult, { kind: "blocked" }>["code"], reason: string, retryable: boolean, plan?: CuratorBatchChannelPlan): CuratorQueryResult { return { kind: "blocked", code, reason, retryable, ...(plan ? { current_plan: { revision: plan.plan_revision, digest: plan.plan_digest } } : {}) }; }
