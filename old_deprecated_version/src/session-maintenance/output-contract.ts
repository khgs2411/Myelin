import { z } from "zod";
import {
  HANDOFF_SCOPES,
  MEMORY_SCOPES,
  SESSION_MEMORY_KINDS,
  SESSION_MEMORY_LINK_RELATIONSHIPS,
} from "../memory/ingest-types.ts";

export const SESSION_MAINTENANCE_OUTPUT_CONTRACT_VERSION = 1 as const;
export const SESSION_MAINTENANCE_PROJECTION_CONTRACT_VERSION = 2 as const;

const nonEmptyString = z.string().trim().min(1);
const identifier = nonEmptyString;
const stringArray = z.array(nonEmptyString);
const nonEmptyStringArray = stringArray.min(1);
const sha256Digest = z.string().regex(/^sha256:[0-9a-f]{64}$/u);

export const SessionMemoryRevisionIdentitySchema = z.discriminatedUnion("origin", [
  z.strictObject({
    origin: z.literal("base"),
    revision: z.number().int().positive(),
    state_digest: sha256Digest,
  }),
  z.strictObject({
    origin: z.literal("overlay"),
    overlay_revision: z.number().int().nonnegative(),
    overlay_digest: sha256Digest,
    payload_digest: sha256Digest,
  }),
]);

export const SessionMaintenanceMemorySchema = z.strictObject({
  id: identifier,
  source_event_refs: nonEmptyStringArray,
  memory_kind: z.enum(SESSION_MEMORY_KINDS),
  title: z.string().trim().min(1).nullable(),
  summary: nonEmptyString,
  payload: z.record(z.string(), z.json()),
  confidence: nonEmptyString,
  risk: nonEmptyString,
});

export const SessionMaintenanceCandidateSchema = z.strictObject({
  id: identifier,
  source_event_refs: nonEmptyStringArray,
  scope: z.enum(MEMORY_SCOPES),
  status: z.enum(["pending", "needs_review"]),
  candidate_type: nonEmptyString,
  title: z.string().trim().min(1).nullable(),
  summary: nonEmptyString,
  evidence: z.strictObject({
    observed_facts: nonEmptyStringArray,
    relevant_paths: stringArray,
    uncertainties: stringArray,
  }),
  proposed_payload: z.strictObject({
    durable_facts: nonEmptyStringArray,
    change_kind: nonEmptyString,
    suggested_subjects: stringArray,
    verification_needed: stringArray,
  }),
  confidence: nonEmptyString,
  risk: nonEmptyString,
  reason: nonEmptyString,
});

export const SessionMaintenanceHandoffSchema = z.strictObject({
  id: identifier,
  target_scope: z.enum(HANDOFF_SCOPES),
  status: z.enum(["pending", "needs_review"]),
  objective: nonEmptyString,
  prompt_text: nonEmptyString,
  source_session_memory_ids: stringArray,
  source_event_refs: nonEmptyStringArray,
  suggested_actions: stringArray,
  reason: nonEmptyString,
  confidence: nonEmptyString,
  risk: nonEmptyString,
});

export const SessionMaintenanceMemoryDispositionSchema = z.discriminatedUnion("disposition", [
  z.strictObject({
    memory_id: identifier,
    disposition: z.literal("keep"),
    reason: nonEmptyString,
    source_event_refs: stringArray,
  }),
  z.strictObject({
    memory_id: identifier,
    disposition: z.literal("supersede"),
    replacement_memory_id: identifier,
    relationship: z.enum(SESSION_MEMORY_LINK_RELATIONSHIPS),
    reason: nonEmptyString,
    source_event_refs: nonEmptyStringArray,
  }),
  z.strictObject({
    memory_id: identifier,
    disposition: z.literal("retract"),
    reason: nonEmptyString,
    source_event_refs: nonEmptyStringArray,
  }),
]);

export const SessionMaintenanceSourceDispositionSchema = z.discriminatedUnion("disposition", [
  z.strictObject({
    source_event_id: identifier,
    disposition: z.literal("used"),
    output_refs: nonEmptyStringArray,
    reason: nonEmptyString,
  }),
  z.strictObject({
    source_event_id: identifier,
    disposition: z.literal("no_output"),
    reason: nonEmptyString,
  }),
]);

const projectionDispositionFields = {
  memory_id: identifier,
  revision_identity: SessionMemoryRevisionIdentitySchema,
  work_kind: z.enum(["evidence", "audit"]),
};

export const SessionMaintenanceProjectionMemoryDispositionSchema = z.discriminatedUnion("disposition", [
  z.strictObject({
    ...projectionDispositionFields,
    disposition: z.literal("keep"),
    reason: nonEmptyString,
    source_event_refs: stringArray,
  }),
  z.strictObject({
    ...projectionDispositionFields,
    disposition: z.literal("supersede"),
    replacement_memory_id: identifier,
    relationship: z.enum(SESSION_MEMORY_LINK_RELATIONSHIPS),
    reason: nonEmptyString,
    source_event_refs: nonEmptyStringArray,
  }),
  z.strictObject({
    ...projectionDispositionFields,
    disposition: z.literal("retract"),
    reason: nonEmptyString,
    source_event_refs: nonEmptyStringArray,
  }),
]);

