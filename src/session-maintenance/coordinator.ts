import type { Database } from "bun:sqlite";
import { createHash } from "node:crypto";
import type { SMCTurnInvoker } from "../agents/smc-adapter.ts";
import type { ResolvedLlmInvocation } from "../agents/contracts.ts";
import type { EmbeddingTransport } from "../memory/embedding-types.ts";
import type { ActiveEmbeddingContract } from "../runtime/config.ts";
import {
  SESSION_MEMORY_ANCHOR_REASON_CODES,
  type SessionMemoryAnchorReasonCode,
} from "../memory/ingest-types.ts";
import { stableJson } from "../runtime/json.ts";
import {
  persistJournaledSMCActionResult,
  persistJournaledSMCActionResultInOpenTransaction,
  prepareJournaledSMCAction,
  type PreparedSMCJournalAction,
  type SMCJournalActionInput,
  type SMCJournalResult,
} from "./action-journal.ts";
import { sumValidatedSMCBudgetGrants } from "./coverage-receipts.ts";
import { effectiveCuratorBudgets } from "./curator-action-charges.ts";
import {
  evaluateCuratorBatchCoverage,
} from "./curator-retrieval-service.ts";
import { queryCuratorMemory } from "./curator-retrieval-service.ts";
import { fetchCuratorRecord } from "./curator-record-service.ts";
import { hasExactCuratorMemoryFetchReceipt } from "./curator-fetch-receipts.ts";
import { transitionSessionMemoryAnchorJob } from "./job-lifecycle.ts";
import { readSMCManifest, type SMCManifest } from "./manifest.ts";
import { stageSMCBatchProposal } from "./overlay-store.ts";
import { buildSessionMaintenanceProjection, type AcceptedSessionMaintenanceProjection } from "./projection.ts";
import { writeSessionMaintenanceProjectionResultInOpenTransaction } from "./result.ts";
import {
  inspectSMCAction,
  SMCResultSchema,
  SMC_TOOL_PROTOCOL_VERSION,
  type SMCAction,
  type SMCActionIdentity,
  type SMCResult,
} from "./protocol.ts";
import { buildSMCWorkEnvelope, readSMCProviderFeedback, SMCProviderEnvelopeBudgetError } from "./work-envelope.ts";
import type { CuratorBatchChannelPlan } from "./curator-channel-plan.ts";

export type SMCCoordinatorResult =
  | Readonly<{
    kind: "accepted_projection";
    job_id: string;
    owner_epoch: number;
    projection: AcceptedSessionMaintenanceProjection;
  }>
  | Readonly<{
    kind: "needs_followup";
    job_id: string;
    owner_epoch: number;
    code: SessionMemoryAnchorReasonCode;
    retryable: boolean;
    reason: string;
  }>
  | Readonly<{
    kind: "rejected";
    code: "coordinator_identity_mismatch" | "coordinator_journal_rejected" | "coordinator_projection_rejected";
    reason: string;
  }>;

