import type { Database } from "bun:sqlite";
import { randomUUID } from "node:crypto";
import { invokeSMCActionTurn, type SMCTurnInvoker } from "../agents/smc-adapter.ts";
import { EmbeddingProviderFactory } from "../memory/embedding-provider-factory.ts";
import { createCompatiblePurposeEmbeddingTransport } from "../memory/embedding-service.ts";
import type { EmbeddingTransport } from "../memory/embedding-types.ts";
import { openMemoryDb } from "../memory/db.ts";
import { requestPendingSessionMemoryIndexing } from "../memory/session-memory-index-service.ts";
import type { AutoMemoryMaintenanceScheduler } from "../maintenance/maintenance-contracts.ts";
import { loadConfig, type ActiveEmbeddingContract } from "../runtime/config.ts";
import { runSMCCoordinator } from "../session-maintenance/coordinator.ts";
import { finalizeSessionMaintenance } from "../session-maintenance/finalization-service.ts";
import {
  getSessionMemoryAnchorJob,
  listSessionMemoryAnchorAttempts,
  transitionSessionMemoryAnchorJob,
} from "../session-maintenance/job-lifecycle.ts";
import { readSMCManifest } from "../session-maintenance/manifest.ts";

export type IngestWorkerInput = {
  root: string;
  projectKey: string;
  jobId: string;
  provider: "codex" | "claude";
  providerSessionId?: string | null;
  now?: () => Date;
  sessionMemoryMaintenanceScheduler?: AutoMemoryMaintenanceScheduler | false;
  smc?: {
    invokeTurn?: SMCTurnInvoker;
    documentContract?: ActiveEmbeddingContract;
    embeddingTransport?: EmbeddingTransport;
    requestIndexing?: (projectKey: string) => void | Promise<void>;
  };
};

/**
 * Runs the sole production Session Memory curator path for an already-prepared anchor.
 * Anchor preparation, not this worker, owns evidence selection and frozen job state.
 */
export async function runIngestWorker(input: IngestWorkerInput): Promise<void> {
  const db = openMemoryDb(input.root);
  const now = input.now ?? (() => new Date());

  try {
    const anchor = getSessionMemoryAnchorJob(db, input.jobId);
    if (!anchor || anchor.project_key !== input.projectKey) {
      throw new Error("smc_companion_anchor_required");
    }
    await runSMCCompanionWorker(db, input, now);
  } catch (error) {
    const anchor = getSessionMemoryAnchorJob(db, input.jobId);
    if (anchor && (anchor.phase === "running" || anchor.phase === "finalizing")) {
      transitionSessionMemoryAnchorJob(db, {
        jobId: anchor.job_id,
        projectKey: anchor.project_key,
        expectedPhase: anchor.phase,
        expectedOwnerEpoch: anchor.owner_epoch,
        nextPhase: "needs_followup",
        now: now().toISOString(),
        reasonCode: "companion_worker_failed",
      });
    }
    throw error;
  } finally {
    db.close();
  }
}

async function runSMCCompanionWorker(
  db: Database,
  input: IngestWorkerInput,
  now: () => Date,
): Promise<void> {
  let anchor = getSessionMemoryAnchorJob(db, input.jobId);
  if (!anchor || anchor.project_key !== input.projectKey) {
    throw new Error("smc_companion_anchor_identity_mismatch");
  }

  let attemptId: string;
  if (anchor.phase === "preparing") {
    attemptId = `smc_attempt_${randomUUID()}`;
    const started = transitionSessionMemoryAnchorJob(db, {
      jobId: anchor.job_id,
      projectKey: anchor.project_key,
      expectedPhase: "preparing",
      expectedOwnerEpoch: anchor.owner_epoch,
      nextPhase: "running",
      now: now().toISOString(),
      reasonCode: null,
      resumeAttempt: {
        id: attemptId,
        provider: input.provider,
        providerSessionId: input.providerSessionId ?? null,
        processId: process.pid,
        details: { launch_kind: "initial_companion" },
      },
    });
    if (started.kind !== "updated") {
      throw new Error(`smc_companion_start_rejected: ${started.code}`);
    }
    anchor = started.anchor;
  } else if (anchor.phase === "running") {
    const attempt = listSessionMemoryAnchorAttempts(db, anchor.job_id)
      .find((row) => row.owner_epoch === anchor!.owner_epoch && row.status === "running");
    if (!attempt) throw new Error("smc_companion_running_attempt_missing");
    attemptId = attempt.id;
  } else {
    throw new Error(`smc_companion_wrong_phase: ${anchor.phase}`);
  }

  const manifest = readSMCManifest(db, anchor.job_id);
  if (!manifest) throw new Error("smc_companion_manifest_missing");

  let documentContract = input.smc?.documentContract;
  let embeddingTransport = input.smc?.embeddingTransport;
  if (!documentContract || !embeddingTransport) {
    const config = await loadConfig(input.root);
    documentContract = {
      provider: manifest.embedding_provider as ActiveEmbeddingContract["provider"],
      model: manifest.embedding_model,
      dimensions: manifest.embedding_dimensions,
      purpose: "retrieval_document",
      formatVersion: manifest.embedding_format_version,
    };
    const initialized = await new EmbeddingProviderFactory(config)
      .initializeTrustedCoordinatorContract(documentContract);
    embeddingTransport = createCompatiblePurposeEmbeddingTransport(initialized.client);
  }

  const coordinated = await runSMCCoordinator(db, {
    job_id: anchor.job_id,
    project_key: anchor.project_key,
    attempt_id: attemptId,
    owner_epoch: anchor.owner_epoch,
    invoke_turn: input.smc?.invokeTurn ?? invokeSMCActionTurn,
    document_contract: documentContract,
    embedding_transport: embeddingTransport,
    now,
  });
  if (coordinated.kind === "needs_followup") return;
  if (coordinated.kind === "rejected") {
    throw new Error(`${coordinated.code}: ${coordinated.reason}`);
  }

  await finalizeSessionMaintenance(db, {
    jobId: coordinated.job_id,
    ownerEpoch: coordinated.owner_epoch,
    acceptedProjectionDigest: coordinated.projection.projection_digest,
    now,
    requestIndexing: async (projectKey) => {
      await requestPendingSessionMemoryIndexing({
        db,
        projectKey,
        schedule: input.smc?.requestIndexing
          ?? (async () => scheduleAutoSessionMemoryIndexing(
            input.root,
            projectKey,
            input.sessionMemoryMaintenanceScheduler,
          )),
      });
    },
  });
}

async function scheduleAutoSessionMemoryIndexing(
  root: string,
  projectKey: string,
  scheduler: AutoMemoryMaintenanceScheduler | false | undefined,
): Promise<void> {
  if (scheduler === false) return;
  try {
    const service = scheduler ?? new (await import("../maintenance/auto-memory-maintenance.ts"))
      .AutoMemoryMaintenanceService(root);
    await service.maybeSchedule(projectKey, { forceIndex: true });
  } catch {
    // Session Memory remains durable and pending if derived indexing cannot be scheduled.
  }
}
