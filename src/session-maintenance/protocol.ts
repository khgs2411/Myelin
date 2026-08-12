import { z } from "zod";
import {
  CURATOR_RECORD_REJECTION_CODES,
  CuratorRecordValueSchema,
} from "./curator-record-service.ts";
import {
  CURATOR_QUERY_BLOCK_CODES,
  CURATOR_RETRIEVAL_CHANNELS,
} from "./curator-retrieval-types.ts";
import {
  SMC_OVERLAY_REJECTION_CODES,
  SMC_PROPOSAL_BLOCK_CODES,
} from "./overlay-store.ts";
import { SMCBatchProposalSchema } from "./proposal-contract.ts";
import { SMC_PROPOSAL_VALIDATION_ISSUE_CODES } from "./proposal-validator.ts";

export const SMC_TOOL_PROTOCOL_VERSION = "2" as const;

const nonEmpty = z.string().trim().min(1);
const digest = z.string().regex(/^sha256:[0-9a-f]{64}$/u);
const revisionIdentity = z.union([
  z.strictObject({ origin: z.literal("base"), revision: z.number().int().positive(), state_digest: digest }),
  z.strictObject({
    origin: z.literal("overlay"),
    overlay_revision: z.number().int().nonnegative(),
    overlay_digest: digest,
    payload_digest: digest,
  }),
]);

const actionIdentity = {
  protocol_version: z.literal(SMC_TOOL_PROTOCOL_VERSION),
  job_id: nonEmpty,
  project_key: nonEmpty,
  work_batch_id: nonEmpty,
  attempt_id: nonEmpty,
  sequence: z.number().int().nonnegative(),
  owner_epoch: z.number().int().positive(),
  manifest_digest: digest,
  snapshot_token: digest,
  expected_overlay_revision: z.number().int().nonnegative(),
} as const;

const queryAction = z.strictObject({
  ...actionIdentity,
  action: z.literal("query"),
  request: z.strictObject({
    plan_revision: z.number().int().positive(),
    plan_digest: digest,
    text_obligation_id: nonEmpty,
    query_text: z.string().trim().min(1),
  }),
});

const fetchRecordAction = z.strictObject({
  ...actionIdentity,
  action: z.literal("fetch_record"),
  request: z.discriminatedUnion("record_kind", [
    z.strictObject({
      record_kind: z.literal("memory"),
      stable_id: nonEmpty,
      expected_revision: revisionIdentity,
      max_encoded_bytes: z.number().int().positive(),
    }),
    z.strictObject({
      record_kind: z.literal("source"),
      stable_id: nonEmpty,
      expected_source_hash: digest,
      max_encoded_bytes: z.number().int().positive(),
    }),
  ]),
});

const submitProposalAction = z.strictObject({
  ...actionIdentity,
  action: z.literal("submit_proposal"),
  request: z.strictObject({ proposal: SMCBatchProposalSchema }),
});

export const SMC_AGENT_BLOCKER_CODES = [
  "insufficient_evidence",
  "proposal_incomplete",
  "repository_verification_failed",
  "retrieval_unavailable",
] as const;

const blockerAction = z.strictObject({
  ...actionIdentity,
  action: z.literal("blocker"),
  request: z.strictObject({
    code: z.enum(SMC_AGENT_BLOCKER_CODES),
    retryable: z.boolean(),
    explanation: z.string().trim().min(1).max(4_000),
  }),
});

export const SMCActionSchema = z.discriminatedUnion("action", [
  queryAction,
  fetchRecordAction,
  submitProposalAction,
  blockerAction,
]);

const resultIdentity = {
  protocol_version: z.literal(SMC_TOOL_PROTOCOL_VERSION),
  job_id: nonEmpty,
  project_key: nonEmpty,
  work_batch_id: nonEmpty,
  attempt_id: nonEmpty,
  sequence: z.number().int().nonnegative(),
  owner_epoch: z.number().int().positive(),
  manifest_digest: digest,
  snapshot_token: digest,
  expected_overlay_revision: z.number().int().nonnegative(),
} as const;

const curatorQueryMatch = z.strictObject({
  stable_id: nonEmpty,
  title: z.string().nullable(),
  summary: z.string(),
  memory_kind: nonEmpty,
  revision_identity: revisionIdentity,
  channels: z.array(z.enum(CURATOR_RETRIEVAL_CHANNELS)),
  obligation_ids: z.array(nonEmpty),
  semantic_distance: z.number().optional(),
});

const curatorChannelDiagnostic = z.strictObject({
  obligation_id: nonEmpty,
  channel: z.enum(CURATOR_RETRIEVAL_CHANNELS),
  applicable: z.literal(true),
  qualifying_count: z.number().int().nonnegative(),
  materialized_count: z.number().int().nonnegative(),
  truncated: z.boolean(),
  complete: z.boolean(),
});