export async function runSMCCoordinator(
  db: Database,
  input: {
    job_id: string;
    project_key: string;
    attempt_id: string;
    owner_epoch: number;
    invoke_turn: SMCTurnInvoker;
    document_contract: ActiveEmbeddingContract;
    embedding_transport: EmbeddingTransport;
    now?: () => Date;
    timeout_ms?: number;
    env?: NodeJS.ProcessEnv;
    failure_injection?: {
      after_query_commit_before_return?: () => void;
      after_fetch_commit_before_return?: () => void;
      after_accepted_proposal_commit_before_return?: () => void;
    };
  },
): Promise<SMCCoordinatorResult> {
  const now = input.now ?? (() => new Date());
  let manifest = readSMCManifest(db, input.job_id);
  if (!manifest || manifest.project_key !== input.project_key || !runningCoordinatorIdentity(db, input, manifest)) {
    return rejected("coordinator_identity_mismatch", "prepared anchor, fence, attempt, or manifest identity does not match");
  }
  const invocation = resolvedInvocation(manifest);
  if (!invocation) {
    return followup(db, input, now, "provider_identity_invalid", false, "manifest provider identity is unsupported");
  }

  const batches = db.query(
    "SELECT batch_id, ordinal, work_kind FROM smc_work_batches WHERE job_id = ? ORDER BY ordinal",
  ).all(input.job_id) as Array<{ batch_id: string; ordinal: number; work_kind: "evidence" | "audit" }>;

  for (const batch of batches) {
    let batchState = acceptedBatchState(db, input.job_id, batch.batch_id);
    if (batchState === "invalid") return journalRejected("accepted batch is missing its exact submit-proposal journal result");
    if (batchState === "accepted") continue;
    while (batchState === "open") {
      const journalIntegrity = validateDurableJournal(db, input.job_id, batch.batch_id);
      if (journalIntegrity) return journalRejected(journalIntegrity);
      manifest = readSMCManifest(db, input.job_id);
      if (!manifest || !runningCoordinatorIdentity(db, input, manifest)) {
        return rejected("coordinator_identity_mismatch", "coordinator authority changed while the batch was open");
      }
      let maxTurns: number;
      try {
        maxTurns = addSafe(
          manifest.workflow_budgets.max_turns,
          sumValidatedSMCBudgetGrants(db, {
            job_id: manifest.job_id,
            manifest_digest: manifest.manifest_digest,
            budget_name: "max_turns",
          }),
        );
      } catch (error) {
        return followup(db, input, now, "budget_state_invalid", false, message(error));
      }
      if (countProviderTurns(db, manifest.job_id) >= maxTurns) {
        return followup(db, input, now, "budget_exhausted", true, "max_turns exhausted; an additive grant is required");
      }

      const sequence = nextSequence(db, manifest.job_id, batch.batch_id, input.attempt_id);
      const identity = actionIdentity(input, manifest, batch.batch_id, sequence);
      const coverage = evaluateCuratorBatchCoverage(db, {
        job_id: manifest.job_id,
        project_key: manifest.project_key,
        work_batch_id: batch.batch_id,
        attempt_id: input.attempt_id,
        owner_epoch: input.owner_epoch,
        manifest_digest: manifest.manifest_digest,
        snapshot_token: manifest.snapshot_token,
        overlay_revision: manifest.current_overlay_identity.revision,
      });
      const plan = coverage.plan;
      if (!coverage.complete) {
        const missingIds = missingObligationIds(coverage.missing);
        const nonText = plan.obligations.filter((item) => missingIds.has(item.id) && item.kind !== "text");
        if (nonText.length > 0) {
          const deterministic = await dispatchCoordinatorQuery(db, {
            manifest,
            input,
            work_batch_id: batch.batch_id,
            plan,
            obligation_ids: nonText.map((item) => item.id),
            query_text: undefined,
            created_at: now().toISOString(),
          });
          if (deterministic.kind === "journal_rejected") return journalRejected(deterministic.code);
          if (deterministic.followup) {
            return followup(db, input, now, deterministic.followup.code, deterministic.followup.retryable, deterministic.followup.reason);
          }
          continue;
        }
      }

      const missingText = coverage.complete
        ? []
        : plan.obligations.filter((item) => missingObligationIds(coverage.missing).has(item.id) && item.kind === "text");
      const textObligation = missingText[0] ?? null;
      if (textObligation) {
        const priorFormulation = readDurableTextFormulation(db, {
          job_id: manifest.job_id,
          work_batch_id: batch.batch_id,
          plan_revision: plan.plan_revision,
          plan_digest: plan.plan_digest,
          text_obligation_id: textObligation.id,
        });
        if (priorFormulation) {
          const resumed = await dispatchCoordinatorQuery(db, {
            manifest,
            input,
            work_batch_id: batch.batch_id,
            plan,
            obligation_ids: [textObligation.id],
            query_text: priorFormulation.query_text,
            created_at: now().toISOString(),
          });
          if (resumed.kind === "journal_rejected") return journalRejected(resumed.code);
          if (resumed.followup) {
            return followup(db, input, now, resumed.followup.code, resumed.followup.retryable, resumed.followup.reason);
          }
          continue;
        }
      }
      let budgets: ReturnType<typeof effectiveCuratorBudgets>;
      try {
        budgets = effectiveCuratorBudgets(db, manifest);
      } catch (error) {
        return followup(db, input, now, "budget_state_invalid", false, message(error));
      }
      const requiredAuditFetch = batch.work_kind === "audit" && coverage.complete
        ? nextRequiredAuditFetch(db, manifest, batch.batch_id, Math.min(
          budgets.max_provider_envelope_bytes,
          budgets.max_cumulative_returned_result_bytes,
        ))
        : null;
      const requiredReserve = requiredRemainingProviderTurns(
        db,
        manifest,
        batch.ordinal,
        missingText.length,
        requiredAuditFetch ? countMissingAuditFetches(db, manifest, batch.batch_id) : 0,
      );
      const consumedProviderTurns = countProviderTurns(db, manifest.job_id);
      if (maxTurns - consumedProviderTurns < requiredReserve) {
        return followup(
          db,
          input,
          now,
          "budget_exhausted",
          true,
          `provider turn reserve requires ${requiredReserve} remaining, configured/granted remaining is ${maxTurns - consumedProviderTurns}; an explicit additive grant is required`,
        );
      }
      let envelope;
      try {
        envelope = buildSMCWorkEnvelope(db, {
          manifest,
          work_batch_id: batch.batch_id,
          action_identity: identity,
          channel_plan: plan,
          coverage: coverage.complete
            ? { complete: true, missing: [] }
            : { complete: false, missing: coverage.missing },
          phase: textObligation
            ? { kind: "text_formulation", obligation: textObligation }
            : requiredAuditFetch
              ? { kind: "audit_fetch", required_action: requiredAuditFetch }
            : { kind: "proposal_ready" },
          max_encoded_bytes: budgets.max_provider_envelope_bytes,
        });
      } catch (error) {
        const code = error instanceof SMCProviderEnvelopeBudgetError
          ? error.code
          : "provider_envelope_invalid";
        await journalSyntheticFailure(db, identity, { coordinator_owned: true, envelope_error: message(error) }, {
          ...identity,
          result_kind: "coordinator_failure",
          code,
          retryable: error instanceof SMCProviderEnvelopeBudgetError,
          reason: message(error),
        }, now().toISOString());
        return followup(db, input, now, code, error instanceof SMCProviderEnvelopeBudgetError, message(error));
      }

      let rawAction: unknown;
      try {
        const turn = await input.invoke_turn({
          prompt: envelope.prompt,
          maxPromptBytes: envelope.max_encoded_bytes,
          resolvedInvocation: invocation,
          timeoutMs: input.timeout_ms,
          env: input.env,
          cwd: manifest.target_context.repo_path,
          stageId: "smc-turn",
        });
        if (stableJson(turn.invocation) !== stableJson(invocation)) {
          throw new Error("provider returned a different resolved invocation identity");
        }
        const feedback = readSMCProviderFeedback(db, {
          job_id: manifest.job_id,
          work_batch_id: batch.batch_id,
          action_identity: identity,
        });
        rawAction = normalizeProviderAction(turn.action, identity, feedback.best_rejected_proposal);
      } catch (error) {
        const reason = message(error);
        await journalSyntheticFailure(db, identity, { provider_transport_error: reason }, {
          ...identity,
          result_kind: "coordinator_failure",
          code: "provider_transport_error",
          retryable: true,
          reason,
        }, now().toISOString());
        return followup(db, input, now, "provider_transport_error", true, reason);
      }

      const inspected = inspectSMCAction(rawAction);
      const identityIssues = inspected.valid ? actionIdentityIssues(inspected.action, identity) : [];
      if (!inspected.valid || identityIssues.length > 0) {
        const issues = inspected.valid ? identityIssues : inspected.issues;
        const validationResult = SMCResultSchema.parse({
          ...identity,
          result_kind: "action_validation_failed",
          code: "action_validation_failed",
          retryable: true,
          issues,
        });
        const journaled = await journalSyntheticFailure(db, identity, rawAction, validationResult, now().toISOString());
        if (journaled.kind === "rejected") return journalRejected(journaled.code);
        continue;
      }

      const action = inspected.action;
      if (textObligation) {
        if (action.action !== "query"
          || action.request.text_obligation_id !== textObligation.id
          || action.request.plan_revision !== plan.plan_revision
          || action.request.plan_digest !== plan.plan_digest
          || typeof action.request.query_text !== "string") {
          const validationResult = SMCResultSchema.parse({
            ...identity,
            result_kind: "action_validation_failed",
            code: "action_validation_failed",
            retryable: true,
            issues: [{ path: "action", message: "text-query phase permits only the exact next text obligation" }],
          });
          const journaled = await journalSyntheticFailure(db, identity, rawAction, validationResult, now().toISOString());
          if (journaled.kind === "rejected") return journalRejected(journaled.code);
          continue;
        }
      } else if (requiredAuditFetch) {
        const exactFetch = action.action === "fetch_record"
          && action.request.record_kind === "memory"
          && action.request.stable_id === requiredAuditFetch.memory_id
          && stableJson(action.request.expected_revision) === stableJson(requiredAuditFetch.expected_revision)
          && action.request.max_encoded_bytes === requiredAuditFetch.max_encoded_bytes;
        const genuineBlocker = action.action === "blocker"
          && ["retrieval_unavailable", "repository_verification_failed"].includes(action.request.code);
        if (!exactFetch && !genuineBlocker) {
          const validationResult = SMCResultSchema.parse({
            ...identity,
            result_kind: "action_validation_failed",
            code: "action_validation_failed",
            retryable: true,
            issues: [{
              path: "action",
              message: "audit-fetch phase permits only the exact required fetch or a genuine transport/system blocker",
            }],
          });
          const journaled = await journalSyntheticFailure(db, identity, rawAction, validationResult, now().toISOString());
          if (journaled.kind === "rejected") return journalRejected(journaled.code);
          continue;
        }
      } else if (action.action !== "submit_proposal" && action.action !== "fetch_record" && action.action !== "blocker") {
        const validationResult = SMCResultSchema.parse({
          ...identity,
          result_kind: "action_validation_failed",
          code: "action_validation_failed",
          retryable: true,
          issues: [{ path: "action", message: "proposal phase does not permit new retrieval queries" }],
        });
        const journaled = await journalSyntheticFailure(db, identity, rawAction, validationResult, now().toISOString());
        if (journaled.kind === "rejected") return journalRejected(journaled.code);
        continue;
      }
      const dispatched = action.action === "query"
        ? await dispatchCoordinatorQuery(db, {
          manifest,
          input,
          work_batch_id: batch.batch_id,
          plan,
          obligation_ids: [action.request.text_obligation_id],
          query_text: action.request.query_text,
          provider_action: action,
          provider_identity: identity,
          created_at: now().toISOString(),
        })
        : await dispatchAction(db, {
          action,
          manifest,
          input,
          identity,
          created_at: now().toISOString(),
        });
      if (dispatched.kind === "journal_rejected") return journalRejected(dispatched.code);
      if (action.action === "submit_proposal" && dispatched.accepted) break;
      if (dispatched.followup) {
        return followup(
          db,
          input,
          now,
          dispatched.followup.code,
          dispatched.followup.retryable,
          dispatched.followup.reason,
        );
      }
      batchState = acceptedBatchState(db, input.job_id, batch.batch_id);
      if (batchState === "invalid") return journalRejected("accepted batch is missing its exact submit-proposal journal result");
    }
  }

  manifest = readSMCManifest(db, input.job_id);
  if (!manifest || !runningCoordinatorIdentity(db, input, manifest)) {
    return rejected("coordinator_identity_mismatch", "coordinator authority changed before projection construction");
  }
  try {
    const accepted = buildSessionMaintenanceProjection(db, {
      job_id: manifest.job_id,
      project_key: manifest.project_key,
      manifest_digest: manifest.manifest_digest,
      snapshot_token: manifest.snapshot_token,
      overlay_revision: manifest.current_overlay_identity.revision,
      overlay_digest: manifest.current_overlay_identity.digest,
    });
    db.transaction(() => {
      const current = readSMCManifest(db, input.job_id);
      if (!current || !runningCoordinatorIdentity(db, input, current)) {
        throw new Error("coordinator authority changed before projection result persistence");
      }
      writeSessionMaintenanceProjectionResultInOpenTransaction(db, {
        project_key: input.project_key,
        job_id: input.job_id,
        owner_epoch: input.owner_epoch,
        phase: "running",
        projection: accepted.projection,
        stored_at: now().toISOString(),
      });
    }).immediate();
    return {
      kind: "accepted_projection",
      job_id: manifest.job_id,
      owner_epoch: input.owner_epoch,
      projection: accepted,
    };
  } catch (error) {
    return rejected("coordinator_projection_rejected", message(error));
  }
}

