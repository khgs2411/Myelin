import { afterEach, expect, test } from "bun:test";
import { openMemoryDbAt, type MemoryDb } from "../../src/memory/db.ts";
import type { EmbeddingTransport } from "../../src/memory/embedding-types.ts";
import { stableJson } from "../../src/runtime/json.ts";
import { recordCuratorActionChargeInOpenTransaction } from "../../src/session-maintenance/curator-action-charges.ts";
import { recordSMCBudgetGrant } from "../../src/session-maintenance/coverage-receipts.ts";
import { readSMCManifest } from "../../src/session-maintenance/manifest.ts";
import { transitionSessionMemoryAnchorJob } from "../../src/session-maintenance/job-lifecycle.ts";
import { readSMCOverlayIdentity } from "../../src/session-maintenance/overlay-store.ts";
import {
  evaluateCuratorBatchCoverage,
  prepareCuratorBatchChannelPlan,
  queryCuratorMemory,
  readCuratorAffectedWorkSet,
} from "../../src/session-maintenance/curator-retrieval-service.ts";
import type { CuratorBatchChannelPlan, CuratorChannelObligation } from "../../src/session-maintenance/curator-channel-plan.ts";
import type { CuratorQueryRequest } from "../../src/session-maintenance/curator-retrieval-types.ts";
import {
  activateSMCAuthority,
  configureSMCTestContract,
  planEvidence,
  prepareWithWorkflowBudgets,
  seedEvidence,
  seedIndexedMemory,
  SMC_TEST_NOW,
  SMC_TEST_WORKFLOW_BUDGETS,
} from "../helpers/smc-preparation.ts";
import { buildSMCTestProposal, completeSMCTestCoverage, stageSMCTestProposal } from "../helpers/smc-proposal-stage.ts";

const databases: MemoryDb[] = [];
afterEach(() => {
  while (databases.length > 0) databases.pop()!.close();
});

test("coordinator derives immutable obligations before query and rejects agent-owned selectors", async () => {
  const context = runningAnchor({ memory_count: 2, evidence_text: "Investigate Summary and session_memories/memory-1." });
  const plan = prepareCuratorBatchChannelPlan(context.db, identity(context));
  expect(plan.plan_revision).toBe(1);
  expect(plan.applicable_channels).toEqual(["lexical", "semantic", "exact", "link"]);
  expect(plan.obligations.some((item) => item.kind === "exact" && item.selector.memory_id === "memory-1")).toBe(true);
  expect(plan.obligations.some((item) => item.kind === "metadata")).toBe(false);
  expect(obligation(plan, "text").selector.scope).toEqual({
    repo_path: "/repo", git_branch: "feature/smc", git_commit: "abc123",
  });
  expect(context.db.query("SELECT count(*) AS n FROM smc_curator_batch_channel_plans").get()).toEqual({ n: 1 });

  const text = obligation(plan, "text");
  const invalid = {
    ...request(context, plan, [text], { query_text: "Summary", page_limit: 10 }),
    applicable_channels: ["lexical"],
    exact_ids: ["memory-0"],
  } as unknown as CuratorQueryRequest;
  expect(await queryCuratorMemory(context.db, invalid, { embedding_transport: fixedTransport() }))
    .toMatchObject({ kind: "blocked", code: "curator_request_invalid" });
  context.db.query("UPDATE smc_curator_batch_channel_plans SET overlay_digest = ? WHERE job_id = ?")
    .run(sha("tampered-plan-row"), context.job_id);
  expect(() => prepareCuratorBatchChannelPlan(context.db, identity(context))).toThrow("invalid_curator_channel_plan");
});

test("evidence-scoped obligations stay fixed when query results enlarge the work set", async () => {
  const context = runningAnchor({
    memory_count: 1,
    evidence_count: 2,
    evidence_text: "Investigate session_memories/memory-0.",
  });
  const first = prepareCuratorBatchChannelPlan(context.db, identity(context));
  const exact = first.obligations.filter((item) => item.kind === "exact");
  expect(exact).toHaveLength(2);
  expect(exact.map((item) => item.provenance)).toEqual([["evidence:evt-0"], ["evidence:evt-1"]]);

  expect(await queryCuratorMemory(context.db, request(context, first, [exact[0]!], { page_limit: 10 }), {
    embedding_transport: fixedTransport(),
  })).toMatchObject({ kind: "page" });
  const second = prepareCuratorBatchChannelPlan(context.db, identity(context));
  expect(second.plan_revision).toBe(1);
  expect(second.plan_digest).toBe(first.plan_digest);
  expect(second.obligations).toEqual(first.obligations);
});

