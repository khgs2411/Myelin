import type { Database } from "bun:sqlite";
import {
  isProcessAlive,
  type ProcessLivenessChecker,
} from "../ingest/runtime.ts";
import { readSessionMemoryMutationAuthorityMode } from "../memory/project-session-mutation-fence.ts";
import {
  insertLegacyJobDenyIdentitiesInOpenTransaction,
  legacyProjectsWithMultipleNonterminalJobs,
  quarantineLegacyJobsInOpenTransaction,
  readLegacyJobs,
  readLegacyNonterminalJobs,
  sameLegacyJobSnapshot,
  LegacyJobMigrationError,
  type LegacyJobSnapshot,
  type LegacyNonterminalJobSnapshot,
} from "./legacy-job-migration.ts";

export type AuthorityActivationBlockedCode =
  | "legacy_project_multiple_nonterminal_jobs"
  | "legacy_job_state_changed"
  | "legacy_activation_state_conflict";

export type AuthorityActivationResult =
  | { kind: "already_active"; authority_mode: "smc_v1"; quarantined_job_ids: string[] }
  | { kind: "activated"; authority_mode: "smc_v1"; quarantined_job_ids: string[] }
  | {
    kind: "blocked";
    authority_mode: "legacy_compatibility";
    code: AuthorityActivationBlockedCode;
    job_id: string | null;
    job_ids: string[];
    project_key: string | null;
    process_id: number | null;
    stage: "activation";
  };

export type AuthorityActivationServiceDeps = {
  now?: () => Date;
  isProcessAlive?: ProcessLivenessChecker;
};

export class AuthorityActivationService {
  constructor(private readonly deps: AuthorityActivationServiceDeps = {}) {}

  activate(db: Database): AuthorityActivationResult {
    if (readSessionMemoryMutationAuthorityMode(db) === "smc_v1") {
      return { kind: "already_active", authority_mode: "smc_v1", quarantined_job_ids: [] };
    }
    if (db.inTransaction) {
      throw new AuthorityActivationError(
        "legacy_activation_state_conflict",
        "authority activation must own its BEGIN IMMEDIATE transaction",
      );
    }

    const now = (this.deps.now ?? (() => new Date()))().toISOString();
    try {
      return db.transaction((): AuthorityActivationResult => {
      if (readSessionMemoryMutationAuthorityMode(db) !== "legacy_compatibility") {
        return { kind: "already_active", authority_mode: "smc_v1", quarantined_job_ids: [] };
      }
      if (hasActivationOwnedState(db)) {
        return blocked("legacy_activation_state_conflict", null);
      }
      const classified = readLegacyJobs(db);
      const nonterminal = readLegacyNonterminalJobs(db);
      const incompatible = legacyProjectsWithMultipleNonterminalJobs(nonterminal);
      if (incompatible.length > 0) {
        const conflict = incompatible[0]!;
        return {
          kind: "blocked",
          authority_mode: "legacy_compatibility",
          code: "legacy_project_multiple_nonterminal_jobs",
          job_id: conflict.job_ids[0] ?? null,
          job_ids: conflict.job_ids,
          project_key: conflict.project_key,
          process_id: null,
          stage: "activation",
        } as const;
      }
      const rechecked = readLegacyJobs(db);
      if (!sameLegacyJobSnapshot(classified, rechecked)) {
        return blocked("legacy_job_state_changed", firstChangedJob(classified, rechecked));
      }

      insertLegacyJobDenyIdentitiesInOpenTransaction(db, { jobs: rechecked, now });
      quarantineLegacyJobsInOpenTransaction(db, {
        jobs: nonterminal,
        now,
        processLiveness: observeProcessLiveness(nonterminal, this.deps.isProcessAlive ?? isProcessAlive),
      });
      const activated = db.query(
        `UPDATE session_memory_mutation_authority
         SET mode = 'smc_v1', updated_at = ?
         WHERE singleton_id = 1 AND mode = 'legacy_compatibility'`,
      ).run(now);
      if (activated.changes !== 1) {
        throw new AuthorityActivationError(
          "legacy_activation_state_conflict",
          "Session Memory authority mode changed during activation",
        );
      }
      return {
        kind: "activated",
        authority_mode: "smc_v1",
        quarantined_job_ids: nonterminal.map((job) => job.job_id),
      };
      }).immediate();
    } catch (error) {
      if (error instanceof LegacyJobMigrationError) {
        return blocked("legacy_activation_state_conflict", null);
      }
      throw error;
    }
  }
}

export class AuthorityActivationError extends Error {
  constructor(readonly code: AuthorityActivationBlockedCode, message: string) {
    super(`${code}: ${message}`);
    this.name = "AuthorityActivationError";
  }
}

export function requireSessionMemoryAuthorityActivation(
  db: Database,
  deps: AuthorityActivationServiceDeps = {},
): Exclude<AuthorityActivationResult, { kind: "blocked" }> {
  const result = new AuthorityActivationService(deps).activate(db);
  if (result.kind === "blocked") {
    const owner = result.job_id
      ? ` for legacy job ${result.job_id}${result.process_id ? ` (PID ${result.process_id})` : ""}`
      : "";
    throw new AuthorityActivationError(result.code, `Session Memory authority activation is blocked${owner}`);
  }
  return result;
}

function observeProcessLiveness(
  jobs: readonly LegacyNonterminalJobSnapshot[],
  isAlive: ProcessLivenessChecker,
): Map<string, boolean | null> {
  const observations = new Map<string, boolean | null>();
  for (const job of jobs) {
    if (job.process_id === null) {
      observations.set(job.job_id, null);
      continue;
    }
    try {
      observations.set(job.job_id, isAlive(job.process_id));
    } catch {
      observations.set(job.job_id, null);
    }
  }
  return observations;
}

function hasActivationOwnedState(db: Database): boolean {
  return count(db, "session_memory_anchor_jobs") > 0
    || count(db, "legacy_session_job_deny_identities") > 0
    || count(db, "project_session_mutation_fences") > 0
    || count(db, "session_embedding_lifecycle_fence") > 0;
}

function count(db: Database, table: string): number {
  return (db.query(`SELECT count(*) AS count FROM ${table}`).get() as { count: number }).count;
}

function firstChangedJob(
  expected: readonly LegacyJobSnapshot[],
  actual: readonly LegacyJobSnapshot[],
): LegacyJobSnapshot | null {
  const actualById = new Map(actual.map((job) => [job.job_id, job]));
  for (const job of expected) {
    const next = actualById.get(job.job_id);
    if (!next || !sameLegacyJobSnapshot([job], [next])) return next ?? job;
  }
  return actual.find((job) => !expected.some((prior) => prior.job_id === job.job_id)) ?? null;
}

function blocked(
  code: AuthorityActivationBlockedCode,
  job: LegacyJobSnapshot | null,
): Extract<AuthorityActivationResult, { kind: "blocked" }> {
  return {
    kind: "blocked",
    authority_mode: "legacy_compatibility",
    code,
    job_id: job?.job_id ?? null,
    job_ids: job ? [job.job_id] : [],
    project_key: job?.project_key ?? null,
    process_id: job?.process_id ?? null,
    stage: "activation",
  };
}