type DispatchResult =
  | { kind: "journal_rejected"; code: string }
  | { kind: "dispatched"; accepted: boolean; result?: SMCResult; followup?: { code: SessionMemoryAnchorReasonCode; retryable: boolean; reason: string } };

async function dispatchAction(
  db: Database,
  context: {
    action: SMCAction;
    manifest: SMCManifest;
    input: Parameters<typeof runSMCCoordinator>[1];
    identity: SMCActionIdentity;
    created_at: string;
  },
): Promise<DispatchResult> {
  const { action, manifest, input, identity } = context;
  if (action.action === "query") {
    return { kind: "journal_rejected", code: "provider_query_bypassed_trusted_coordinator" };
  }
  if (action.action === "fetch_record") {
    const journaled = await executeServiceJournaled(db, action, context.created_at, async (persistInTransaction) => {
      const result = fetchCuratorRecord(db, {
        job_id: action.job_id,
        project_key: action.project_key,
        work_batch_id: action.work_batch_id,
        attempt_id: action.attempt_id,
        owner_epoch: action.owner_epoch,
        manifest_digest: action.manifest_digest,
        snapshot_token: action.snapshot_token,
        overlay_revision: action.expected_overlay_revision,
        ...action.request,
      }, {
        on_result_in_open_transaction: (transactionDb, durableResult) => {
          persistInTransaction(transactionDb, SMCResultSchema.parse({
            ...identity,
            result_kind: "fetch_record_result",
            result: durableResult,
          }));
        },
      });
      input.failure_injection?.after_fetch_commit_before_return?.();
      return SMCResultSchema.parse({ ...identity, result_kind: "fetch_record_result", result });
    });
    if (journaled.kind === "rejected") return { kind: "journal_rejected", code: journaled.code };
    const result = (journaled.result as Extract<SMCResult, { result_kind: "fetch_record_result" }>).result as {
      kind?: unknown; code?: unknown; reason?: unknown;
    };
    return {
      kind: "dispatched",
      accepted: false,
      ...(result.kind === "rejected" && terminalServiceCode(result.code)
        ? { followup: { code: anchorReasonCode(result.code), retryable: result.code === "curator_budget_exceeded", reason: String(result.reason ?? result.code) } }
        : {}),
    };
  }
  if (action.action === "submit_proposal") {
    const journalInput = journalInputForAction(action);
    const prepared = validatePreparedJournalResult(prepareJournaledSMCAction<SMCResult>(db, journalInput));
    let journaled;
    if (prepared.kind === "replayed" || prepared.kind === "rejected") {
      journaled = prepared;
    } else {
      const result = await stageSMCBatchProposal(db, {
        job_id: action.job_id,
        project_key: action.project_key,
        attempt_id: action.attempt_id,
        owner_epoch: action.owner_epoch,
        manifest_digest: action.manifest_digest,
        snapshot_token: action.snapshot_token,
        proposal: action.request.proposal,
        document_contract: input.document_contract,
        embedding_transport: input.embedding_transport,
        created_at: context.created_at,
        failure_injection: input.failure_injection?.after_accepted_proposal_commit_before_return
          ? { afterCommitBeforeReturn: input.failure_injection.after_accepted_proposal_commit_before_return }
          : undefined,
        on_accepted_in_open_transaction: (transactionDb, accepted) => {
          const typed = SMCResultSchema.parse({
            ...identity,
            result_kind: "submit_proposal_result",
            result: accepted,
          });
          const persisted = persistJournaledSMCActionResultInOpenTransaction(transactionDb, {
            ...journalInput,
            result: typed,
            created_at: context.created_at,
          });
          if (persisted.kind === "rejected") {
            throw new Error(`SMC accepted proposal journal rejected: ${persisted.code}`);
          }
        },
      });
      const typed = SMCResultSchema.parse({ ...identity, result_kind: "submit_proposal_result", result });
      journaled = persistJournaledSMCActionResult(db, {
        ...journalInput,
        result: typed,
        created_at: context.created_at,
      });
    }
    if (journaled.kind === "rejected") return { kind: "journal_rejected", code: journaled.code };
    const result = (journaled.result as Extract<SMCResult, { result_kind: "submit_proposal_result" }>).result as {
      kind?: unknown; code?: unknown; retryable?: unknown; reason?: unknown;
    };
    return {
      kind: "dispatched",
      accepted: result.kind === "accepted",
      ...(result.kind === "blocked" || (result.kind === "rejected" && result.code !== "proposal_validation_failed")
        ? { followup: { code: anchorReasonCode(result.code), retryable: result.retryable === true, reason: String(result.reason ?? result.code) } }
        : {}),
    };
  }

  const blocker = SMCResultSchema.parse({
    ...identity,
    result_kind: "blocker_result",
    code: action.request.code,
    retryable: action.request.retryable,
    explanation: action.request.explanation,
  });
  const journaled = await executeAsyncJournaled(db, action, context.created_at, async () => blocker);
  return journaled.kind === "rejected"
    ? { kind: "journal_rejected", code: journaled.code }
    : {
      kind: "dispatched",
      accepted: false,
      followup: {
        code: action.request.code,
        retryable: action.request.retryable,
        reason: action.request.explanation,
      },
    };
}