test("repo, branch, and commit constraints must match on one memory context row", async () => {
  const context = runningAnchor({ memory_count: 2, evidence_text: "Summary" });
  context.db.query(
    `UPDATE smc_memory_snapshot_contexts
     SET git_branch = 'other-branch' WHERE job_id = ? AND memory_id = 'memory-1' AND ordinal = 0`,
  ).run(context.job_id);
  context.db.query(
    `INSERT INTO smc_memory_snapshot_contexts
      (job_id, memory_id, ordinal, repo_path, git_branch, git_commit, git_worktree_id, source_event_ref)
     VALUES (?, 'memory-1', 1, '/other-repo', 'feature/smc', 'abc123', 'wt-2', 'split-context')`,
  ).run(context.job_id);
  const plan = prepareCuratorBatchChannelPlan(context.db, identity(context));
  const result = await queryCuratorMemory(context.db, request(context, plan, [obligation(plan, "text")], {
    query_text: "Summary", page_limit: 10,
  }), { embedding_transport: fixedTransport() });
  if (result.kind !== "page") throw new Error(JSON.stringify(result));
  expect(result.matches.map((item) => item.stable_id)).toEqual(["memory-0"]);
});

test("explicit exact and one-hop link recall remain evidence-scoped and non-transitive", async () => {
  const context = runningAnchor({ memory_count: 2, evidence_text: "Review session_memories/memory-0" });
  context.db.query(
    "UPDATE smc_memory_snapshot_contexts SET repo_path = '/other-repo' WHERE job_id = ? AND memory_id = 'memory-1'",
  ).run(context.job_id);
  context.db.query(
    `INSERT INTO smc_memory_snapshot_links
      (job_id, link_id, source_memory_id, target_memory_id, project_key, relationship, reason,
       source_event_refs_json, created_at)
     VALUES (?, 1, 'memory-0', 'memory-1', 'demo', 'related', 'fixture', '[]', ?)`,
  ).run(context.job_id, SMC_TEST_NOW);
  const plan = prepareCuratorBatchChannelPlan(context.db, identity(context));
  const recalled = await queryCuratorMemory(context.db, request(context, plan, [
    obligation(plan, "exact"), obligation(plan, "link"),
  ], { page_limit: 10 }), { embedding_transport: fixedTransport() });
  if (recalled.kind !== "page") throw new Error(JSON.stringify(recalled));
  expect(recalled.matches.map((item) => item.stable_id)).toEqual(["memory-0"]);
  const after = prepareCuratorBatchChannelPlan(context.db, identity(context));
  expect(after).toMatchObject({ plan_revision: 1, plan_digest: plan.plan_digest });
  expect(after.obligations).toEqual(plan.obligations);
});

