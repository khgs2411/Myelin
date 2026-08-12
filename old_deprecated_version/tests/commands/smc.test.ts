import { afterEach, beforeEach, expect, test } from "bun:test";
import { createCli } from "../../src/commands/registry.ts";
import { registerSMCCommands, renderSMCStatusHuman } from "../../src/commands/smc.ts";
import { openMemoryDbAt, type MemoryDb } from "../../src/memory/db.ts";
import { EmbeddingProviderInitializationError } from "../../src/memory/embedding-provider-errors.ts";
import {
  activateSMCAuthority,
  configureSMCTestContract,
  planEvidence,
  prepare,
  seedEvidence,
  seedIndexedMemory,
} from "../helpers/smc-preparation.ts";

let db: MemoryDb;

beforeEach(() => {
  db = openMemoryDbAt(":memory:");
  configureSMCTestContract(db);
  seedIndexedMemory(db, { id: "memory-cli" });
  seedEvidence(db, "event-cli", "TOP SECRET EVIDENCE PAYLOAD");
  activateSMCAuthority(db);
});

afterEach(() => db.close());

test("SMC help exposes a dedicated bounded service surface", async () => {
  const result = await cli().run(["smc", "--help"]);
  expect(result.exitCode).toBe(0);
  expect(result.message).toContain("myelin smc manifest");
  expect(result.message).toContain("myelin smc query --request-json");
  expect(result.message).toContain(
    "myelin smc cleanup <project-key> <job-id> --owner-epoch N --terminal-receipt-digest sha256:",
  );
  expect(result.message).not.toContain("SQL");
});

test("manifest, progress, batches, overlay, and journal default to privacy-safe metadata", async () => {
  const prepared = prepare(db, planEvidence(db, "job-cli-inspect"));
  if (prepared.kind !== "prepared") throw new Error(JSON.stringify(prepared));

  for (const args of [
    ["smc", "manifest", "job-cli-inspect", "--json"],
    ["smc", "progress", "job-cli-inspect", "--json"],
    ["smc", "batches", "job-cli-inspect", "--json"],
    ["smc", "overlay", "job-cli-inspect", "--json"],
    ["smc", "journal", "job-cli-inspect", "--json"],
  ]) {
    const result = await cli().run(args);
    expect(result.exitCode).toBe(0);
    expect(JSON.parse(result.message).contract_version).toBe("myelin.smc.cli.v1");
    expect(result.message).not.toContain("TOP SECRET EVIDENCE PAYLOAD");
    expect(result.message).not.toContain("raw_text");
  }
});

test("metadata pagination is manifest-capped and invalid JSON arguments keep the machine envelope", async () => {
  const prepared = prepare(db, planEvidence(db, "job-cli-pagination"));
  if (prepared.kind !== "prepared") throw new Error(JSON.stringify(prepared));

  const overLimit = await cli().run([
    "smc", "batches", prepared.manifest.job_id,
    "--limit", String(prepared.manifest.workflow_budgets.retrieval_page_item_limit + 1),
    "--json",
  ]);
  expect(overLimit.exitCode).toBe(1);
  expect(JSON.parse(overLimit.message)).toMatchObject({
    contract_version: "myelin.smc.cli.v1",
    reason_code: "smc_page_limit_invalid",
  });

  const malformed = await cli().run(["smc", "query", "--request-json", "{", "--json"]);
  expect(malformed.exitCode).toBe(1);
  expect(JSON.parse(malformed.message)).toMatchObject({
    contract_version: "myelin.smc.cli.v1",
    reason_code: "smc_cli_invalid_arguments",
  });

  const missingValue = await cli().run([
    "smc", "batches", prepared.manifest.job_id, "--limit", "--json",
  ]);
  expect(missingValue.exitCode).toBe(1);
  expect(JSON.parse(missingValue.message)).toMatchObject({
    contract_version: "myelin.smc.cli.v1",
    reason_code: "smc_cli_invalid_arguments",
  });

  const unsafeCleanup = await cli().run([
    "smc", "cleanup", "demo", prepared.manifest.job_id,
    "--owner-epoch", "1",
    "--terminal-receipt-digest", "not-a-digest",
    "--json",
  ]);
  expect(unsafeCleanup.exitCode).toBe(1);
  expect(JSON.parse(unsafeCleanup.message)).toMatchObject({
    contract_version: "myelin.smc.cli.v1",
    reason_code: "smc_cli_invalid_arguments",
  });
});