async function dispatchCoordinatorQuery(
  db: Database,
  context: {
    manifest: SMCManifest;
    input: Parameters<typeof runSMCCoordinator>[1];
    work_batch_id: string;
    plan: CuratorBatchChannelPlan;
    obligation_ids: string[];
    query_text: string | undefined;
    provider_action?: Extract<SMCAction, { action: "query" }>;
    provider_identity?: SMCActionIdentity;
    created_at: string;
  },
): Promise<DispatchResult> {
  let cursor: string | null = null;
  let firstPage = true;
  while (true) {
    const identity = firstPage && context.provider_identity
      ? context.provider_identity
      : actionIdentity(
        context.input,
        context.manifest,
        context.work_batch_id,
        nextSequence(db, context.manifest.job_id, context.work_batch_id, context.input.attempt_id),
      );
    const coordinatorRequest = {
      plan_revision: context.plan.plan_revision,
      plan_digest: context.plan.plan_digest,
      obligation_ids: context.obligation_ids,
      ...(context.query_text === undefined ? {} : { query_text: context.query_text }),
      page_limit: context.manifest.workflow_budgets.retrieval_page_item_limit,
      ...(cursor === null ? {} : { cursor }),
    };
    const request = {
      ...identity,
      action: "coordinator_query",
      coordinator_owned: true,
      request: coordinatorRequest,
    };
    const journalRequest = firstPage && context.provider_action
      ? context.provider_action
      : request;
    const journalInput: SMCJournalActionInput = {
      ...journalIdentity(identity),
      action_kind: "query",
      request: journalRequest,
    };
    const prepared = validatePreparedJournalResult(prepareJournaledSMCAction<SMCResult>(db, journalInput));
    let journaled;
    if (prepared.kind === "replayed" || prepared.kind === "rejected") {
      journaled = prepared;
    } else {
      const result = await queryCuratorMemory(db, {
        job_id: identity.job_id,
        project_key: identity.project_key,
        work_batch_id: identity.work_batch_id,
        attempt_id: identity.attempt_id,
        owner_epoch: identity.owner_epoch,
        manifest_digest: identity.manifest_digest,
        snapshot_token: identity.snapshot_token,
        overlay_revision: identity.expected_overlay_revision,
        ...coordinatorRequest,
      }, {
        embedding_transport: context.input.embedding_transport,
        on_result_in_open_transaction: (transactionDb, durableResult) => {
          const persisted = persistJournaledSMCActionResultInOpenTransaction(transactionDb, {
            ...journalInput,
            result: SMCResultSchema.parse({ ...identity, result_kind: "query_result", result: durableResult }),
            created_at: context.created_at,
          });
          if (persisted.kind === "rejected") throw new Error(`SMC coordinator query journal rejected: ${persisted.code}`);
        },
      });
      journaled = persistJournaledSMCActionResult(db, {
        ...journalInput,
        result: SMCResultSchema.parse({ ...identity, result_kind: "query_result", result }),
        created_at: context.created_at,
      });
    }
    if (journaled.kind === "rejected") return { kind: "journal_rejected", code: journaled.code };
    if (prepared.kind === "prepared") context.input.failure_injection?.after_query_commit_before_return?.();
    const typed = journaled.result;
    if (typed.result_kind !== "query_result") return { kind: "journal_rejected", code: "coordinator_query_result_missing" };
    const result = typed.result;
    const dispatched: DispatchResult = {
      kind: "dispatched",
      accepted: false,
      result: typed,
      ...(result.kind === "blocked" && terminalServiceCode(result.code)
        ? { followup: { code: anchorReasonCode(result.code), retryable: result.retryable, reason: result.reason } }
        : {}),
    };
    if (dispatched.followup) return dispatched;
    if (result.kind !== "page" || result.next_cursor === null) return dispatched;
    cursor = result.next_cursor;
    firstPage = false;
  }
}