test("materializes lexical and semantic obligations once, paginates durably, and survives attempt recovery", async () => {
  const context = runningAnchor({ memory_count: 6, page_limit: 2, evidence_text: "Summary" });
  const plan = prepareCuratorBatchChannelPlan(context.db, identity(context));
  const query = request(context, plan, [obligation(plan, "text")], { query_text: "Summary", page_limit: 2 });
  const first = await queryCuratorMemory(context.db, query, { embedding_transport: fixedTransport() });
  expect(first).toMatchObject({ kind: "page", complete: false, truncated: false });
  if (first.kind !== "page" || !first.next_cursor) throw new Error(JSON.stringify(first));
  expect(first.diagnostics.map((item) => item.channel)).toEqual(["lexical", "semantic"]);
  const stored = context.db.query("SELECT payload_json FROM smc_coverage_receipts WHERE id = ?").get(first.receipt_id) as { payload_json: string };
  const cursorSecret = JSON.parse(stored.payload_json).materialization.cursor_secret as string;
  expect(JSON.stringify(first)).not.toContain(cursorSecret);
  expect(context.db.query("SELECT count(*) AS n FROM session_memory_query_logs").get()).toEqual({ n: 0 });

  const second = await queryCuratorMemory(context.db, { ...query, cursor: first.next_cursor }, {
    embedding_transport: throwingTransport("persisted continuation must not re-embed"),
  });
  expect(second).toMatchObject({ kind: "page", complete: false });
  const charges = context.db.query(
    "SELECT query_count, result_bytes FROM smc_curator_action_charges WHERE job_id = ? ORDER BY created_at, action_key",
  ).all(context.job_id);
  expect(charges).toHaveLength(2);
  expect(charges).toEqual(expect.arrayContaining([
    { query_count: 1, result_bytes: 0 },
    { query_count: 0, result_bytes: 0 },
  ]));
  expect(readCuratorAffectedWorkSet(context.db, context)).toHaveLength(4);

  context.db.query("UPDATE session_memory_anchor_attempts SET status = 'failed' WHERE id = ?").run(context.attempt_id);
  const recoveredEpoch = context.owner_epoch + 1;
  context.db.query("UPDATE session_memory_anchor_jobs SET owner_epoch = ? WHERE job_id = ?").run(recoveredEpoch, context.job_id);
  context.db.query("UPDATE project_session_mutation_fences SET owner_epoch = ? WHERE owner_id = ?").run(recoveredEpoch, context.job_id);
  context.db.query(
    `INSERT INTO session_memory_anchor_attempts
      (id, job_id, attempt_number, owner_epoch, attempt_kind, provider, status, details_json, created_at, updated_at)
     VALUES ('attempt-recovered', ?, 2, ?, 'smc', 'codex', 'running', '{}', ?, ?)`,
  ).run(context.job_id, recoveredEpoch, SMC_TEST_NOW, SMC_TEST_NOW);
  const recovered = { ...query, attempt_id: "attempt-recovered", owner_epoch: recoveredEpoch, cursor: first.next_cursor };
  expect(await queryCuratorMemory(context.db, recovered, { embedding_transport: throwingTransport("recovery replay") }))
    .toEqual(second);
  expect(context.db.query("SELECT count(*) AS n FROM smc_curator_action_charges").get()).toEqual({ n: 2 });
  context.db.query("DELETE FROM smc_curator_action_charges WHERE job_id = ?").run(context.job_id);
  expect(await queryCuratorMemory(context.db, recovered, { embedding_transport: throwingTransport("missing charge replay") }))
    .toMatchObject({ kind: "blocked", code: "curator_action_charge_missing" });
});

test("query budget is job-wide across materializations and a validated grant extends it", async () => {
  const context = runningAnchor({ memory_count: 1, evidence_text: "Summary", max_queries: 1 });
  const firstPlan = prepareCuratorBatchChannelPlan(context.db, identity(context));
  expect(await queryCuratorMemory(context.db, request(context, firstPlan, [obligation(firstPlan, "text")], {
    query_text: "Summary", page_limit: 10,
  }), { embedding_transport: fixedTransport() })).toMatchObject({ kind: "page" });
  const secondRequest = request(context, firstPlan, [obligation(firstPlan, "text")], { query_text: "Changed summary", page_limit: 10 });
  expect(await queryCuratorMemory(context.db, secondRequest, { embedding_transport: fixedTransport() }))
    .toMatchObject({ kind: "blocked", code: "curator_budget_exceeded" });
  expect(context.db.query("SELECT count(*) AS n FROM smc_curator_action_charges").get()).toEqual({ n: 1 });
  recordSMCBudgetGrant(context.db, {
    id: "grant-cross-batch-query", job_id: context.job_id, project_key: context.project_key,
    owner_epoch: context.owner_epoch, budget_name: "max_queries", additive_amount: 1,
    operator_id: "operator", reason: "finish second batch", manifest_digest: context.manifest_digest,
    created_at: SMC_TEST_NOW,
  });
  expect(await queryCuratorMemory(context.db, secondRequest, { embedding_transport: fixedTransport() }))
    .toMatchObject({ kind: "page" });
  expect(context.db.query("SELECT count(*) AS n FROM smc_curator_action_charges").get()).toEqual({ n: 2 });
});