test("human status renders queued age, authority diagnostics, fences, provider state, and reason codes", () => {
  const prepared = prepare(db, planEvidence(db, "job-cli-human-status"));
  if (prepared.kind !== "prepared") throw new Error(JSON.stringify(prepared));
  const status = {
    contract_version: "myelin.smc.status.v1" as const,
    kind: "session_memory_curator_status" as const,
    generated_at: "2026-08-12T00:00:00.000Z",
    project_key: "demo",
    authority_mode: "smc_v1" as const,
    queued_content: { count: 2, oldest_inserted_at: "2026-08-11T23:59:00.000Z", oldest_age_ms: 60_000 },
    current_anchor: {
      job_id: prepared.manifest.job_id, phase: "preparing" as const, owner_epoch: 1,
      reason_code: null, heartbeat_at: "2026-08-12T00:00:00.000Z", attempt_id: null, provider: null,
      process: { authority: "diagnostic_only" as const, process_id: 4321, liveness: "not_alive" as const },
      permanently_denied_legacy_identity: false,
    },
    project_fence: {
      owner_id: prepared.manifest.job_id, owner_kind: "anchor_job" as const, phase: "preparing" as const,
      owner_epoch: 1, heartbeat_at: "2026-08-12T00:00:00.000Z",
    },
    global_embedding_fence: null,
    freshness: { state: "pending" as const, last_completed_at: null, queued_content_count: 2 },
    audit_coverage: { active_revision_count: 1, covered_revision_count: 0, due_revision_count: 1 },
    indexing: { state: "unavailable" as const, active_memory_count: 1, indexed_count: 1, pending_count: 0, failed_count: 0, provider_state: "unreachable" as const },
    legacy: { permanently_denied_job_count: 0 },
    reason_codes: ["smc_anchor_active", "smc_embedding_provider_unreachable"] as const,
  };

  const human = renderSMCStatusHuman(status);
  expect(human).toContain("queued=2 oldest_age_ms=60000");
  expect(human).toContain("liveness=not_alive (diagnostic_only)");
  expect(human).toContain("project_fence=anchor_job:");
  expect(human).toContain("indexing=unavailable/unreachable");
  expect(human).toContain("reasons=smc_anchor_active,smc_embedding_provider_unreachable");
});

test("proposal validation does not echo untrusted proposal payloads", async () => {
  const result = await cli().run([
    "smc",
    "proposal",
    "validate",
    "--request-json",
    JSON.stringify({
      job_id: "missing",
      project_key: "demo",
      attempt_id: "attempt",
      owner_epoch: 1,
      manifest_digest: `sha256:${"0".repeat(64)}`,
      snapshot_token: `sha256:${"1".repeat(64)}`,
      proposal: { injected: "DO NOT ECHO THIS SECRET" },
    }),
    "--json",
  ]);

  expect(result.exitCode).toBe(1);
  expect(JSON.parse(result.message)).toMatchObject({
    contract_version: "myelin.smc.cli.v1",
    ok: false,
    reason_code: "proposal_validation_failed",
  });
  expect(result.message).not.toContain("DO NOT ECHO THIS SECRET");
});

test("stale-epoch abandonment returns a stable reason without releasing ownership", async () => {
  const prepared = prepare(db, planEvidence(db, "job-cli-stale-owner"));
  if (prepared.kind !== "prepared") throw new Error(JSON.stringify(prepared));

  const result = await cli().run([
    "smc", "abandon", "demo", prepared.manifest.job_id,
    "--owner-epoch", "2",
    "--receipt-id", "receipt-cli-stale",
    "--request-id", "request-cli-stale",
    "--operator-id", "operator-cli",
    "--reason", "operator requested",
    "--json",
  ]);

  expect(result.exitCode).toBe(1);
  expect(JSON.parse(result.message)).toMatchObject({
    contract_version: "myelin.smc.cli.v1",
    ok: false,
    reason_code: "smc_abandon_stale_epoch",
  });
  expect(db.query("SELECT phase, owner_epoch FROM session_memory_anchor_jobs WHERE job_id = ?")
    .get(prepared.manifest.job_id)).toEqual({ phase: "preparing", owner_epoch: 1 });
  expect(db.query("SELECT owner_id, owner_epoch FROM project_session_mutation_fences WHERE project_key = 'demo'").get())
    .toEqual({ owner_id: prepared.manifest.job_id, owner_epoch: 1 });
});

