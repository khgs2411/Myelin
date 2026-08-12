import { z } from "zod";
import { SESSION_MEMORY_LINK_RELATIONSHIPS } from "../memory/ingest-types.ts";
import {
  SessionMaintenanceCandidateSchema,
  SessionMaintenanceHandoffSchema,
  SessionMaintenanceMemorySchema,
  SessionMaintenanceProjectionMemoryDispositionSchema,
  SessionMaintenanceSourceDispositionSchema,
  SessionMemoryRevisionIdentitySchema,
} from "./output-contract.ts";

export const SMC_BATCH_PROPOSAL_SCHEMA_VERSION = 1 as const;

const nonEmpty = z.string().trim().min(1);
const digest = z.string().regex(/^sha256:[0-9a-f]{64}$/u);

const proposalDispositionFields = {
  memory_id: nonEmpty,
  revision_identity: SessionMemoryRevisionIdentitySchema,
};

export const SMCProposalMemoryDispositionSchema = z.discriminatedUnion("disposition", [
  z.strictObject({
    ...proposalDispositionFields,
    disposition: z.literal("keep"),
    reason: nonEmpty,
    source_event_refs: z.array(nonEmpty),
  }),
  z.strictObject({
    ...proposalDispositionFields,
    disposition: z.literal("supersede"),
    replacement_memory_id: nonEmpty,
    relationship: z.enum(SESSION_MEMORY_LINK_RELATIONSHIPS),
    reason: nonEmpty,
    source_event_refs: z.array(nonEmpty).min(1),
  }),
  z.strictObject({
    ...proposalDispositionFields,
    disposition: z.literal("retract"),
    reason: nonEmpty,
    source_event_refs: z.array(nonEmpty).min(1),
  }),
]);

export const SMCDispositionReceiptReuseSchema = z.strictObject({
  memory_id: nonEmpty,
  revision_identity: SessionMemoryRevisionIdentitySchema,
  accepted_work_batch_id: nonEmpty,
  accepted_overlay_revision: z.number().int().positive(),
  accepted_overlay_digest: digest,
  accepted_disposition_digest: digest,
  policy_identity: digest,
  output_contract_identity: digest,
  tool_protocol_identity: digest,
  invocation_identity: z.strictObject({
    provider: nonEmpty,
    model: z.string().trim().min(1).nullable(),
    reasoning_effort: z.string().trim().min(1).nullable(),
  }),
});

const upsertOperation = <const K extends string, T extends z.ZodType>(recordKind: K, value: T) => z.strictObject({
  record_kind: z.literal(recordKind),
  operation: z.literal("upsert"),
  stable_key: nonEmpty,
  value,
});

const discardOperation = <const K extends string>(recordKind: K) => z.strictObject({
  record_kind: z.literal(recordKind),
  operation: z.literal("discard"),
  stable_key: nonEmpty,
});

export const SMCProposalOperationSchema = z.union([
  upsertOperation("memory", SessionMaintenanceMemorySchema),
  discardOperation("memory"),
  upsertOperation("candidate", SessionMaintenanceCandidateSchema),
  discardOperation("candidate"),
  upsertOperation("handoff", SessionMaintenanceHandoffSchema),
  discardOperation("handoff"),
]);

export const SMCBatchProposalSchema = z.strictObject({
  schema_version: z.literal(SMC_BATCH_PROPOSAL_SCHEMA_VERSION),
  work_batch_id: nonEmpty,
  expected_overlay_revision: z.number().int().nonnegative(),
  source_event_dispositions: z.array(SessionMaintenanceSourceDispositionSchema),
  memory_dispositions: z.array(SMCProposalMemoryDispositionSchema),
  disposition_receipt_reuses: z.array(SMCDispositionReceiptReuseSchema),
  staged_operations: z.array(SMCProposalOperationSchema),
  checked_output_refs: z.array(nonEmpty),
  terminal_summary: z.string().trim().min(1).nullable(),
});

export type SMCBatchProposal = z.infer<typeof SMCBatchProposalSchema>;
export type SMCProposalMemoryDisposition = z.infer<typeof SMCProposalMemoryDispositionSchema>;
export type SMCDispositionReceiptReuse = z.infer<typeof SMCDispositionReceiptReuseSchema>;
export type SMCProposalOperation = z.infer<typeof SMCProposalOperationSchema>;

export function parseSMCBatchProposal(value: unknown): SMCBatchProposal {
  const parsed = SMCBatchProposalSchema.parse(value);
  return SMCBatchProposalSchema.parse({
    ...parsed,
    source_event_dispositions: [...parsed.source_event_dispositions]
      .map((item) => item.disposition === "used"
        ? { ...item, output_refs: [...item.output_refs].sort(compareText) }
        : item)
      .sort((left, right) => compareText(left.source_event_id, right.source_event_id)),
    memory_dispositions: [...parsed.memory_dispositions]
      .map((item) => ({ ...item, source_event_refs: [...item.source_event_refs].sort(compareText) }))
      .sort((left, right) => compareText(left.memory_id, right.memory_id)),
    disposition_receipt_reuses: [...parsed.disposition_receipt_reuses]
      .sort((left, right) => compareText(left.memory_id, right.memory_id)),
    staged_operations: [...parsed.staged_operations]
      .map((item) => item.operation === "discard" ? item : {
        ...item,
        value: {
          ...item.value,
          source_event_refs: [...item.value.source_event_refs].sort(compareText),
          ...(item.record_kind === "handoff"
            ? { source_session_memory_ids: [...item.value.source_session_memory_ids].sort(compareText) }
            : {}),
        },
      })
      .sort((left, right) => compareText(
        `${left.record_kind}\u0000${left.stable_key}`,
        `${right.record_kind}\u0000${right.stable_key}`,
      )),
    checked_output_refs: [...parsed.checked_output_refs].sort(compareText),
  });
}

export function smcBatchProposalJsonSchema(): Record<string, unknown> {
  return z.toJSONSchema(SMCBatchProposalSchema, { target: "draft-2020-12", reused: "ref" }) as Record<string, unknown>;
}

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}