test("affected-work-set grants extend the enforced job-wide ceiling without changing page controls", async () => {
  const context = runningAnchor({ memory_count: 2, evidence_text: "Summary", max_work_set: 1, page_limit: 2 });
  const plan = prepareCuratorBatchChannelPlan(context.db, identity(context));
  const query = request(context, plan, [obligation(plan, "text")], { query_text: "Summary", page_limit: 2 });

  expect(await queryCuratorMemory(context.db, query, { embedding_transport: fixedTransport() }))
    .toMatchObject({ kind: "blocked", code: "curator_work_set_budget_exceeded" });
  recordSMCBudgetGrant(context.db, {
    id: "grant-work-set", job_id: context.job_id, project_key: context.project_key,
    owner_epoch: context.owner_epoch, budget_name: "max_affected_work_set_size", additive_amount: 1,
    operator_id: "operator", reason: "admit the complete affected set", manifest_digest: context.manifest_digest,
    created_at: SMC_TEST_NOW,
  });
  const granted = await queryCuratorMemory(context.db, query, { embedding_transport: fixedTransport() });
  expect(granted).toMatchObject({ kind: "page", complete: true });
  if (granted.kind !== "page") throw new Error(JSON.stringify(granted));
  expect(granted.matches).toHaveLength(2);
  expect(readCuratorAffectedWorkSet(context.db, identity(context))).toHaveLength(2);
});

test("charge replay conflicts fail closed and an outer rollback leaves no durable charge", () => {
  const context = runningAnchor({ memory_count: 1, evidence_text: "Summary" });
  const manifest = readSMCManifest(context.db, context.job_id)!;
  const charge = {
    job_id: context.job_id, action_key: `curator_action_${sha("rollback-action").slice(7)}`, action_kind: "fetch_record" as const,
    request_digest: sha("charge-request"), result_digest: sha("charge-result"), query_count: 0 as const,
    result_bytes: 1, manifest_digest: context.manifest_digest, created_at: SMC_TEST_NOW,
  };
  expect(() => context.db.transaction(() => {
    recordCuratorActionChargeInOpenTransaction(context.db, manifest, charge);
    throw new Error("rollback-charge");
  }).immediate()).toThrow("rollback-charge");
  expect(context.db.query("SELECT count(*) AS n FROM smc_curator_action_charges").get()).toEqual({ n: 0 });
  context.db.transaction(() => recordCuratorActionChargeInOpenTransaction(context.db, manifest, charge)).immediate();
  expect(() => context.db.transaction(() => recordCuratorActionChargeInOpenTransaction(context.db, manifest, {
    ...charge, request_digest: sha("changed-request"),
  })).immediate()).toThrow("curator_action_charge_conflict");
  expect(context.db.query("SELECT count(*) AS n FROM smc_curator_action_charges").get()).toEqual({ n: 1 });
});

test("effective budget grant overflow fails closed", async () => {
  const context = runningAnchor({ memory_count: 1, evidence_text: "Summary" });
  const plan = prepareCuratorBatchChannelPlan(context.db, identity(context));
  recordSMCBudgetGrant(context.db, {
    id: "grant-query-overflow", job_id: context.job_id, project_key: context.project_key,
    owner_epoch: context.owner_epoch, budget_name: "max_queries", additive_amount: Number.MAX_SAFE_INTEGER,
    operator_id: "operator", reason: "overflow regression", manifest_digest: context.manifest_digest,
    created_at: SMC_TEST_NOW,
  });
  expect(await queryCuratorMemory(context.db, request(context, plan, [obligation(plan, "text")], {
    query_text: "Summary", page_limit: 10,
  }), { embedding_transport: fixedTransport() }))
    .toMatchObject({ kind: "blocked", code: "curator_budget_overflow" });
  expect(context.db.query("SELECT count(*) AS n FROM smc_curator_action_charges").get()).toEqual({ n: 0 });
});