async function executeAsyncJournaled(
  db: Database,
  action: SMCAction,
  createdAt: string,
  execute: () => Promise<SMCResult>,
) {
  const input = journalInputForAction(action);
  const prepared = validatePreparedJournalResult(prepareJournaledSMCAction<SMCResult>(db, input));
  if (prepared.kind === "replayed" || prepared.kind === "rejected") return prepared;
  const result = await execute();
  return persistJournaledSMCActionResult(db, { ...input, result, created_at: createdAt });
}

async function executeServiceJournaled(
  db: Database,
  action: SMCAction,
  createdAt: string,
  execute: (persistInTransaction: (transactionDb: Database, result: SMCResult) => void) => Promise<SMCResult>,
) {
  const input = journalInputForAction(action);
  const prepared = validatePreparedJournalResult(prepareJournaledSMCAction<SMCResult>(db, input));
  if (prepared.kind === "replayed" || prepared.kind === "rejected") return prepared;
  const result = await execute((transactionDb, durableResult) => {
    const persisted = persistJournaledSMCActionResultInOpenTransaction(transactionDb, {
      ...input,
      result: durableResult,
      created_at: createdAt,
    });
    if (persisted.kind === "rejected") {
      throw new Error(`SMC service action journal rejected: ${persisted.code}`);
    }
  });
  return persistJournaledSMCActionResult(db, { ...input, result, created_at: createdAt });
}

async function journalSyntheticFailure(
  db: Database,
  identity: SMCActionIdentity,
  request: unknown,
  result: SMCResult,
  createdAt: string,
) {
  const input: SMCJournalActionInput = {
    ...journalIdentity(identity),
    action_kind: "blocker",
    request,
  };
  const prepared = validatePreparedJournalResult(prepareJournaledSMCAction<SMCResult>(db, input));
  if (prepared.kind === "replayed" || prepared.kind === "rejected") return prepared;
  return persistJournaledSMCActionResult(db, { ...input, result, created_at: createdAt });
}

type PreparedOrReplay = PreparedSMCJournalAction
  | Exclude<SMCJournalResult<SMCResult>, { kind: "executed" }>;

function validatePreparedJournalResult(value: PreparedOrReplay): PreparedOrReplay {
  if (value.kind !== "replayed") return value;
  const parsed = SMCResultSchema.safeParse(value.result);
  if (!parsed.success) return { kind: "rejected", code: "journal_integrity_mismatch" };
  return { ...value, result: parsed.data };
}

function actionIdentity(
  input: Pick<Parameters<typeof runSMCCoordinator>[1], "job_id" | "project_key" | "attempt_id" | "owner_epoch">,
  manifest: SMCManifest,
  workBatchId: string,
  sequence: number,
): SMCActionIdentity {
  return {
    protocol_version: SMC_TOOL_PROTOCOL_VERSION,
    job_id: input.job_id,
    project_key: input.project_key,
    work_batch_id: workBatchId,
    attempt_id: input.attempt_id,
    sequence,
    owner_epoch: input.owner_epoch,
    manifest_digest: manifest.manifest_digest,
    snapshot_token: manifest.snapshot_token,
    expected_overlay_revision: manifest.current_overlay_identity.revision,
  };
}

function actionIdentityIssues(action: SMCAction, expected: SMCActionIdentity): Array<{ path: string; message: string }> {
  const issues: Array<{ path: string; message: string }> = [];
  for (const key of Object.keys(expected) as Array<keyof SMCActionIdentity>) {
    if (action[key] !== expected[key]) issues.push({ path: key, message: "action identity does not match the trusted work envelope" });
  }
  if (action.action === "submit_proposal") {
    if (action.request.proposal.work_batch_id !== expected.work_batch_id) {
      issues.push({ path: "request.proposal.work_batch_id", message: "proposal targets another work batch" });
    }
    if (action.request.proposal.expected_overlay_revision !== expected.expected_overlay_revision) {
      issues.push({ path: "request.proposal.expected_overlay_revision", message: "proposal overlay revision differs from the action" });
    }
  }
  return issues;
}

function journalInputForAction(action: SMCAction): SMCJournalActionInput {
  return {
    ...journalIdentity(action),
    action_kind: action.action,
    request: action,
  };
}

function journalIdentity(identity: SMCActionIdentity): Omit<SMCJournalActionInput, "action_kind" | "request"> {
  return {
    job_id: identity.job_id,
    project_key: identity.project_key,
    work_batch_id: identity.work_batch_id,
    attempt_id: identity.attempt_id,
    sequence: identity.sequence,
    owner_epoch: identity.owner_epoch,
    protocol_version: identity.protocol_version,
    manifest_digest: identity.manifest_digest,
    snapshot_token: identity.snapshot_token,
    expected_overlay_revision: identity.expected_overlay_revision,
  };
}

