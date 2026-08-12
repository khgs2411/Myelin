export const CURATOR_RETRIEVAL_CHANNELS = [
  "lexical",
  "semantic",
  "exact",
  "filter",
  "link",
  "overlay",
] as const;

export const CURATOR_QUERY_BLOCK_CODES = [
  "curator_request_invalid",
  "curator_identity_mismatch",
  "curator_channel_plan_missing",
  "curator_channel_plan_stale",
  "curator_channel_plan_conflict",
  "curator_channel_plan_input_drift",
  "curator_query_obligation_invalid",
  "curator_query_value_not_admitted",
  "curator_channel_coverage_incomplete",
  "curator_cursor_invalid",
  "curator_cursor_stale",
  "curator_overlay_unsearchable",
  "curator_result_ceiling_exceeded",
  "curator_work_set_budget_exceeded",
  "curator_action_charge_conflict",
  "curator_action_charge_missing",
  "curator_action_charge_invalid",
  "curator_budget_exceeded",
  "curator_budget_overflow",
  "embedding_provider_configuration",
  "embedding_provider_unreachable",
  "embedding_provider_unavailable",
] as const;

export type CuratorRetrievalChannel = (typeof CURATOR_RETRIEVAL_CHANNELS)[number];

export type CuratorQueryIdentity = Readonly<{
  job_id: string;
  project_key: string;
  work_batch_id: string;
  attempt_id: string;
  owner_epoch: number;
  manifest_digest: string;
  snapshot_token: string;
  overlay_revision: number;
}>;

export type CuratorQueryRequest = CuratorQueryIdentity & Readonly<{
  plan_revision: number;
  plan_digest: string;
  obligation_ids: readonly string[];
  query_text?: string;
  page_limit: number;
  cursor?: string | null;
}>;

export type CuratorBaseRevisionIdentity = Readonly<{
  origin: "base";
  revision: number;
  state_digest: string;
}>;

export type CuratorOverlayRevisionIdentity = Readonly<{
  origin: "overlay";
  overlay_revision: number;
  overlay_digest: string;
  payload_digest: string;
}>;

export type CuratorMemoryRevisionIdentity = CuratorBaseRevisionIdentity | CuratorOverlayRevisionIdentity;

export type CuratorQueryMatch = Readonly<{
  stable_id: string;
  title: string | null;
  summary: string;
  memory_kind: string;
  revision_identity: CuratorMemoryRevisionIdentity;
  channels: readonly CuratorRetrievalChannel[];
  obligation_ids: readonly string[];
  semantic_distance?: number;
}>;

export type CuratorChannelDiagnostic = Readonly<{
  obligation_id: string;
  channel: CuratorRetrievalChannel;
  applicable: true;
  qualifying_count: number;
  materialized_count: number;
  truncated: boolean;
  complete: boolean;
}>;

export type CuratorQueryResult =
  | Readonly<{
    kind: "page";
    receipt_id: string;
    receipt_digest: string;
    query_digest: string;
    plan_revision: number;
    plan_digest: string;
    snapshot_token: string;
    overlay_revision: number;
    matches: readonly CuratorQueryMatch[];
    diagnostics: readonly CuratorChannelDiagnostic[];
    next_cursor: string | null;
    complete: boolean;
    truncated: boolean;
    affected_work_set_receipt_id: string;
  }>
  | Readonly<{
    kind: "blocked";
    code: (typeof CURATOR_QUERY_BLOCK_CODES)[number];
    reason: string;
    retryable: boolean;
    current_plan?: Readonly<{ revision: number; digest: string }>;
  }>;

export type CuratorAffectedWorkSetMember = Readonly<{
  stable_id: string;
  revision_identity: CuratorMemoryRevisionIdentity;
}>;

export type CuratorCursorEnvelope = Readonly<{
  schema_version: 1;
  root_receipt_id: string;
  offset: number;
  query_digest: string;
  signature: string;
}>;