test("cursor validation rejects empty, noncanonical, extra-key, and bad-signature envelopes", async () => {
  const context = runningAnchor({ memory_count: 3, page_limit: 1, evidence_text: "Summary" });
  const plan = prepareCuratorBatchChannelPlan(context.db, identity(context));
  const query = request(context, plan, [obligation(plan, "text")], { query_text: "Summary", page_limit: 1 });
  const first = await queryCuratorMemory(context.db, query, { embedding_transport: fixedTransport() });
  if (first.kind !== "page" || !first.next_cursor) throw new Error(JSON.stringify(first));
  expect(await queryCuratorMemory(context.db, { ...query, cursor: "" }, { embedding_transport: fixedTransport() }))
    .toMatchObject({ kind: "blocked", code: "curator_request_invalid" });
  expect(await queryCuratorMemory(context.db, { ...query, cursor: `${first.next_cursor}=` }, { embedding_transport: fixedTransport() }))
    .toMatchObject({ kind: "blocked", code: "curator_request_invalid" });

  const parsed = JSON.parse(Buffer.from(first.next_cursor, "base64url").toString("utf8")) as Record<string, unknown>;
  const extraKey = Buffer.from(stableJson({ ...parsed, unsigned_extra: true }), "utf8").toString("base64url");
  expect(await queryCuratorMemory(context.db, { ...query, cursor: extraKey }, { embedding_transport: fixedTransport() }))
    .toMatchObject({ kind: "blocked", code: "curator_request_invalid" });
  const noncanonical = Buffer.from(JSON.stringify({
    signature: parsed.signature,
    schema_version: parsed.schema_version,
    root_receipt_id: parsed.root_receipt_id,
    query_digest: parsed.query_digest,
    offset: parsed.offset,
  }), "utf8").toString("base64url");
  expect(await queryCuratorMemory(context.db, { ...query, cursor: noncanonical }, { embedding_transport: fixedTransport() }))
    .toMatchObject({ kind: "blocked", code: "curator_request_invalid" });
  const signature = String(parsed.signature);
  const badSignature = Buffer.from(stableJson({
    ...parsed, signature: `${signature.slice(0, -1)}${signature.endsWith("a") ? "b" : "a"}`,
  }), "utf8").toString("base64url");
  expect(await queryCuratorMemory(context.db, { ...query, cursor: badSignature }, { embedding_transport: fixedTransport() }))
    .toMatchObject({ kind: "blocked", code: "curator_cursor_invalid" });
});

test("accepted overlay has separate searchable rows, masks base memory, and forces a monotonic plan revision", async () => {
  const context = runningAnchor({ memory_count: 2, evidence_text: "Replacement" });
  const plan1 = prepareCuratorBatchChannelPlan(context.db, identity(context));
  const preOverlayQuery = request(context, plan1, [obligation(plan1, "text")], { query_text: "Replacement", page_limit: 1 });
  const preOverlayPage = await queryCuratorMemory(context.db, preOverlayQuery, { embedding_transport: fixedTransport() });
  if (preOverlayPage.kind !== "page" || !preOverlayPage.next_cursor) throw new Error(JSON.stringify(preOverlayPage));
  await completeSMCTestCoverage(context.db, identity(context), fixedTransport());
  const coveredPlan = prepareCuratorBatchChannelPlan(context.db, identity(context));
  const affected = readCuratorAffectedWorkSet(context.db, { job_id: context.job_id, work_batch_id: context.work_batch_id });
  const base = affected.find((member) => member.stable_id === "memory-0")!;
  const proposal = buildSMCTestProposal(context.db, {
    identity: identity(context),
    staged_operations: [{
      record_kind: "memory",
      stable_key: "replacement",
      operation: "upsert",
      value: memoryPayload("replacement", "Replacement summary"),
    }],
    memory_dispositions: affected.map((member) => member.stable_id === base.stable_id ? {
      memory_id: base.stable_id,
      revision_identity: base.revision_identity,
      disposition: "supersede" as const,
      replacement_memory_id: "replacement",
      relationship: "supersedes" as const,
      reason: "replacement",
      source_event_refs: ["evt-0"],
    } : {
      memory_id: member.stable_id,
      revision_identity: member.revision_identity,
      disposition: "keep" as const,
      reason: "unchanged",
      source_event_refs: [],
    }),
  });
  const accepted = await stageSMCTestProposal(context.db, {
    identity: identity(context),
    proposal,
    document_contract: context.document_contract,
    embedding_transport: fixedTransport(),
    created_at: SMC_TEST_NOW,
  });
  if (accepted.kind !== "accepted") throw new Error(JSON.stringify(accepted));
  expect(context.db.query("SELECT count(*) AS n FROM smc_overlay_search_indexes").get()).toEqual({ n: 1 });
  const domain = context.db.query(
    `SELECT r.payload_json, r.payload_digest, i.index_digest AS search_index_digest
     FROM smc_overlay_records r JOIN smc_overlay_search_indexes i
       ON i.job_id = r.job_id AND i.revision = r.revision AND i.staged_id = r.staged_id
     WHERE r.record_kind = 'memory'`,
  )
    .get() as { payload_json: string; payload_digest: string; search_index_digest: string };
  expect(JSON.parse(domain.payload_json)).toEqual(memoryPayload("replacement", "Replacement summary"));
  expect(domain.payload_digest).not.toEqual(domain.search_index_digest);

  const overlayIdentity = readSMCOverlayIdentity(context.db, context.job_id)!;
  const changed = { ...context, overlay_revision: 1 };
  expect(await queryCuratorMemory(context.db, { ...preOverlayQuery, cursor: preOverlayPage.next_cursor }, { embedding_transport: fixedTransport() }))
    .toMatchObject({ kind: "blocked", code: "curator_identity_mismatch" });
  const plan2 = prepareCuratorBatchChannelPlan(context.db, identity(changed));
  expect(plan2.plan_revision).toBeGreaterThan(coveredPlan.plan_revision);
  expect(plan2).toMatchObject({ parent_plan_digest: coveredPlan.plan_digest, overlay_revision: 1 });
  expect(plan2.obligations.some((item) => item.kind === "overlay")).toBe(true);
  const result = await queryCuratorMemory(context.db, request(changed, plan2, [obligation(plan2, "text"), obligation(plan2, "overlay")], {
    query_text: "Replacement", page_limit: 10,
  }), { embedding_transport: fixedTransport() });
  if (result.kind !== "page") throw new Error(JSON.stringify(result));
  expect(result.matches.some((item) => item.stable_id === "memory-0")).toBe(false);
  expect(result.matches.some((item) => item.revision_identity.origin === "overlay")).toBe(true);
});