const governingIdentitySchema = z.strictObject({ version: nonEmptyString, digest: sha256Digest });

export const SessionMaintenanceProjectionSchema = z.strictObject({
  schema_version: z.literal(SESSION_MAINTENANCE_PROJECTION_CONTRACT_VERSION),
  job_id: identifier,
  project_key: identifier,
  manifest_digest: sha256Digest,
  snapshot_token: sha256Digest,
  overlay_revision: z.number().int().nonnegative(),
  overlay_digest: sha256Digest,
  governing_identities: z.strictObject({
    policy: governingIdentitySchema,
    output_contract: governingIdentitySchema,
    tool_protocol: governingIdentitySchema,
    invocation: z.strictObject({
      provider: nonEmptyString,
      model: z.string().trim().min(1).nullable(),
      reasoning_effort: z.string().trim().min(1).nullable(),
    }),
  }),
  session_memories: z.array(SessionMaintenanceMemorySchema),
  memory_candidates: z.array(SessionMaintenanceCandidateSchema),
  handoff_instructions: z.array(SessionMaintenanceHandoffSchema),
  memory_dispositions: z.array(SessionMaintenanceProjectionMemoryDispositionSchema),
  source_event_dispositions: z.array(SessionMaintenanceSourceDispositionSchema),
});

/** Historical v1 accepted-result reader shape; never used for provider execution. */
export const SessionMaintenanceOutputSchema = z.strictObject({
  schema_version: z.literal(SESSION_MAINTENANCE_OUTPUT_CONTRACT_VERSION),
  session_memories: z.array(SessionMaintenanceMemorySchema),
  memory_candidates: z.array(SessionMaintenanceCandidateSchema),
  handoff_instructions: z.array(SessionMaintenanceHandoffSchema),
  memory_dispositions: z.array(SessionMaintenanceMemoryDispositionSchema),
  source_event_dispositions: z.array(SessionMaintenanceSourceDispositionSchema),
  terminal_summary: z.string().trim().min(1).nullable(),
});

export type SessionMaintenanceOutput = z.infer<typeof SessionMaintenanceOutputSchema>;
export type SessionMaintenanceMemoryDisposition = SessionMaintenanceOutput["memory_dispositions"][number];
export type SessionMaintenanceSourceEventDisposition = SessionMaintenanceOutput["source_event_dispositions"][number];
export type SessionMaintenanceProjection = z.infer<typeof SessionMaintenanceProjectionSchema>;
export type SessionMaintenanceProjectionMemoryDisposition = SessionMaintenanceProjection["memory_dispositions"][number];

export function parseSessionMaintenanceOutput(value: unknown): SessionMaintenanceOutput {
  return SessionMaintenanceOutputSchema.parse(value);
}

export function parseSessionMaintenanceProjection(value: unknown): SessionMaintenanceProjection {
  const parsed = SessionMaintenanceProjectionSchema.parse(value);
  return SessionMaintenanceProjectionSchema.parse({
    ...parsed,
    session_memories: [...parsed.session_memories]
      .map((item) => ({ ...item, source_event_refs: [...item.source_event_refs].sort(compareText) }))
      .sort((left, right) => compareText(left.id, right.id)),
    memory_candidates: [...parsed.memory_candidates]
      .map((item) => ({ ...item, source_event_refs: [...item.source_event_refs].sort(compareText) }))
      .sort((left, right) => compareText(left.id, right.id)),
    handoff_instructions: [...parsed.handoff_instructions]
      .map((item) => ({
        ...item,
        source_event_refs: [...item.source_event_refs].sort(compareText),
        source_session_memory_ids: [...item.source_session_memory_ids].sort(compareText),
      }))
      .sort((left, right) => compareText(left.id, right.id)),
    memory_dispositions: [...parsed.memory_dispositions]
      .map((item) => ({ ...item, source_event_refs: [...item.source_event_refs].sort(compareText) }))
      .sort((left, right) => compareText(left.memory_id, right.memory_id)),
    source_event_dispositions: [...parsed.source_event_dispositions]
      .map((item) => item.disposition === "used"
        ? { ...item, output_refs: [...item.output_refs].sort(compareText) }
        : item)
      .sort((left, right) => compareText(left.source_event_id, right.source_event_id)),
  });
}

export function sessionMaintenanceProjectionJsonSchema(): Record<string, unknown> {
  return z.toJSONSchema(SessionMaintenanceProjectionSchema, {
    target: "draft-2020-12",
    reused: "ref",
  }) as Record<string, unknown>;
}

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}