test("resume, grant, and finalization reject stale capabilities without mutating the anchor", async () => {
  const prepared = prepare(db, planEvidence(db, "job-cli-capabilities"));
  if (prepared.kind !== "prepared") throw new Error(JSON.stringify(prepared));

  const resumed = await cli().run([
    "smc", "resume", "demo", prepared.manifest.job_id, "--owner-epoch", "2", "--json",
  ]);
  expect(resumed.exitCode).toBe(1);
  expect(JSON.parse(resumed.message)).toMatchObject({
    contract_version: "myelin.smc.cli.v1",
    ok: false,
  });

  const grant = await cli().run([
    "smc", "grant", "demo", prepared.manifest.job_id,
    "--owner-epoch", "1",
    "--manifest-digest", `sha256:${"0".repeat(64)}`,
    "--grant-id", "grant-cli-capabilities",
    "--budget", "max_queries",
    "--amount", "1",
    "--operator-id", "operator-cli",
    "--reason", "approved extension",
    "--json",
  ]);
  expect(grant.exitCode).toBe(1);
  expect(JSON.parse(grant.message)).toMatchObject({
    reason_code: "smc_budget_grant_identity_mismatch",
  });

  const finalized = await cli().run([
    "smc", "finalize", prepared.manifest.job_id,
    "--owner-epoch", "1",
    "--accepted-projection-digest", `sha256:${"1".repeat(64)}`,
    "--json",
  ]);
  expect(finalized.exitCode).toBe(1);
  expect(JSON.parse(finalized.message)).toMatchObject({
    reason_code: "finalization_authority_mismatch",
  });

  expect(db.query("SELECT phase, owner_epoch FROM session_memory_anchor_jobs WHERE job_id = ?")
    .get(prepared.manifest.job_id)).toEqual({ phase: "preparing", owner_epoch: 1 });

  const nonEffectiveGrant = await cli().run([
    "smc", "grant", "demo", prepared.manifest.job_id,
    "--owner-epoch", "1",
    "--manifest-digest", prepared.manifest.manifest_digest,
    "--grant-id", "grant-cli-non-effective",
    "--budget", "retrieval_page_item_limit",
    "--amount", "1",
    "--operator-id", "operator-cli",
    "--reason", "must remain frozen",
    "--json",
  ]);
  expect(nonEffectiveGrant.exitCode).toBe(1);
  expect(JSON.parse(nonEffectiveGrant.message)).toMatchObject({ reason_code: "smc_cli_invalid_arguments" });

  const cleanup = await cli({ forensicRetentionMs: 0 }).run([
    "smc", "cleanup", "demo", prepared.manifest.job_id,
    "--owner-epoch", "2",
    "--terminal-receipt-digest", `sha256:${"2".repeat(64)}`,
    "--json",
  ]);
  expect(cleanup.exitCode).toBe(1);
  expect(JSON.parse(cleanup.message)).toMatchObject({
    reason_code: "smc_forensic_cleanup_stale_epoch",
  });
});

test("query reports current-process provider reachability with a stable retryable code", async () => {
  const prepared = prepare(db, planEvidence(db, "job-cli-provider"));
  if (prepared.kind !== "prepared") throw new Error(JSON.stringify(prepared));

  const result = await cli({
    initializeEmbedding: async () => {
      throw new EmbeddingProviderInitializationError("ollama_nomic", "unreachable", "socket blocked");
    },
  }).run([
    "smc", "query", "--request-json", JSON.stringify({ job_id: prepared.manifest.job_id }), "--json",
  ]);

  expect(result.exitCode).toBe(1);
  expect(JSON.parse(result.message)).toMatchObject({
    contract_version: "myelin.smc.cli.v1",
    ok: false,
    reason_code: "embedding_provider_unreachable",
    retryable: true,
  });
  expect(result.message).toContain("unreachable from the current Myelin process");
  expect(result.message).not.toContain("sandbox denied");
});

function cli(overrides: Partial<Parameters<typeof registerSMCCommands>[1]> = {}) {
  const value = createCli("myelin");
  registerSMCCommands(value, {
    db,
    context: {
      myelinRoot: "/tmp/myelin-test",
      callerCwd: "/repo",
      invocationKind: "test",
      rootSource: "test_dependency",
      launcherPath: null,
      locatorPath: null,
    },
    ...overrides,
  });
  return value;
}