test("provider failure persists neither a query receipt nor an affected-work-set admission", async () => {
  const context = runningAnchor({ memory_count: 1, evidence_text: "Summary" });
  const plan = prepareCuratorBatchChannelPlan(context.db, identity(context));
  const result = await queryCuratorMemory(context.db, request(context, plan, [obligation(plan, "text")], {
    query_text: "Summary", page_limit: 10,
  }), { embedding_transport: throwingTransport("provider unavailable") });
  expect(result).toMatchObject({ kind: "blocked", code: "embedding_provider_unavailable", retryable: true });
  expect(context.db.query("SELECT count(*) AS n FROM smc_coverage_receipts").get()).toEqual({ n: 0 });
});

test("semantic truncation still paginates every materialized hit but never proves coverage", async () => {
  const context = runningAnchor({ memory_count: 3, page_limit: 1, semantic_ceiling: 2, evidence_text: "Summary" });
  const plan = prepareCuratorBatchChannelPlan(context.db, identity(context));
  const query = request(context, plan, [obligation(plan, "text")], { query_text: "Summary", page_limit: 1 });
  let page = await queryCuratorMemory(context.db, query, { embedding_transport: fixedTransport() });
  let pages = 0;
  while (page.kind === "page") {
    pages += 1;
    expect(page.truncated).toBe(true);
    expect(page.complete).toBe(false);
    if (!page.next_cursor) break;
    page = await queryCuratorMemory(context.db, { ...query, cursor: page.next_cursor }, { embedding_transport: throwingTransport("replay") });
  }
  expect(pages).toBe(3);
  expect(evaluateCuratorBatchCoverage(context.db, identity(context))).toMatchObject({
    complete: false, code: "curator_channel_coverage_incomplete",
  });
});

test("fixed seed-plan coverage requires a terminal receipt for every obligation-channel pair", async () => {
  const context = runningAnchor({ memory_count: 2, page_limit: 10, evidence_text: "Summary session_memories/memory-1" });
  let plan = prepareCuratorBatchChannelPlan(context.db, identity(context));
  const text = obligation(plan, "text");
  const first = await queryCuratorMemory(context.db, request(context, plan, [text], { query_text: "Summary", page_limit: 10 }), {
    embedding_transport: fixedTransport(),
  });
  expect(first).toMatchObject({ kind: "page", complete: true });
  const incomplete = evaluateCuratorBatchCoverage(context.db, identity(context));
  expect(incomplete.complete).toBe(false);
  if (incomplete.complete) throw new Error("expected explicit-reference obligations to remain uncovered");
  plan = incomplete.plan;
  expect(plan.plan_revision).toBe(1);
  expect(plan.obligations.some((item) => item.kind === "link")).toBe(true);
  await exhaustPlan(context, plan);
  expect(evaluateCuratorBatchCoverage(context.db, identity(context))).toMatchObject({ complete: true, plan: { plan_revision: 1 } });
  expect(prepareCuratorBatchChannelPlan(context.db, identity(context))).toMatchObject({
    plan_revision: 1, plan_digest: plan.plan_digest,
  });
});