function readDurableTextFormulation(
  db: Database,
  input: {
    job_id: string;
    work_batch_id: string;
    plan_revision: number;
    plan_digest: string;
    text_obligation_id: string;
  },
): { query_text: string } | null {
  const rows = db.query(
    `SELECT request_json, result_json FROM smc_action_journal
     WHERE job_id = ? AND work_batch_id = ? AND action_kind = 'query'
     ORDER BY rowid`,
  ).all(input.job_id, input.work_batch_id) as Array<{ request_json: string; result_json: string }>;
  for (const row of rows) {
    let request: unknown;
    let result: unknown;
    try {
      request = JSON.parse(row.request_json);
      result = JSON.parse(row.result_json);
    } catch {
      throw new Error("stored SMC journal JSON is invalid");
    }
    const action = inspectSMCAction(request);
    const typedResult = SMCResultSchema.safeParse(result);
    if (!action.valid || action.action.action !== "query" || !typedResult.success
      || typedResult.data.result_kind !== "query_result" || typedResult.data.result.kind !== "page") continue;
    if (action.action.request.plan_revision === input.plan_revision
      && action.action.request.plan_digest === input.plan_digest
      && action.action.request.text_obligation_id === input.text_obligation_id) {
      return { query_text: action.action.request.query_text };
    }
  }
  return null;
}

function validateDurableJournal(db: Database, jobId: string, workBatchId: string): string | null {
  const rows = db.query(
    `SELECT action_kind, request_json, result_json, result_digest
     FROM smc_action_journal WHERE job_id = ? AND work_batch_id = ? ORDER BY rowid`,
  ).all(jobId, workBatchId) as Array<{
    action_kind: string; request_json: string; result_json: string; result_digest: string;
  }>;
  for (const row of rows) {
    if (row.request_json !== stableJson(JSON.parse(row.request_json))
      || row.result_json !== stableJson(JSON.parse(row.result_json))
      || row.result_digest !== jsonDigest(row.result_json)
      || !SMCResultSchema.safeParse(JSON.parse(row.result_json)).success) {
      return "journal_integrity_mismatch";
    }
    const request = JSON.parse(row.request_json) as unknown;
    const providerAction = inspectSMCAction(request);
    if (row.action_kind !== "blocker" && !providerAction.valid && !isCoordinatorQueryJournalRequest(request)) {
      return "journal_integrity_mismatch";
    }
  }
  return null;
}

function isCoordinatorQueryJournalRequest(value: unknown): boolean {
  return typeof value === "object" && value !== null
    && (value as Record<string, unknown>).action === "coordinator_query"
    && (value as Record<string, unknown>).coordinator_owned === true;
}

function jsonDigest(json: string): `sha256:${string}` {
  return `sha256:${createHash("sha256").update(json, "utf8").digest("hex")}`;
}

function nextSequence(db: Database, jobId: string, workBatchId: string, attemptId: string): number {
  const rows = db.query(
    `SELECT sequence FROM smc_action_journal
     WHERE job_id = ? AND work_batch_id = ? AND attempt_id = ? ORDER BY sequence`,
  ).all(jobId, workBatchId, attemptId) as Array<{ sequence: number }>;
  rows.forEach((row, index) => {
    if (row.sequence !== index) throw new Error("SMC journal sequence is not contiguous");
  });
  return rows.length;
}

function countProviderTurns(db: Database, jobId: string): number {
  const row = db.query(
    `SELECT count(*) AS count FROM smc_action_journal
     WHERE job_id = ?
       AND COALESCE(json_extract(request_json, '$.coordinator_owned'), 0) != 1
       AND json_type(request_json, '$.envelope_error') IS NULL`,
  ).get(jobId) as { count: number };
  return row.count;
}

function requiredRemainingProviderTurns(
  db: Database,
  manifest: SMCManifest,
  currentBatchOrdinal: number,
  currentMissingTextCount: number,
  currentMissingAuditFetchCount: number,
): number {
  const later = db.query(
    `SELECT b.ordinal, b.work_kind,
            (SELECT count(*) FROM smc_evidence_batch_members e
             WHERE e.job_id = b.job_id AND e.batch_id = b.batch_id) AS evidence_count,
            (SELECT count(*) FROM smc_audit_batch_members a
             WHERE a.job_id = b.job_id AND a.batch_id = b.batch_id) AS audit_count
     FROM smc_work_batches b WHERE b.job_id = ? AND b.ordinal > ? ORDER BY b.ordinal`,
  ).all(manifest.job_id, currentBatchOrdinal) as Array<{
    ordinal: number; work_kind: "evidence" | "audit"; evidence_count: number; audit_count: number;
  }>;
  return currentMissingTextCount + currentMissingAuditFetchCount + 1
    + later.reduce((total, batch) => total
      + (batch.work_kind === "evidence" ? batch.evidence_count : batch.audit_count) + 1, 0);
}

function nextRequiredAuditFetch(
  db: Database,
  manifest: SMCManifest,
  workBatchId: string,
  maxEncodedBytes: number,
): {
  kind: "fetch_record";
  batch_id: string;
  memory_id: string;
  expected_revision: { origin: "base"; revision: number; state_digest: string };
  max_encoded_bytes: number;
} | null {
  const members = auditMembers(db, manifest.job_id, workBatchId);
  const member = members.find((candidate) => !hasExactCuratorMemoryFetchReceipt(db, manifest, {
    work_batch_id: workBatchId,
    memory_id: candidate.memory_id,
    revision: candidate.revision,
    state_digest: candidate.state_digest,
  }));
  return member ? {
    kind: "fetch_record",
    batch_id: workBatchId,
    memory_id: member.memory_id,
    expected_revision: {
      origin: "base",
      revision: member.revision,
      state_digest: member.state_digest,
    },
    max_encoded_bytes: maxEncodedBytes,
  } : null;
}

function countMissingAuditFetches(
  db: Database,
  manifest: SMCManifest,
  workBatchId: string,
): number {
  return auditMembers(db, manifest.job_id, workBatchId).filter((member) =>
    !hasExactCuratorMemoryFetchReceipt(db, manifest, {
      work_batch_id: workBatchId,
      memory_id: member.memory_id,
      revision: member.revision,
      state_digest: member.state_digest,
    })).length;
}

function auditMembers(db: Database, jobId: string, workBatchId: string): Array<{
  memory_id: string;
  revision: number;
  state_digest: string;
}> {
  return db.query(
    `SELECT memory_id, revision, state_digest FROM smc_audit_batch_members
     WHERE job_id = ? AND batch_id = ? ORDER BY ordinal`,
  ).all(jobId, workBatchId) as Array<{ memory_id: string; revision: number; state_digest: string }>;
}

function missingObligationIds(keys: readonly string[]): Set<string> {
  return new Set(keys.map((key) => key.slice(0, key.lastIndexOf(":"))));
}