export const SMCQueryResultPayloadSchema = z.discriminatedUnion("kind", [
  z.strictObject({
    kind: z.literal("page"),
    receipt_id: nonEmpty,
    receipt_digest: digest,
    query_digest: digest,
    plan_revision: z.number().int().positive(),
    plan_digest: digest,
    snapshot_token: digest,
    overlay_revision: z.number().int().nonnegative(),
    matches: z.array(curatorQueryMatch),
    diagnostics: z.array(curatorChannelDiagnostic),
    next_cursor: nonEmpty.nullable(),
    complete: z.boolean(),
    truncated: z.boolean(),
    affected_work_set_receipt_id: nonEmpty,
  }),
  z.strictObject({
    kind: z.literal("blocked"),
    code: z.enum(CURATOR_QUERY_BLOCK_CODES),
    reason: z.string(),
    retryable: z.boolean(),
    current_plan: z.strictObject({ revision: z.number().int().positive(), digest }).optional(),
  }),
]);

export const SMCFetchRecordResultPayloadSchema = z.discriminatedUnion("kind", [
  z.strictObject({
    kind: z.literal("record"),
    record: CuratorRecordValueSchema,
    encoded_bytes: z.number().int().nonnegative(),
  }),
  z.strictObject({
    kind: z.literal("rejected"),
    code: z.enum(CURATOR_RECORD_REJECTION_CODES),
    reason: z.string(),
  }),
]);

const proposalValidationIssue = z.strictObject({
  code: z.enum(SMC_PROPOSAL_VALIDATION_ISSUE_CODES),
  path: z.string(),
  message: z.string(),
});

export const SMCSubmitProposalResultPayloadSchema = z.union([
  z.strictObject({
    kind: z.literal("accepted"),
    overlay: z.strictObject({ revision: z.number().int().nonnegative(), digest }),
    response_digest: digest,
    replayed: z.boolean(),
  }),
  z.strictObject({
    kind: z.literal("rejected"),
    code: z.enum(SMC_OVERLAY_REJECTION_CODES),
  }),
  z.strictObject({
    kind: z.literal("rejected"),
    code: z.literal("proposal_validation_failed"),
    issues: z.array(proposalValidationIssue),
  }),
  z.strictObject({
    kind: z.literal("blocked"),
    code: z.enum(SMC_PROPOSAL_BLOCK_CODES),
    reason: z.string(),
    retryable: z.boolean(),
  }),
]);

export const SMCResultSchema = z.discriminatedUnion("result_kind", [
  z.strictObject({ ...resultIdentity, result_kind: z.literal("query_result"), result: SMCQueryResultPayloadSchema }),
  z.strictObject({ ...resultIdentity, result_kind: z.literal("fetch_record_result"), result: SMCFetchRecordResultPayloadSchema }),
  z.strictObject({ ...resultIdentity, result_kind: z.literal("submit_proposal_result"), result: SMCSubmitProposalResultPayloadSchema }),
  z.strictObject({
    ...resultIdentity,
    result_kind: z.literal("blocker_result"),
    code: nonEmpty,
    retryable: z.boolean(),
    explanation: nonEmpty,
  }),
  z.strictObject({
    ...resultIdentity,
    result_kind: z.literal("action_validation_failed"),
    code: z.literal("action_validation_failed"),
    retryable: z.literal(true),
    issues: z.array(z.strictObject({ path: nonEmpty, message: nonEmpty })),
  }),
  z.strictObject({
    ...resultIdentity,
    result_kind: z.literal("coordinator_failure"),
    code: nonEmpty,
    retryable: z.boolean(),
    reason: nonEmpty,
  }),
]);

export type SMCAction = z.infer<typeof SMCActionSchema>;
export type SMCResult = z.infer<typeof SMCResultSchema>;
export type SMCActionIdentity = Pick<SMCAction,
  "protocol_version" | "job_id" | "project_key" | "work_batch_id" | "attempt_id" | "sequence"
  | "owner_epoch" | "manifest_digest" | "snapshot_token" | "expected_overlay_revision">;

export type SMCActionInspection =
  | { valid: true; action: SMCAction }
  | { valid: false; issues: ReadonlyArray<{ path: string; message: string }> };

export function inspectSMCAction(value: unknown): SMCActionInspection {
  const parsed = SMCActionSchema.safeParse(value);
  if (parsed.success) return { valid: true, action: parsed.data };
  return {
    valid: false,
    issues: parsed.error.issues.map((issue) => ({
      path: issue.path.length === 0 ? "$" : issue.path.join("."),
      message: issue.message,
    })),
  };
}

export function smcActionJsonSchema(): Record<string, unknown> {
  return z.toJSONSchema(SMCActionSchema, { target: "draft-2020-12", reused: "ref" }) as Record<string, unknown>;
}

export function smcResultJsonSchema(): Record<string, unknown> {
  return z.toJSONSchema(SMCResultSchema, { target: "draft-2020-12", reused: "ref" }) as Record<string, unknown>;
}