test("coverage rejects a materialization whose persisted page chain has a missing middle page", async () => {
  const context = runningAnchor({ memory_count: 3, page_limit: 10, evidence_text: "Summary" });
  const plan = prepareCuratorBatchChannelPlan(context.db, identity(context));
  const text = obligation(plan, "text");
  await exhaustPlan(context, { ...plan, obligations: plan.obligations.filter((item) => item.id !== text.id) });
  const textQuery = request(context, plan, [text], { query_text: "Summary", page_limit: 1 });
  const root = await queryCuratorMemory(context.db, textQuery, { embedding_transport: fixedTransport() });
  if (root.kind !== "page") throw new Error(JSON.stringify(root));
  await exhaustQuery(context, textQuery);
  expect(evaluateCuratorBatchCoverage(context.db, identity(context))).toMatchObject({ complete: true });
  context.db.query("DELETE FROM smc_coverage_receipts WHERE id = ?").run(`${root.receipt_id}_page_1`);
  const incomplete = evaluateCuratorBatchCoverage(context.db, identity(context));
  expect(incomplete).toMatchObject({ complete: false, code: "curator_channel_coverage_incomplete" });
  if (incomplete.complete) throw new Error("missing middle page must fail coverage");
  expect(incomplete.missing).toEqual(expect.arrayContaining(text.required_channels.map((channel) => `${text.id}:${channel}`)));
});

test("large retrieval stays paged instead of returning a corpus-sized public envelope", async () => {
  const context = runningAnchor({ memory_count: 3_219, page_limit: 50, max_work_set: 4_000, evidence_text: "Summary" });
  const plan = prepareCuratorBatchChannelPlan(context.db, identity(context));
  const result = await queryCuratorMemory(context.db, request(context, plan, [obligation(plan, "text")], {
    query_text: "Summary", page_limit: 50,
  }), { embedding_transport: fixedTransport() });
  if (result.kind !== "page") throw new Error(JSON.stringify(result));
  expect(result.matches).toHaveLength(50);
  expect(result.next_cursor).not.toBeNull();
  expect(Buffer.byteLength(JSON.stringify(result), "utf8")).toBeLessThan(100_000);
}, 20_000);

async function exhaustPlan(context: ReturnType<typeof runningAnchor>, plan: CuratorBatchChannelPlan): Promise<void> {
  for (const item of plan.obligations) {
    const query = request(context, plan, [item], {
      ...(item.kind === "text" ? { query_text: "Summary" } : {}), page_limit: 10,
    });
    let result = await queryCuratorMemory(context.db, query, { embedding_transport: fixedTransport() });
    while (result.kind === "page" && result.next_cursor) {
      result = await queryCuratorMemory(context.db, { ...query, cursor: result.next_cursor }, { embedding_transport: throwingTransport("page replay") });
    }
    if (result.kind !== "page") throw new Error(JSON.stringify(result));
  }
}

async function exhaustQuery(context: ReturnType<typeof runningAnchor>, query: CuratorQueryRequest): Promise<void> {
  let result = await queryCuratorMemory(context.db, query, { embedding_transport: fixedTransport() });
  while (result.kind === "page" && result.next_cursor) {
    result = await queryCuratorMemory(context.db, { ...query, cursor: result.next_cursor }, { embedding_transport: throwingTransport("page replay") });
  }
  if (result.kind !== "page") throw new Error(JSON.stringify(result));
}