function acceptedBatchState(db: Database, jobId: string, batchId: string): "open" | "accepted" | "invalid" {
  const revision = db.query(
    `SELECT revision, parent_revision, response_digest, overlay_digest
     FROM smc_overlay_revisions WHERE job_id = ? AND work_batch_id = ?`,
  ).get(jobId, batchId) as {
    revision: number;
    parent_revision: number;
    response_digest: string;
    overlay_digest: string;
  } | null;
  if (!revision) return "open";
  const rows = db.query(
    `SELECT result_json FROM smc_action_journal
     WHERE job_id = ? AND work_batch_id = ? AND action_kind = 'submit_proposal'
       AND expected_overlay_revision = ? ORDER BY rowid`,
  ).all(jobId, batchId, revision.parent_revision) as Array<{ result_json: string }>;
  for (const row of rows) {
    try {
      const parsed = SMCResultSchema.parse(JSON.parse(row.result_json));
      if (parsed.result_kind !== "submit_proposal_result") continue;
      const result = parsed.result as {
        kind?: unknown;
        overlay?: { revision?: unknown; digest?: unknown };
        response_digest?: unknown;
      };
      if (result.kind === "accepted"
        && result.overlay?.revision === revision.revision
        && result.overlay.digest === revision.overlay_digest
        && result.response_digest === revision.response_digest) return "accepted";
    } catch {
      return "invalid";
    }
  }
  return "invalid";
}

function runningCoordinatorIdentity(
  db: Database,
  input: Pick<Parameters<typeof runSMCCoordinator>[1], "job_id" | "project_key" | "attempt_id" | "owner_epoch">,
  manifest: SMCManifest,
): boolean {
  return manifest.job_id === input.job_id && manifest.project_key === input.project_key
    && Boolean(db.query(
      `SELECT 1
       FROM session_memory_anchor_jobs a
       JOIN project_session_mutation_fences f
         ON f.project_key = a.project_key AND f.owner_id = a.job_id AND f.owner_kind = 'anchor_job'
       JOIN session_memory_anchor_attempts t ON t.job_id = a.job_id AND t.id = ?
       WHERE a.job_id = ? AND a.project_key = ? AND a.phase = 'running' AND f.phase = 'running'
         AND t.status = 'running' AND a.owner_epoch = ? AND f.owner_epoch = ? AND t.owner_epoch = ?`,
    ).get(input.attempt_id, input.job_id, input.project_key, input.owner_epoch, input.owner_epoch, input.owner_epoch));
}

function resolvedInvocation(manifest: SMCManifest): ResolvedLlmInvocation | null {
  const stored = manifest.governing_identities.invocation;
  if (stored.provider !== "codex" && stored.provider !== "claude") return null;
  return {
    provider: stored.provider,
    ...(stored.model === null ? {} : { model: stored.model }),
    ...(stored.provider === "codex" && stored.reasoning_effort !== null
      ? { reasoningEffort: stored.reasoning_effort }
      : {}),
  };
}

function terminalServiceCode(value: unknown): boolean {
  return typeof value === "string" && (
    value.includes("budget")
    || value.startsWith("embedding_provider_")
    || value.includes("identity_mismatch")
    || value.includes("integrity")
  );
}

function anchorReasonCode(value: unknown): SessionMemoryAnchorReasonCode {
  return typeof value === "string"
    && (SESSION_MEMORY_ANCHOR_REASON_CODES as readonly string[]).includes(value)
    ? value as SessionMemoryAnchorReasonCode
    : "smc_internal_error";
}

function followup(
  db: Database,
  input: Pick<Parameters<typeof runSMCCoordinator>[1], "job_id" | "project_key" | "owner_epoch">,
  now: () => Date,
  code: SessionMemoryAnchorReasonCode,
  retryable: boolean,
  reason: string,
): SMCCoordinatorResult {
  const transitioned = transitionSessionMemoryAnchorJob(db, {
    jobId: input.job_id,
    projectKey: input.project_key,
    expectedPhase: "running",
    expectedOwnerEpoch: input.owner_epoch,
    nextPhase: "needs_followup",
    now: now().toISOString(),
    reasonCode: code,
  });
  if (transitioned.kind !== "updated") {
    return rejected("coordinator_identity_mismatch", `needs_followup transition failed: ${transitioned.code}`);
  }
  return {
    kind: "needs_followup",
    job_id: input.job_id,
    owner_epoch: transitioned.anchor.owner_epoch,
    code,
    retryable,
    reason,
  };
}

function journalRejected(code: string): SMCCoordinatorResult {
  return rejected("coordinator_journal_rejected", code);
}

function rejected(code: Extract<SMCCoordinatorResult, { kind: "rejected" }>["code"], reason: string): SMCCoordinatorResult {
  return { kind: "rejected", code, reason };
}

function addSafe(left: number, right: number): number {
  const result = left + right;
  if (!Number.isSafeInteger(left) || !Number.isSafeInteger(right) || !Number.isSafeInteger(result)) {
    throw new Error("SMC effective turn budget overflow");
  }
  return result;
}

function message(error: unknown): string {
  const value = error instanceof Error ? error.message : String(error);
  return value.length <= 4_000 ? value : `${value.slice(0, 3_997)}...`;
}

function normalizeProviderAction(
  value: unknown,
  identity: SMCActionIdentity,
  priorProposal: Readonly<Record<string, unknown>> | null,
): unknown {
  if (!isRecord(value)) return value;
  const request = isRecord(value.request) ? value.request : null;
  const rawProposal = request && isRecord(request.proposal)
    ? request.proposal
    : isRecord(value.proposal)
      ? value.proposal
      : null;
  if (!rawProposal) return value;
  const proposalFields = [
    "schema_version",
    "work_batch_id",
    "expected_overlay_revision",
    "source_event_dispositions",
    "memory_dispositions",
    "disposition_receipt_reuses",
    "staged_operations",
    "checked_output_refs",
    "terminal_summary",
  ] as const;
  const misplacedProposalFields = request
    ? Object.fromEntries(proposalFields.flatMap((key) => request[key] === undefined ? [] : [[key, request[key]]]))
    : {};
  const proposal = deriveProposalOutputReferences(mergeProposalDraft(priorProposal, {
    ...misplacedProposalFields,
    ...rawProposal,
    schema_version: rawProposal.schema_version ?? 1,
    work_batch_id: rawProposal.work_batch_id ?? identity.work_batch_id,
    expected_overlay_revision: rawProposal.expected_overlay_revision ?? identity.expected_overlay_revision,
    disposition_receipt_reuses: rawProposal.disposition_receipt_reuses ?? [],
  }));
  if (typeof value.action === "string") {
    const normalizedRequest = request ? { ...request } : {};
    for (const key of proposalFields) delete normalizedRequest[key];
    return {
      ...value,
      request: { ...normalizedRequest, proposal },
    };
  }
  return {
    ...identity,
    action: "submit_proposal",
    request: { proposal },
  };
}

