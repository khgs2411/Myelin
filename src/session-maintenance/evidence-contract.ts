import { z } from "zod";

const evidenceString = z.string();
const evidenceNullableString = evidenceString.nullable();

export const SMCNormalizedEvidenceSchema = z.strictObject({
  source_id: evidenceString.min(1),
  project_key: evidenceString.min(1),
  inserted_at: evidenceString.min(1),
  occurred_at: evidenceString.min(1),
  hook_event_name: evidenceNullableString,
  event_kind: evidenceNullableString,
  cwd: evidenceNullableString,
  provider: evidenceString.min(1),
  provider_session_id: evidenceNullableString,
  turn_id: evidenceNullableString,
  raw_text: evidenceNullableString,
  raw_payload_json: evidenceString,
  source: evidenceString.min(1),
  status: z.enum(["valid", "invalid"]),
  repo_path: evidenceNullableString,
  git_branch: evidenceNullableString,
  git_commit: evidenceNullableString,
  git_worktree_id: evidenceNullableString,
  dedupe_key: evidenceNullableString,
});

export type SMCNormalizedEvidence = z.infer<typeof SMCNormalizedEvidenceSchema>;