function runningAnchor(input: {
  memory_count: number; evidence_text: string; evidence_count?: number; page_limit?: number;
  semantic_ceiling?: number; max_work_set?: number; max_queries?: number;
}) {
  const db = openMemoryDbAt(":memory:");
  databases.push(db);
  const documentContract = configureSMCTestContract(db);
  for (let index = 0; index < input.memory_count; index += 1) seedIndexedMemory(db, { id: `memory-${index}`, summary: `Summary ${index}` });
  for (let index = 0; index < (input.evidence_count ?? 1); index += 1) seedEvidence(db, `evt-${index}`, input.evidence_text);
  activateSMCAuthority(db);
  const prepared = prepareWithWorkflowBudgets(db, planEvidence(db, `job-curator-${input.memory_count}`), {
    ...SMC_TEST_WORKFLOW_BUDGETS,
    retrieval_page_item_limit: input.page_limit ?? 100,
    semantic_qualifying_result_ceiling: input.semantic_ceiling ?? 4_000,
    max_affected_work_set_size: input.max_work_set ?? 1_000,
    max_queries: input.max_queries ?? SMC_TEST_WORKFLOW_BUDGETS.max_queries,
    max_cumulative_returned_result_bytes: 2_000_000,
  });
  if (prepared.kind !== "prepared") throw new Error(JSON.stringify(prepared));
  const frozenIds = prepared.manifest.active_memory_count === 0 ? [] : (db.query(
    "SELECT memory_id FROM smc_memory_snapshot WHERE job_id = ? ORDER BY memory_id",
  ).all(prepared.manifest.job_id) as Array<{ memory_id: string }>);
  const insertContext = db.query(
    `INSERT INTO smc_memory_snapshot_contexts
      (job_id, memory_id, ordinal, repo_path, git_branch, git_commit, git_worktree_id, source_event_ref)
     VALUES (?, ?, 0, '/repo', 'feature/smc', 'abc123', 'wt-1', ?)`,
  );
  for (const row of frozenIds) insertContext.run(prepared.manifest.job_id, row.memory_id, `context-${row.memory_id}`);
  db.query(
    `INSERT INTO session_memory_anchor_attempts
      (id, job_id, attempt_number, owner_epoch, attempt_kind, provider, status, details_json, created_at, updated_at)
     VALUES ('attempt-curator', ?, 1, ?, 'smc', 'codex', 'running', '{}', ?, ?)`,
  ).run(prepared.manifest.job_id, prepared.manifest.owner_epoch, SMC_TEST_NOW, SMC_TEST_NOW);
  const transition = transitionSessionMemoryAnchorJob(db, {
    jobId: prepared.manifest.job_id, projectKey: prepared.manifest.project_key, expectedPhase: "preparing",
    expectedOwnerEpoch: prepared.manifest.owner_epoch, nextPhase: "running", now: SMC_TEST_NOW,
  });
  if (transition.kind !== "updated") throw new Error(JSON.stringify(transition));
  const batches = db.query("SELECT batch_id FROM smc_work_batches WHERE job_id = ? ORDER BY ordinal")
    .all(prepared.manifest.job_id) as Array<{ batch_id: string }>;
  return {
    db, job_id: prepared.manifest.job_id, project_key: prepared.manifest.project_key, work_batch_id: batches[0]!.batch_id,
    batch_ids: batches.map((item) => item.batch_id),
    attempt_id: "attempt-curator", owner_epoch: prepared.manifest.owner_epoch,
    manifest_digest: prepared.manifest.manifest_digest, snapshot_token: prepared.manifest.snapshot_token,
    overlay_revision: 0, document_contract: { ...documentContract, purpose: "retrieval_document" as const },
  };
}

function identity(context: ReturnType<typeof runningAnchor>) {
  const { db: _db, document_contract: _contract, batch_ids: _batchIds, ...value } = context;
  return value;
}

function obligation(plan: CuratorBatchChannelPlan, kind: CuratorChannelObligation["kind"]): CuratorChannelObligation {
  const value = plan.obligations.find((item) => item.kind === kind);
  if (!value) throw new Error(`missing ${kind} obligation`);
  return value;
}

function request(
  context: ReturnType<typeof runningAnchor>,
  plan: CuratorBatchChannelPlan,
  obligations: readonly CuratorChannelObligation[],
  input: { query_text?: string; page_limit: number },
): CuratorQueryRequest {
  return {
    ...identity(context), plan_revision: plan.plan_revision, plan_digest: plan.plan_digest,
    obligation_ids: obligations.map((item) => item.id), ...input,
  };
}

function fixedTransport(): EmbeddingTransport {
  return { async embed(request) { return { embedding: [0.1, 0.2, 0.3], model: request.contract.model, dimensions: request.contract.dimensions }; } };
}

function throwingTransport(message: string): EmbeddingTransport {
  return { async embed() { throw new Error(message); } };
}

function memoryPayload(id: string, summary: string) {
  return {
    id,
    memory_kind: "continuity" as const,
    title: summary,
    summary,
    payload: { status: "active" },
    source_event_refs: ["evt-0"],
    confidence: "high",
    risk: "low",
  };
}

function sha(value: string): `sha256:${string}` {
  return `sha256:${new Bun.CryptoHasher("sha256").update(value).digest("hex")}`;
}