function deriveProposalOutputReferences(proposal: Record<string, unknown>): Record<string, unknown> {
  const noOutputSources = new Set(Array.isArray(proposal.source_event_dispositions)
    ? proposal.source_event_dispositions.flatMap((disposition) =>
      isRecord(disposition) && disposition.disposition === "no_output"
        ? [stringField(disposition, "source_event_id")]
        : [])
    : []);
  const memoryDispositions = Array.isArray(proposal.memory_dispositions)
    ? proposal.memory_dispositions.map((disposition) =>
      isRecord(disposition) && disposition.disposition === "keep" && Array.isArray(disposition.source_event_refs)
        ? {
          ...disposition,
          source_event_refs: disposition.source_event_refs.filter((sourceId) =>
            typeof sourceId !== "string" || !noOutputSources.has(sourceId)),
        }
        : disposition)
    : proposal.memory_dispositions;
  const normalizedProposal: Record<string, unknown> = { ...proposal, memory_dispositions: memoryDispositions };
  const requiredBySource = new Map<string, Set<string>>();
  const add = (sourceId: string, ref: string): void => {
    const refs = requiredBySource.get(sourceId) ?? new Set<string>();
    refs.add(ref);
    requiredBySource.set(sourceId, refs);
  };

  if (Array.isArray(normalizedProposal.staged_operations)) {
    for (const operation of normalizedProposal.staged_operations) {
      if (!isRecord(operation) || operation.operation !== "upsert" || !isRecord(operation.value)) continue;
      const kind = stringField(operation, "record_kind");
      const id = stringField(operation.value, "id");
      if (!(["memory", "candidate", "handoff"] as const).includes(kind as "memory" | "candidate" | "handoff") || !id) continue;
      const prefix = kind === "memory" ? "session_memories" : kind === "candidate" ? "memory_candidates" : "handoff_instructions";
      if (!Array.isArray(operation.value.source_event_refs)) continue;
      for (const sourceId of operation.value.source_event_refs) {
        if (typeof sourceId === "string") add(sourceId, `${prefix}/${id}`);
      }
    }
  }

  if (Array.isArray(normalizedProposal.memory_dispositions)) {
    for (const disposition of normalizedProposal.memory_dispositions) {
      if (!isRecord(disposition)) continue;
      const memoryId = stringField(disposition, "memory_id");
      if (!memoryId || !Array.isArray(disposition.source_event_refs)) continue;
      for (const sourceId of disposition.source_event_refs) {
        if (typeof sourceId === "string") add(sourceId, `memory_dispositions/${memoryId}`);
      }
    }
  }

  if (!Array.isArray(normalizedProposal.source_event_dispositions)) return normalizedProposal;
  const sourceEventDispositions = normalizedProposal.source_event_dispositions.map((disposition) => {
    if (!isRecord(disposition) || disposition.disposition !== "used") return disposition;
    const sourceId = stringField(disposition, "source_event_id");
    const outputRefs = [...(requiredBySource.get(sourceId) ?? [])].sort(compareText);
    return outputRefs.length > 0
      ? { ...disposition, output_refs: outputRefs }
      : {
        source_event_id: sourceId,
        disposition: "no_output",
        reason: disposition.reason,
      };
  });
  const checkedOutputRefs: string[] = [...new Set<string>(sourceEventDispositions.flatMap((disposition): string[] =>
    isRecord(disposition) && disposition.disposition === "used" && Array.isArray(disposition.output_refs)
      ? disposition.output_refs.filter((ref): ref is string => typeof ref === "string")
      : []))].sort(compareText);
  return { ...normalizedProposal, source_event_dispositions: sourceEventDispositions, checked_output_refs: checkedOutputRefs };
}

function mergeProposalDraft(
  prior: Readonly<Record<string, unknown>> | null,
  current: Readonly<Record<string, unknown>>,
): Record<string, unknown> {
  if (!prior) return { ...current };
  const merged: Record<string, unknown> = { ...prior, ...current };
  merged.source_event_dispositions = mergeKeyedArray(
    prior.source_event_dispositions,
    current.source_event_dispositions,
    (item) => stringField(item, "source_event_id"),
    false,
    true,
  );
  merged.memory_dispositions = mergeKeyedArray(
    prior.memory_dispositions,
    current.memory_dispositions,
    (item) => stringField(item, "memory_id"),
    false,
    true,
  );
  merged.staged_operations = mergeKeyedArray(
    prior.staged_operations,
    current.staged_operations,
    (item) => `${stringField(item, "record_kind")}:${stringField(item, "stable_key")}`,
    true,
  );
  return merged;
}

function mergeKeyedArray(
  prior: unknown,
  current: unknown,
  key: (item: Record<string, unknown>) => string,
  mergeValue = false,
  retainOmitted = false,
): unknown {
  if (!Array.isArray(current)) return prior;
  if (!Array.isArray(prior)) return current;
  const priorByKey = new Map(prior.filter(isRecord).map((item) => [key(item), item]));
  const currentKeys = new Set(current.filter(isRecord).map(key));
  const merged = current.map((item) => {
    if (!isRecord(item)) return item;
    const previous = priorByKey.get(key(item));
    if (!previous) return item;
    const merged = { ...previous, ...item };
    if (mergeValue && isRecord(previous.value) && isRecord(item.value)) {
      merged.value = { ...previous.value, ...item.value };
    }
    return merged;
  });
  if (retainOmitted) {
    merged.push(...prior.filter((item) => isRecord(item) && !currentKeys.has(key(item))));
  }
  return merged;
}

function stringField(value: Record<string, unknown>, key: string): string {
  return typeof value[key] === "string" ? value[key] : "";
}

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