export function decodeCanonicalCuratorCursor(value: string): CuratorCursorEnvelope | null {
  if (value === "" || !/^[A-Za-z0-9_-]+$/u.test(value)) return null;
  let decoded: string;
  try {
    const bytes = Buffer.from(value, "base64url");
    if (bytes.byteLength === 0 || bytes.toString("base64url") !== value) return null;
    decoded = bytes.toString("utf8");
  } catch {
    return null;
  }
  try {
    const parsed = JSON.parse(decoded) as unknown;
    if (!isRecord(parsed) || stableJson(parsed) !== decoded) return null;
    const keys = Object.keys(parsed).sort();
    if (keys.join("\u0000") !== ["offset", "query_digest", "root_receipt_id", "schema_version", "signature"].join("\u0000")) return null;
    if (parsed.schema_version !== 1
      || typeof parsed.root_receipt_id !== "string" || parsed.root_receipt_id === ""
      || !Number.isSafeInteger(parsed.offset) || (parsed.offset as number) <= 0
      || typeof parsed.query_digest !== "string" || !/^sha256:[0-9a-f]{64}$/u.test(parsed.query_digest)
      || typeof parsed.signature !== "string" || !/^sha256:[0-9a-f]{64}$/u.test(parsed.signature)) return null;
    return parsed as CuratorCursorEnvelope;
  } catch {
    return null;
  }
}

export function validateCuratorQueryRequest(
  request: CuratorQueryRequest,
  input: { max_page_limit: number; text_obligation_ids: ReadonlySet<string>; admitted_obligation_ids: ReadonlySet<string> },
): string | null {
  const allowedKeys = [
    "attempt_id", "cursor", "job_id", "manifest_digest", "obligation_ids", "overlay_revision",
    "owner_epoch", "page_limit", "plan_digest", "plan_revision", "project_key", "query_text",
    "snapshot_token", "work_batch_id",
  ];
  const unknownKeys = Object.keys(request).filter((key) => !allowedKeys.includes(key));
  if (unknownKeys.length > 0) return `unknown request fields: ${unknownKeys.sort().join(",")}`;
  for (const [name, value] of [
    ["job_id", request.job_id], ["project_key", request.project_key], ["work_batch_id", request.work_batch_id],
    ["attempt_id", request.attempt_id], ["manifest_digest", request.manifest_digest],
    ["snapshot_token", request.snapshot_token], ["plan_digest", request.plan_digest],
  ] as const) if (typeof value !== "string" || value.trim() === "") return `${name} must be a non-empty string`;
  if (!Number.isSafeInteger(request.owner_epoch) || request.owner_epoch <= 0) return "owner_epoch must be positive";
  if (!Number.isSafeInteger(request.overlay_revision) || request.overlay_revision < 0) return "overlay_revision must be nonnegative";
  if (!Number.isSafeInteger(request.plan_revision) || request.plan_revision <= 0) return "plan_revision must be positive";
  if (!Number.isSafeInteger(request.page_limit) || request.page_limit <= 0 || request.page_limit > input.max_page_limit) {
    return `page_limit must be between 1 and ${input.max_page_limit}`;
  }
  if (!Array.isArray(request.obligation_ids) || request.obligation_ids.length === 0) return "obligation_ids must be a non-empty array";
  if (request.obligation_ids.some((id) => typeof id !== "string" || id.trim() === "")) return "obligation_ids must contain non-empty strings";
  if (new Set(request.obligation_ids).size !== request.obligation_ids.length) return "obligation_ids must be unique";
  if (request.obligation_ids.some((id) => !input.admitted_obligation_ids.has(id))) return "obligation_ids contain an unadmitted value";
  const selectedTextCount = request.obligation_ids.filter((id) => input.text_obligation_ids.has(id)).length;
  if (selectedTextCount > 1) return "a query may select at most one text obligation";
  const hasText = selectedTextCount === 1;
  if (hasText && (typeof request.query_text !== "string" || request.query_text.trim() === "")) {
    return "text obligations require non-empty query_text";
  }
  if (!hasText && request.query_text !== undefined) return "query_text is allowed only for text obligations";
  if (request.cursor !== undefined && request.cursor !== null) {
    if (typeof request.cursor !== "string") return "cursor must be a string or null";
    if (!decodeCanonicalCuratorCursor(request.cursor)) return "cursor must be a non-empty canonical cursor envelope";
  }
  return null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

import { stableJson } from "../runtime/json.ts";
