import type { Database } from "bun:sqlite";
import { randomUUID } from "node:crypto";
import { DEFAULT_SESSION_MEMORY_EMBEDDING_CONTRACT } from "../runtime/config.ts";
import { registerInitialActiveEmbeddingContract } from "./embedding-contract-store.ts";
import type { EmbeddingContractIdentity, EmbeddingScope } from "./embedding-contract-types.ts";
import { sessionMemoryEmbeddingId } from "./session-memory-embeddings.ts";
import {
  readSessionMemoryCanonicalState,
  sessionMemoryCanonicalStateDigest,
} from "./session-memory-revisions.ts";
import {
  SESSION_MEMORY_WRITE_FIREWALL_DENIAL,
  assertSessionMemoryWriteFirewallInstalled,
  createSessionMemoryWriteFirewallSchema,
  installEmbeddingLifecycleAdmissionValidation,
  installProjectAuthorityAdmissionValidation,
  installSessionMemoryWriteFirewallGuards,
} from "./session-memory-write-firewall.ts";
import { initialSMCOverlayDigest } from "../session-maintenance/overlay-store.ts";

type Migration = {
  version: number;
  sql?: string;
  apply?: (db: Database, now: Date) => void;
  disableForeignKeys?: boolean;
};

const MIGRATIONS: Migration[] = [
  {
    version: 1,
    sql: `
      CREATE TABLE sessions (
        id          TEXT PRIMARY KEY,
        project_key TEXT NOT NULL,
        title       TEXT,
        status      TEXT NOT NULL,
        started_at  TEXT NOT NULL,
        ended_at    TEXT,
        summary     TEXT
      );
      CREATE INDEX sessions_project_started ON sessions(project_key, started_at);
      CREATE TABLE session_events (
        id         INTEGER PRIMARY KEY AUTOINCREMENT,
        session_id TEXT NOT NULL REFERENCES sessions(id),
        ts         TEXT NOT NULL,
        kind       TEXT NOT NULL,
        message    TEXT NOT NULL
      );
      CREATE INDEX session_events_session_ts ON session_events(session_id, ts);
    `,
  },
  {
    version: 2,
    sql: `
      CREATE TABLE experience_events (
        id                  TEXT PRIMARY KEY,
        project_key         TEXT NOT NULL,
        occurred_at         TEXT NOT NULL,
        hook_event_name     TEXT,
        event_kind          TEXT,
        cwd                 TEXT,
        provider            TEXT NOT NULL,
        provider_session_id TEXT,
        turn_id             TEXT,
        raw_text            TEXT,
        raw_payload_json    TEXT NOT NULL,
        source              TEXT NOT NULL,
        status              TEXT NOT NULL CHECK (status IN ('valid', 'invalid')),
        repo_path           TEXT,
        git_branch          TEXT,
        git_commit          TEXT,
        git_worktree_id     TEXT,
        dedupe_key          TEXT,
        inserted_at         TEXT NOT NULL
      );
      CREATE INDEX experience_events_project_time ON experience_events(project_key, occurred_at);
      CREATE INDEX experience_events_project_kind_time ON experience_events(project_key, event_kind, occurred_at);
      CREATE INDEX experience_events_project_branch_time ON experience_events(project_key, git_branch, occurred_at);
      CREATE INDEX experience_events_provider_turn ON experience_events(provider, provider_session_id, turn_id);
      CREATE UNIQUE INDEX experience_events_dedupe_key ON experience_events(dedupe_key) WHERE dedupe_key IS NOT NULL;

      CREATE TABLE hook_errors (
        id               INTEGER PRIMARY KEY AUTOINCREMENT,
        occurred_at      TEXT NOT NULL,
        provider         TEXT,
        source           TEXT NOT NULL,
        project_key      TEXT,
        cwd              TEXT,
        hook_event_name  TEXT,
        error_message    TEXT NOT NULL,
        raw_payload_json TEXT
      );
      CREATE INDEX hook_errors_time ON hook_errors(occurred_at);
      CREATE INDEX hook_errors_project_time ON hook_errors(project_key, occurred_at);

      CREATE TABLE experience_event_tombstones (
        id                    TEXT PRIMARY KEY,
        original_event_id      TEXT NOT NULL,
        dedupe_key             TEXT,
        project_key            TEXT NOT NULL,
        ingest_job_id          TEXT,
        provider               TEXT,
        provider_session_id    TEXT,
        claimed_at             TEXT NOT NULL,
        finalized_at           TEXT,
        state                  TEXT NOT NULL CHECK (state IN ('claimed', 'output', 'no_output', 'failed', 'unfinished')),
        terminal_decision      TEXT,
        source_metadata_json   TEXT NOT NULL,
        retained_evidence_json TEXT NOT NULL,
        output_references_json TEXT NOT NULL
      );
      CREATE INDEX experience_event_tombstones_project_time ON experience_event_tombstones(project_key, claimed_at);
      CREATE UNIQUE INDEX experience_event_tombstones_original_event ON experience_event_tombstones(original_event_id);
      CREATE UNIQUE INDEX experience_event_tombstones_dedupe_key ON experience_event_tombstones(dedupe_key) WHERE dedupe_key IS NOT NULL;
    `,
  },
  {
    version: 3,
    sql: `
      CREATE TABLE ingest_jobs (
        id                  TEXT PRIMARY KEY,
        project_key         TEXT NOT NULL,
        status              TEXT NOT NULL CHECK (status IN ('starting', 'running', 'needs_followup', 'completed', 'failed')),
        provider            TEXT NOT NULL,
        provider_session_id TEXT,
        requested_by        TEXT,
        input_json          TEXT NOT NULL,
        output_counts_json  TEXT NOT NULL,
        terminal_summary    TEXT,
        error_json          TEXT,
        followup_state_json TEXT,
        started_at          TEXT,
        finished_at         TEXT,
        created_at          TEXT NOT NULL,
        updated_at          TEXT NOT NULL
      );
      CREATE INDEX ingest_jobs_project_created ON ingest_jobs(project_key, created_at);
      CREATE INDEX ingest_jobs_project_status_created ON ingest_jobs(project_key, status, created_at);

      CREATE TABLE session_memories (
        id                    TEXT PRIMARY KEY,
        project_key            TEXT NOT NULL,
        provider               TEXT,
        provider_session_id    TEXT,
        ingest_job_id          TEXT REFERENCES ingest_jobs(id),
        source_event_refs_json TEXT NOT NULL,
        memory_kind            TEXT NOT NULL CHECK (memory_kind IN ('continuity', 'decision', 'blocker', 'next_action', 'verification')),
        title                  TEXT,
        summary                TEXT NOT NULL,
        payload_json           TEXT NOT NULL,
        confidence             TEXT NOT NULL,
        risk                   TEXT NOT NULL,
        status                 TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'superseded', 'retracted')),
        superseded_by          TEXT,
        lifecycle_reason       TEXT,
        superseded_at          TEXT,
        retracted_at           TEXT,
        created_at             TEXT NOT NULL,
        updated_at             TEXT NOT NULL
      );
      CREATE INDEX session_memories_project_created ON session_memories(project_key, created_at);
      CREATE INDEX session_memories_project_kind_created ON session_memories(project_key, memory_kind, created_at);
      CREATE INDEX session_memories_project_status_created ON session_memories(project_key, status, created_at);

      CREATE TABLE memory_candidates (
        id                    TEXT PRIMARY KEY,
        project_key            TEXT NOT NULL,
        scope                  TEXT NOT NULL CHECK (scope IN ('session', 'project', 'practice', 'personal')),
        status                 TEXT NOT NULL CHECK (status IN ('pending', 'needs_review', 'processed', 'rejected')),
        candidate_type         TEXT NOT NULL,
        title                  TEXT,
        summary                TEXT NOT NULL,
        source_event_refs_json TEXT NOT NULL,
        evidence_json          TEXT NOT NULL,
        proposed_payload_json  TEXT NOT NULL,
        confidence             TEXT NOT NULL,
        risk                   TEXT NOT NULL,
        reason                 TEXT NOT NULL,
        created_at             TEXT NOT NULL,
        updated_at             TEXT NOT NULL,
        processed_at           TEXT
      );
      CREATE INDEX memory_candidates_project_status ON memory_candidates(project_key, status, created_at);
      CREATE INDEX memory_candidates_project_scope_status ON memory_candidates(project_key, scope, status, created_at);

      CREATE TABLE project_handoff_instructions (
        id                             TEXT PRIMARY KEY,
        project_key                    TEXT NOT NULL,
        status                         TEXT NOT NULL CHECK (status IN ('pending', 'needs_review', 'processed', 'rejected')),
        objective                      TEXT NOT NULL,
        prompt_text                    TEXT NOT NULL,
        source_session_memory_ids_json TEXT NOT NULL,
        source_event_refs_json         TEXT NOT NULL,
        suggested_actions_json         TEXT NOT NULL,
        reason                         TEXT NOT NULL,
        confidence                     TEXT NOT NULL,
        risk                           TEXT NOT NULL,
        created_at                     TEXT NOT NULL,
        updated_at                     TEXT NOT NULL,
        processed_at                   TEXT
      );
      CREATE INDEX project_handoff_instructions_project_status ON project_handoff_instructions(project_key, status, created_at);

      CREATE TABLE practice_handoff_instructions (
        id                             TEXT PRIMARY KEY,
        project_key                    TEXT NOT NULL,
        status                         TEXT NOT NULL CHECK (status IN ('pending', 'needs_review', 'processed', 'rejected')),
        objective                      TEXT NOT NULL,
        prompt_text                    TEXT NOT NULL,
        source_session_memory_ids_json TEXT NOT NULL,
        source_event_refs_json         TEXT NOT NULL,
        suggested_actions_json         TEXT NOT NULL,
        reason                         TEXT NOT NULL,
        confidence                     TEXT NOT NULL,
        risk                           TEXT NOT NULL,
        created_at                     TEXT NOT NULL,
        updated_at                     TEXT NOT NULL,
        processed_at                   TEXT
      );
      CREATE INDEX practice_handoff_instructions_project_status ON practice_handoff_instructions(project_key, status, created_at);

      CREATE TABLE personal_handoff_instructions (
        id                             TEXT PRIMARY KEY,
        project_key                    TEXT NOT NULL,
        status                         TEXT NOT NULL CHECK (status IN ('pending', 'needs_review', 'processed', 'rejected')),
        objective                      TEXT NOT NULL,
        prompt_text                    TEXT NOT NULL,
        source_session_memory_ids_json TEXT NOT NULL,
        source_event_refs_json         TEXT NOT NULL,
        suggested_actions_json         TEXT NOT NULL,
        reason                         TEXT NOT NULL,
        confidence                     TEXT NOT NULL,
        risk                           TEXT NOT NULL,
        created_at                     TEXT NOT NULL,
        updated_at                     TEXT NOT NULL,
        processed_at                   TEXT
      );
      CREATE INDEX personal_handoff_instructions_project_status ON personal_handoff_instructions(project_key, status, created_at);
    `,
  },
  {
    version: 4,
    apply: migrateExperienceEventTombstonesToClaimFinalizeSchema,
  },
  {
    version: 5,
    apply: migrateSessionMemoryEmbeddings,
  },
  {
    version: 6,
    sql: `
      CREATE TABLE query_embedding_cache (
        id                    TEXT PRIMARY KEY,
        project_key           TEXT NOT NULL,
        original_question     TEXT NOT NULL,
        normalized_question   TEXT NOT NULL,
        embedding_provider    TEXT NOT NULL,
        embedding_model       TEXT NOT NULL,
        embedding_dimensions  INTEGER NOT NULL,
        embedding_purpose     TEXT NOT NULL CHECK (embedding_purpose IN ('retrieval_document', 'retrieval_query')),
        format_version        INTEGER NOT NULL,
        embedding_json        TEXT NOT NULL,
        hit_count             INTEGER NOT NULL DEFAULT 0,
        created_at            TEXT NOT NULL,
        updated_at            TEXT NOT NULL,
        last_used_at          TEXT NOT NULL,
        UNIQUE (
          project_key,
          normalized_question,
          embedding_provider,
          embedding_model,
          embedding_dimensions,
          embedding_purpose,
          format_version
        )
      );
      CREATE INDEX query_embedding_cache_project_updated
        ON query_embedding_cache(project_key, updated_at);
    `,
  },
  {
    version: 7,
    apply: migrateBranchAwareSessionMemoryContext,
  },
  {
    version: 8,
    apply: migrateSessionMemoryLifecycle,
  },
  {
    version: 9,
    sql: `
      CREATE TABLE project_memory_retrieval_embeddings (
        id                    TEXT PRIMARY KEY,
        project_key           TEXT NOT NULL,
        wiki_path             TEXT NOT NULL,
        section_id            TEXT NOT NULL,
        section_hash          TEXT NOT NULL,
        hint_hash             TEXT,
        hint_hash_key         TEXT NOT NULL,
        embedding_provider    TEXT NOT NULL,
        embedding_model       TEXT NOT NULL,
        embedding_dimensions  INTEGER NOT NULL,
        embedding_purpose     TEXT NOT NULL CHECK (embedding_purpose IN ('retrieval_document')),
        format_version        INTEGER NOT NULL,
        normalized_text_hash  TEXT,
        status                TEXT NOT NULL CHECK (status IN ('pending', 'indexed', 'failed', 'stale', 'orphaned')),
        failure_reason        TEXT,
        retry_count           INTEGER NOT NULL DEFAULT 0,
        created_at            TEXT NOT NULL,
        updated_at            TEXT NOT NULL,
        indexed_at            TEXT,
        UNIQUE (
          project_key,
          wiki_path,
          section_id,
          section_hash,
          hint_hash_key,
          embedding_provider,
          embedding_model,
          embedding_dimensions,
          embedding_purpose,
          format_version
        )
      );
      CREATE INDEX project_memory_retrieval_embeddings_project_status
        ON project_memory_retrieval_embeddings(project_key, status, updated_at);
      CREATE INDEX project_memory_retrieval_embeddings_project_section
        ON project_memory_retrieval_embeddings(project_key, wiki_path, section_id);
    `,
  },
  {
    version: 10,
    sql: `
      CREATE TABLE retrieval_maintenance_queue (
        id                  TEXT PRIMARY KEY,
        project_key         TEXT NOT NULL,
        status              TEXT NOT NULL CHECK (status IN ('pending', 'claimed', 'processed', 'rejected', 'failed')),
        kind                TEXT NOT NULL CHECK (kind IN ('hint_refresh', 'index_repair', 'poor_retrieval_feedback', 'missing_expected_hit')),
        target_layer        TEXT NOT NULL CHECK (target_layer = 'project'),
        wiki_refs_json      TEXT NOT NULL,
        query_context_json  TEXT NOT NULL,
        feedback_json       TEXT NOT NULL,
        reason              TEXT NOT NULL,
        dedupe_key          TEXT NOT NULL,
        created_by          TEXT NOT NULL CHECK (created_by IN ('mcp_query', 'cli_query', 'project_learn', 'operator')),
        created_at          TEXT NOT NULL,
        updated_at          TEXT NOT NULL,
        processed_at        TEXT,
        failure_reason      TEXT
      );
      CREATE UNIQUE INDEX retrieval_maintenance_queue_pending_dedupe
        ON retrieval_maintenance_queue(project_key, dedupe_key)
        WHERE status IN ('pending', 'claimed', 'failed');
      CREATE INDEX retrieval_maintenance_queue_project_status
        ON retrieval_maintenance_queue(project_key, status, created_at);
      CREATE INDEX retrieval_maintenance_queue_project_kind_status
        ON retrieval_maintenance_queue(project_key, kind, status, created_at);
    `,
  },
  {
    version: 11,
    sql: `
      CREATE TABLE project_memory_hint_jobs (
        id                  TEXT PRIMARY KEY,
        project_key         TEXT NOT NULL,
        category            TEXT,
        status              TEXT NOT NULL CHECK (status IN ('pending', 'running', 'completed', 'failed', 'skipped')),
        required            INTEGER NOT NULL CHECK (required IN (0, 1)),
        section_refs_json   TEXT NOT NULL,
        provider            TEXT,
        model               TEXT,
        run_ref             TEXT,
        failure_reason      TEXT,
        created_at          TEXT NOT NULL,
        updated_at          TEXT NOT NULL,
        completed_at        TEXT
      );
      CREATE INDEX project_memory_hint_jobs_project_status
        ON project_memory_hint_jobs(project_key, status, created_at);
    `,
  },
  {
    version: 12,
    sql: `
      CREATE TABLE project_memory_query_logs (
        id                             TEXT PRIMARY KEY,
        project_key                    TEXT NOT NULL,
        question                       TEXT NOT NULL,
        normalized_question            TEXT,
        query_embedding_cache_id       TEXT,
        query_embedding_provider       TEXT,
        query_embedding_model          TEXT,
        query_embedding_dimensions     INTEGER,
        query_embedding_purpose        TEXT,
        query_embedding_format_version INTEGER,
        query_embedding_json           TEXT,
        result_json                    TEXT NOT NULL,
        match_count                    INTEGER NOT NULL,
        degraded                       INTEGER NOT NULL CHECK (degraded IN (0, 1)),
        degraded_reason                TEXT,
        created_at                     TEXT NOT NULL
      );
      CREATE INDEX project_memory_query_logs_project_created
        ON project_memory_query_logs(project_key, created_at);

      CREATE TABLE session_memory_query_logs (
        id                             TEXT PRIMARY KEY,
        project_key                    TEXT NOT NULL,
        question                       TEXT NOT NULL,
        normalized_question            TEXT,
        query_embedding_cache_id       TEXT,
        query_embedding_provider       TEXT,
        query_embedding_model          TEXT,
        query_embedding_dimensions     INTEGER,
        query_embedding_purpose        TEXT,
        query_embedding_format_version INTEGER,
        query_embedding_json           TEXT,
        result_json                    TEXT NOT NULL,
        match_count                    INTEGER NOT NULL,
        degraded                       INTEGER NOT NULL CHECK (degraded IN (0, 1)),
        degraded_reason                TEXT,
        created_at                     TEXT NOT NULL
      );
      CREATE INDEX session_memory_query_logs_project_created
        ON session_memory_query_logs(project_key, created_at);

      CREATE TABLE practice_memory_query_logs (
        id                             TEXT PRIMARY KEY,
        project_key                    TEXT NOT NULL,
        question                       TEXT NOT NULL,
        normalized_question            TEXT,
        query_embedding_cache_id       TEXT,
        query_embedding_provider       TEXT,
        query_embedding_model          TEXT,
        query_embedding_dimensions     INTEGER,
        query_embedding_purpose        TEXT,
        query_embedding_format_version INTEGER,
        query_embedding_json           TEXT,
        result_json                    TEXT NOT NULL,
        match_count                    INTEGER NOT NULL,
        degraded                       INTEGER NOT NULL CHECK (degraded IN (0, 1)),
        degraded_reason                TEXT,
        created_at                     TEXT NOT NULL
      );
      CREATE INDEX practice_memory_query_logs_project_created
        ON practice_memory_query_logs(project_key, created_at);

      CREATE TABLE personal_memory_query_logs (
        id                             TEXT PRIMARY KEY,
        project_key                    TEXT NOT NULL,
        question                       TEXT NOT NULL,
        normalized_question            TEXT,
        query_embedding_cache_id       TEXT,
        query_embedding_provider       TEXT,
        query_embedding_model          TEXT,
        query_embedding_dimensions     INTEGER,
        query_embedding_purpose        TEXT,
        query_embedding_format_version INTEGER,
        query_embedding_json           TEXT,
        result_json                    TEXT NOT NULL,
        match_count                    INTEGER NOT NULL,
        degraded                       INTEGER NOT NULL CHECK (degraded IN (0, 1)),
        degraded_reason                TEXT,
        created_at                     TEXT NOT NULL
      );
      CREATE INDEX personal_memory_query_logs_project_created
        ON personal_memory_query_logs(project_key, created_at);
    `,
  },
  {
    version: 13,
    sql: `
      CREATE VIRTUAL TABLE project_memory_section_fts USING fts5(
        retrieval_row_id UNINDEXED,
        project_key UNINDEXED,
        wiki_path,
        page_title,
        heading_text,
        section_id,
        body_text,
        tokenize = 'porter unicode61'
      );
    `,
  },
  {
    version: 14,
    sql: `
      ALTER TABLE project_memory_query_logs ADD COLUMN answer_text TEXT;
      ALTER TABLE project_memory_query_logs ADD COLUMN response_json TEXT;
      ALTER TABLE project_memory_query_logs ADD COLUMN eval_run_id TEXT;
      ALTER TABLE project_memory_query_logs ADD COLUMN eval_json TEXT;

      ALTER TABLE session_memory_query_logs ADD COLUMN answer_text TEXT;
      ALTER TABLE session_memory_query_logs ADD COLUMN response_json TEXT;
      ALTER TABLE session_memory_query_logs ADD COLUMN eval_run_id TEXT;
      ALTER TABLE session_memory_query_logs ADD COLUMN eval_json TEXT;

      ALTER TABLE practice_memory_query_logs ADD COLUMN answer_text TEXT;
      ALTER TABLE practice_memory_query_logs ADD COLUMN response_json TEXT;
      ALTER TABLE practice_memory_query_logs ADD COLUMN eval_run_id TEXT;
      ALTER TABLE practice_memory_query_logs ADD COLUMN eval_json TEXT;

      ALTER TABLE personal_memory_query_logs ADD COLUMN answer_text TEXT;
      ALTER TABLE personal_memory_query_logs ADD COLUMN response_json TEXT;
      ALTER TABLE personal_memory_query_logs ADD COLUMN eval_run_id TEXT;
      ALTER TABLE personal_memory_query_logs ADD COLUMN eval_json TEXT;
    `,
  },
  {
    version: 15,
    apply: migrateEmbeddingContracts,
  },
  {
    version: 16,
    apply: migrateSessionMemoryRevisionIdentity,
    disableForeignKeys: true,
  },
  {
    version: 17,
    sql: `
      CREATE TABLE project_session_mutation_fences (
        project_key        TEXT PRIMARY KEY,
        owner_id           TEXT NOT NULL,
        owner_kind         TEXT NOT NULL CHECK (owner_kind IN ('anchor_job', 'repair')),
        phase              TEXT NOT NULL CHECK (
          phase IN ('preparing', 'running', 'needs_followup', 'finalizing', 'completed', 'abandoned')
        ),
        owner_epoch        INTEGER NOT NULL CHECK (owner_epoch > 0),
        heartbeat_at       TEXT NOT NULL,
        acquired_at        TEXT NOT NULL,
        terminal_receipt_id TEXT CHECK (
          terminal_receipt_id IS NULL OR phase IN ('completed', 'abandoned')
        )
      );
      CREATE INDEX project_session_mutation_fences_phase
        ON project_session_mutation_fences(phase, heartbeat_at);

      CREATE TABLE session_memory_mutation_authority (
        singleton_id INTEGER PRIMARY KEY CHECK (singleton_id = 1),
        mode         TEXT NOT NULL CHECK (mode IN ('legacy_compatibility', 'smc_v1')),
        updated_at   TEXT NOT NULL
      );
      INSERT INTO session_memory_mutation_authority (singleton_id, mode, updated_at)
      VALUES (1, 'legacy_compatibility', CURRENT_TIMESTAMP);
    `,
    apply: installProjectAuthorityAdmissionValidation,
  },
  {
    version: 18,
    sql: `
      CREATE TABLE session_embedding_lifecycle_generation (
        singleton_id          INTEGER PRIMARY KEY CHECK (singleton_id = 1),
        last_generation       INTEGER NOT NULL CHECK (last_generation >= 0),
        last_receipt_id       TEXT
      );
      INSERT INTO session_embedding_lifecycle_generation
        (singleton_id, last_generation, last_receipt_id)
      VALUES (1, 0, NULL);

      CREATE TABLE session_embedding_lifecycle_fence (
        singleton_id       INTEGER PRIMARY KEY CHECK (singleton_id = 1),
        operation_id       TEXT NOT NULL UNIQUE,
        operation_kind     TEXT NOT NULL CHECK (operation_kind IN ('migrate', 'rollback', 'prune')),
        generation         INTEGER NOT NULL UNIQUE CHECK (generation > 0),
        predecessor_receipt_id TEXT,
        phase              TEXT NOT NULL CHECK (
          phase IN ('running', 'needs_followup', 'completed', 'abandoned')
        ),
        owner_epoch        INTEGER NOT NULL CHECK (owner_epoch > 0),
        heartbeat_at       TEXT NOT NULL,
        acquired_at        TEXT NOT NULL,
        active_contract_id TEXT,
        target_contract_id TEXT,
        operation_plan_json TEXT NOT NULL,
        operation_plan_digest TEXT NOT NULL CHECK (
          length(operation_plan_digest) = 71
          AND substr(operation_plan_digest, 1, 7) = 'sha256:'
          AND substr(operation_plan_digest, 8) NOT GLOB '*[^0-9a-f]*'
        ),
        terminal_receipt_id TEXT CHECK (
          terminal_receipt_id IS NULL OR phase IN ('completed', 'abandoned')
        )
      );

      CREATE TABLE session_embedding_lifecycle_receipts (
        id                 TEXT PRIMARY KEY,
        operation_id       TEXT NOT NULL UNIQUE,
        operation_kind     TEXT NOT NULL CHECK (operation_kind IN ('migrate', 'rollback', 'prune')),
        generation         INTEGER NOT NULL UNIQUE CHECK (generation > 0),
        predecessor_receipt_id TEXT,
        outcome            TEXT NOT NULL CHECK (outcome IN ('completed', 'abandoned')),
        owner_epoch        INTEGER NOT NULL CHECK (owner_epoch > 0),
        active_contract_id TEXT,
        target_contract_id TEXT,
        operation_plan_json TEXT NOT NULL,
        operation_plan_digest TEXT NOT NULL CHECK (
          length(operation_plan_digest) = 71
          AND substr(operation_plan_digest, 1, 7) = 'sha256:'
          AND substr(operation_plan_digest, 8) NOT GLOB '*[^0-9a-f]*'
        ),
        result_digest      TEXT NOT NULL CHECK (
          length(result_digest) = 71
          AND substr(result_digest, 1, 7) = 'sha256:'
          AND substr(result_digest, 8) NOT GLOB '*[^0-9a-f]*'
        ),
        created_at         TEXT NOT NULL
      );
      CREATE INDEX session_embedding_lifecycle_receipts_created
        ON session_embedding_lifecycle_receipts(created_at, operation_id);
    `,
    apply: installEmbeddingLifecycleAdmissionValidation,
  },
  {
    version: 19,
    sql: `
      CREATE TABLE legacy_session_job_deny_identities (
        job_id        TEXT PRIMARY KEY REFERENCES ingest_jobs(id),
        project_key   TEXT NOT NULL,
        reason_code   TEXT NOT NULL CHECK (reason_code = 'pre_smc_job_identity'),
        source_status TEXT NOT NULL CHECK (
          source_status IN ('starting', 'running', 'needs_followup', 'completed', 'failed')
        ),
        denied_at     TEXT NOT NULL
      );
      CREATE INDEX legacy_session_job_deny_identities_project
        ON legacy_session_job_deny_identities(project_key, denied_at, job_id);
      CREATE TRIGGER legacy_session_job_deny_identities_immutable_update
      BEFORE UPDATE ON legacy_session_job_deny_identities
      BEGIN
        SELECT RAISE(ABORT, 'legacy_session_job_deny_identity_immutable');
      END;
      CREATE TRIGGER legacy_session_job_deny_identities_immutable_delete
      BEFORE DELETE ON legacy_session_job_deny_identities
      BEGIN
        SELECT RAISE(ABORT, 'legacy_session_job_deny_identity_immutable');
      END;

      CREATE TABLE session_memory_anchor_jobs (
        job_id        TEXT PRIMARY KEY REFERENCES ingest_jobs(id),
        project_key   TEXT NOT NULL,
        phase         TEXT NOT NULL CHECK (
          phase IN ('preparing', 'running', 'needs_followup', 'finalizing', 'completed', 'abandoned')
        ),
        owner_epoch   INTEGER NOT NULL CHECK (owner_epoch > 0),
        reason_code   TEXT,
        heartbeat_at  TEXT NOT NULL,
        created_at    TEXT NOT NULL,
        updated_at    TEXT NOT NULL,
        UNIQUE (project_key, job_id)
      );
      CREATE INDEX session_memory_anchor_jobs_project_phase
        ON session_memory_anchor_jobs(project_key, phase, updated_at);

      CREATE TABLE session_memory_anchor_attempts (
        id                  TEXT PRIMARY KEY,
        job_id              TEXT NOT NULL REFERENCES session_memory_anchor_jobs(job_id),
        attempt_number      INTEGER NOT NULL CHECK (attempt_number > 0),
        owner_epoch         INTEGER NOT NULL CHECK (owner_epoch > 0),
        attempt_kind        TEXT NOT NULL CHECK (attempt_kind IN ('legacy', 'smc')),
        provider            TEXT NOT NULL,
        provider_session_id TEXT,
        process_id          INTEGER CHECK (process_id IS NULL OR process_id > 0),
        status              TEXT NOT NULL CHECK (
          status IN ('running', 'needs_followup', 'completed', 'failed', 'abandoned')
        ),
        started_at          TEXT,
        finished_at         TEXT,
        details_json        TEXT NOT NULL,
        created_at          TEXT NOT NULL,
        updated_at          TEXT NOT NULL,
        UNIQUE (job_id, attempt_number),
        UNIQUE (job_id, owner_epoch)
      );
      CREATE INDEX session_memory_anchor_attempts_job_created
        ON session_memory_anchor_attempts(job_id, attempt_number, created_at);
    `,
    apply: applyMigration19,
  },
  {
    version: 20,
    sql: `
      CREATE TABLE smc_manifests (
        job_id                    TEXT PRIMARY KEY REFERENCES session_memory_anchor_jobs(job_id),
        project_key               TEXT NOT NULL,
        schema_version            INTEGER NOT NULL CHECK (schema_version = 1),
        owner_epoch               INTEGER NOT NULL CHECK (owner_epoch > 0),
        trigger_reason            TEXT NOT NULL,
        compatibility_selection_limit INTEGER CHECK (
          compatibility_selection_limit IS NULL OR compatibility_selection_limit > 0
        ),
        preparation_plan_identity TEXT NOT NULL CHECK (
          length(preparation_plan_identity) = 71
          AND substr(preparation_plan_identity, 1, 7) = 'sha256:'
        ),
        evidence_digest           TEXT NOT NULL CHECK (length(evidence_digest) = 71),
        memory_snapshot_digest    TEXT NOT NULL CHECK (length(memory_snapshot_digest) = 71),
        retrieval_snapshot_digest TEXT NOT NULL CHECK (length(retrieval_snapshot_digest) = 71),
        snapshot_token            TEXT NOT NULL CHECK (length(snapshot_token) = 71),
        manifest_digest           TEXT NOT NULL UNIQUE CHECK (length(manifest_digest) = 71),
        governing_identities_json TEXT NOT NULL,
        evidence_budgets_json     TEXT NOT NULL,
        workflow_budgets_json     TEXT NOT NULL CHECK (
          json_valid(workflow_budgets_json)
          AND json_type(workflow_budgets_json) = 'object'
          AND json_type(workflow_budgets_json, '$.max_affected_work_set_size') = 'integer'
          AND json_type(workflow_budgets_json, '$.max_cumulative_returned_result_bytes') = 'integer'
          AND json_type(workflow_budgets_json, '$.max_provider_envelope_bytes') = 'integer'
          AND json_type(workflow_budgets_json, '$.max_queries') = 'integer'
          AND json_type(workflow_budgets_json, '$.max_turns') = 'integer'
          AND json_type(workflow_budgets_json, '$.retrieval_page_item_limit') = 'integer'
          AND json_type(workflow_budgets_json, '$.semantic_distance_threshold_micros') = 'integer'
          AND json_type(workflow_budgets_json, '$.semantic_qualifying_result_ceiling') = 'integer'
          AND json_extract(workflow_budgets_json, '$.max_affected_work_set_size') BETWEEN 1 AND 9007199254740991
          AND json_extract(workflow_budgets_json, '$.max_cumulative_returned_result_bytes') BETWEEN 1 AND 9007199254740991
          AND json_extract(workflow_budgets_json, '$.max_provider_envelope_bytes') BETWEEN 1 AND 9007199254740991
          AND json_extract(workflow_budgets_json, '$.max_queries') BETWEEN 1 AND 9007199254740991
          AND json_extract(workflow_budgets_json, '$.max_turns') BETWEEN 1 AND 9007199254740991
          AND json_extract(workflow_budgets_json, '$.retrieval_page_item_limit') BETWEEN 1 AND 9007199254740991
          AND json_extract(workflow_budgets_json, '$.semantic_distance_threshold_micros') BETWEEN 1 AND 2000000
          AND json_extract(workflow_budgets_json, '$.semantic_qualifying_result_ceiling') BETWEEN 1 AND 9007199254740991
          AND json(workflow_budgets_json) = json_object(
            'max_affected_work_set_size', json_extract(workflow_budgets_json, '$.max_affected_work_set_size'),
            'max_cumulative_returned_result_bytes', json_extract(workflow_budgets_json, '$.max_cumulative_returned_result_bytes'),
            'max_provider_envelope_bytes', json_extract(workflow_budgets_json, '$.max_provider_envelope_bytes'),
            'max_queries', json_extract(workflow_budgets_json, '$.max_queries'),
            'max_turns', json_extract(workflow_budgets_json, '$.max_turns'),
            'retrieval_page_item_limit', json_extract(workflow_budgets_json, '$.retrieval_page_item_limit'),
            'semantic_distance_threshold_micros', json_extract(workflow_budgets_json, '$.semantic_distance_threshold_micros'),
            'semantic_qualifying_result_ceiling', json_extract(workflow_budgets_json, '$.semantic_qualifying_result_ceiling')
          )
        ),
        target_context_json       TEXT NOT NULL,
        embedding_contract_id     TEXT NOT NULL,
        embedding_provider        TEXT NOT NULL,
        embedding_model           TEXT NOT NULL,
        embedding_dimensions      INTEGER NOT NULL CHECK (embedding_dimensions > 0),
        embedding_format_version  INTEGER NOT NULL CHECK (embedding_format_version > 0),
        embedding_vector_table    TEXT NOT NULL,
        selected_evidence_count   INTEGER NOT NULL CHECK (selected_evidence_count >= 0),
        no_agent_intent_count     INTEGER NOT NULL CHECK (no_agent_intent_count >= 0),
        work_batch_count          INTEGER NOT NULL CHECK (work_batch_count >= 0),
        evidence_batch_count      INTEGER NOT NULL CHECK (evidence_batch_count >= 0),
        audit_batch_count         INTEGER NOT NULL CHECK (audit_batch_count IN (0, 1)),
        audit_member_count        INTEGER NOT NULL CHECK (audit_member_count >= 0),
        audit_selection_digest    TEXT NOT NULL CHECK (length(audit_selection_digest) = 71),
        audit_algorithm_digest    TEXT NOT NULL CHECK (length(audit_algorithm_digest) = 71),
        active_memory_count       INTEGER NOT NULL CHECK (active_memory_count >= 0),
        total_evidence_bytes      INTEGER NOT NULL CHECK (total_evidence_bytes >= 0),
        created_at                TEXT NOT NULL,
        UNIQUE (project_key, job_id)
      );
      CREATE INDEX smc_manifests_project_created
        ON smc_manifests(project_key, created_at, job_id);

      CREATE TABLE smc_evidence_snapshot (
        job_id          TEXT NOT NULL REFERENCES session_memory_anchor_jobs(job_id),
        source_id       TEXT NOT NULL,
        ordinal         INTEGER NOT NULL CHECK (ordinal >= 0),
        tombstone_id    TEXT NOT NULL UNIQUE REFERENCES experience_event_tombstones(id),
        content_hash    TEXT NOT NULL CHECK (length(content_hash) = 71),
        encoded_bytes   INTEGER NOT NULL CHECK (encoded_bytes > 0),
        evidence_json   TEXT NOT NULL,
        PRIMARY KEY (job_id, source_id),
        UNIQUE (job_id, ordinal)
      );

      CREATE TABLE smc_work_batches (
        job_id          TEXT NOT NULL REFERENCES session_memory_anchor_jobs(job_id),
        batch_id        TEXT NOT NULL,
        ordinal         INTEGER NOT NULL CHECK (ordinal >= 0),
        work_kind       TEXT NOT NULL CHECK (work_kind IN ('evidence', 'audit')),
        item_count      INTEGER NOT NULL CHECK (item_count > 0),
        encoded_bytes   INTEGER NOT NULL CHECK (encoded_bytes > 0),
        batch_digest    TEXT NOT NULL CHECK (length(batch_digest) = 71),
        PRIMARY KEY (job_id, batch_id),
        UNIQUE (job_id, batch_id, work_kind),
        UNIQUE (job_id, ordinal)
      );
      CREATE UNIQUE INDEX smc_work_batches_one_audit_per_job
        ON smc_work_batches(job_id) WHERE work_kind = 'audit';

      CREATE TABLE smc_evidence_batch_members (
        job_id          TEXT NOT NULL,
        batch_id        TEXT NOT NULL,
        work_kind       TEXT NOT NULL CHECK (work_kind = 'evidence'),
        source_id       TEXT NOT NULL,
        ordinal         INTEGER NOT NULL CHECK (ordinal >= 0),
        content_hash    TEXT NOT NULL CHECK (length(content_hash) = 71),
        PRIMARY KEY (job_id, batch_id, source_id),
        UNIQUE (job_id, batch_id, ordinal),
        FOREIGN KEY (job_id, batch_id, work_kind)
          REFERENCES smc_work_batches(job_id, batch_id, work_kind),
        FOREIGN KEY (job_id, source_id) REFERENCES smc_evidence_snapshot(job_id, source_id)
      );

      CREATE TABLE smc_audit_batch_members (
        job_id          TEXT NOT NULL,
        batch_id        TEXT NOT NULL,
        work_kind       TEXT NOT NULL CHECK (work_kind = 'audit'),
        memory_id       TEXT NOT NULL,
        ordinal         INTEGER NOT NULL CHECK (ordinal >= 0),
        revision        INTEGER NOT NULL CHECK (revision > 0),
        state_digest    TEXT NOT NULL CHECK (length(state_digest) = 71),
        selection_basis TEXT NOT NULL CHECK (
          selection_basis IN ('never_audited', 'least_recent_audit', 'identity_invalidated')
        ),
        prior_audit_at  TEXT,
        member_digest   TEXT NOT NULL CHECK (length(member_digest) = 71),
        PRIMARY KEY (job_id, batch_id, memory_id),
        UNIQUE (job_id, batch_id, ordinal),
        FOREIGN KEY (job_id, batch_id, work_kind)
          REFERENCES smc_work_batches(job_id, batch_id, work_kind)
      );

      CREATE TABLE smc_no_agent_intents (
        job_id             TEXT NOT NULL REFERENCES session_memory_anchor_jobs(job_id),
        source_id          TEXT NOT NULL,
        ordinal            INTEGER NOT NULL CHECK (ordinal >= 0),
        tombstone_id       TEXT NOT NULL UNIQUE REFERENCES experience_event_tombstones(id),
        source_hash        TEXT NOT NULL CHECK (length(source_hash) = 71),
        reason             TEXT NOT NULL,
        terminal_state     TEXT NOT NULL CHECK (terminal_state = 'no_output'),
        terminal_decision  TEXT NOT NULL,
        PRIMARY KEY (job_id, source_id),
        UNIQUE (job_id, ordinal)
      );

      CREATE TABLE smc_memory_snapshot (
        job_id                    TEXT NOT NULL REFERENCES session_memory_anchor_jobs(job_id),
        memory_id                 TEXT NOT NULL,
        ordinal                   INTEGER NOT NULL CHECK (ordinal >= 0),
        project_key               TEXT NOT NULL,
        provider                  TEXT,
        provider_session_id       TEXT,
        ingest_job_id             TEXT,
        source_event_refs_json    TEXT NOT NULL,
        memory_kind               TEXT NOT NULL,
        title                     TEXT,
        summary                   TEXT NOT NULL,
        payload_json              TEXT NOT NULL,
        confidence                TEXT NOT NULL,
        risk                      TEXT NOT NULL,
        status                    TEXT NOT NULL CHECK (status = 'active'),
        superseded_by             TEXT,
        lifecycle_reason          TEXT,
        superseded_at             TEXT,
        retracted_at              TEXT,
        revision                  INTEGER NOT NULL CHECK (revision > 0),
        state_digest              TEXT NOT NULL CHECK (length(state_digest) = 71),
        created_at                TEXT NOT NULL,
        updated_at                TEXT NOT NULL,
        PRIMARY KEY (job_id, memory_id),
        UNIQUE (job_id, ordinal)
      );
      CREATE INDEX smc_memory_snapshot_project_memory
        ON smc_memory_snapshot(project_key, memory_id, job_id);

      CREATE TABLE smc_memory_snapshot_contexts (
        job_id             TEXT NOT NULL,
        memory_id          TEXT NOT NULL,
        ordinal            INTEGER NOT NULL CHECK (ordinal >= 0),
        repo_path          TEXT,
        git_branch         TEXT,
        git_commit         TEXT,
        git_worktree_id    TEXT,
        source_event_ref   TEXT NOT NULL,
        PRIMARY KEY (job_id, memory_id, ordinal),
        FOREIGN KEY (job_id, memory_id) REFERENCES smc_memory_snapshot(job_id, memory_id)
      );

      CREATE TABLE smc_memory_snapshot_links (
        job_id                 TEXT NOT NULL REFERENCES session_memory_anchor_jobs(job_id),
        link_id                INTEGER NOT NULL,
        source_memory_id       TEXT NOT NULL,
        target_memory_id       TEXT NOT NULL,
        project_key            TEXT NOT NULL,
        relationship           TEXT NOT NULL,
        reason                 TEXT NOT NULL,
        source_event_refs_json TEXT NOT NULL,
        created_at             TEXT NOT NULL,
        PRIMARY KEY (job_id, link_id)
      );
      CREATE INDEX smc_memory_snapshot_links_endpoints
        ON smc_memory_snapshot_links(job_id, source_memory_id, target_memory_id);

      CREATE TABLE smc_memory_snapshot_search_texts (
        job_id               TEXT NOT NULL,
        memory_id            TEXT NOT NULL,
        normalized_text      TEXT NOT NULL,
        normalized_text_hash TEXT NOT NULL CHECK (length(normalized_text_hash) = 64),
        PRIMARY KEY (job_id, memory_id),
        FOREIGN KEY (job_id, memory_id) REFERENCES smc_memory_snapshot(job_id, memory_id)
      );

      CREATE TABLE smc_memory_snapshot_vectors (
        job_id                   TEXT NOT NULL,
        memory_id                TEXT NOT NULL,
        embedding_row_id         TEXT NOT NULL,
        embedding_contract_id    TEXT NOT NULL,
        embedding_provider       TEXT NOT NULL,
        embedding_model          TEXT NOT NULL,
        embedding_dimensions     INTEGER NOT NULL CHECK (embedding_dimensions > 0),
        embedding_purpose        TEXT NOT NULL CHECK (embedding_purpose = 'retrieval_document'),
        embedding_format_version INTEGER NOT NULL CHECK (embedding_format_version > 0),
        normalized_text_hash     TEXT NOT NULL CHECK (length(normalized_text_hash) = 64),
        vector_bytes             BLOB NOT NULL CHECK (length(vector_bytes) = embedding_dimensions * 4),
        vector_digest            TEXT NOT NULL CHECK (length(vector_digest) = 71),
        PRIMARY KEY (job_id, memory_id),
        UNIQUE (job_id, embedding_row_id),
        FOREIGN KEY (job_id, memory_id) REFERENCES smc_memory_snapshot(job_id, memory_id)
      );

      CREATE TABLE smc_retrieval_snapshot_completeness (
        job_id                     TEXT PRIMARY KEY REFERENCES session_memory_anchor_jobs(job_id),
        embedding_contract_id      TEXT NOT NULL,
        active_memory_count        INTEGER NOT NULL CHECK (active_memory_count >= 0),
        indexed_metadata_count     INTEGER NOT NULL CHECK (indexed_metadata_count >= 0),
        vector_count               INTEGER NOT NULL CHECK (vector_count >= 0),
        normalized_text_match_count INTEGER NOT NULL CHECK (normalized_text_match_count >= 0),
        coverage_digest            TEXT NOT NULL CHECK (length(coverage_digest) = 71),
        CHECK (
          active_memory_count = indexed_metadata_count
          AND active_memory_count = vector_count
          AND active_memory_count = normalized_text_match_count
        )
      );
    `,
  },
  {
    version: 21,
    sql: `
      CREATE UNIQUE INDEX session_memory_anchor_attempts_job_id_id
        ON session_memory_anchor_attempts(job_id, id);

      CREATE TABLE smc_overlay_state (
        job_id            TEXT PRIMARY KEY REFERENCES smc_manifests(job_id),
        current_revision  INTEGER NOT NULL DEFAULT 0 CHECK (current_revision >= 0),
        current_digest    TEXT NOT NULL CHECK (
          length(current_digest) = 71
          AND substr(current_digest, 1, 7) = 'sha256:'
          AND substr(current_digest, 8) NOT GLOB '*[^0-9a-f]*'
        ),
        updated_at        TEXT NOT NULL
      );

      CREATE TABLE smc_overlay_revisions (
        job_id          TEXT NOT NULL REFERENCES smc_manifests(job_id),
        revision        INTEGER NOT NULL CHECK (revision > 0),
        parent_revision INTEGER NOT NULL CHECK (parent_revision >= 0),
        work_batch_id   TEXT NOT NULL,
        attempt_id      TEXT NOT NULL,
        owner_epoch     INTEGER NOT NULL CHECK (owner_epoch > 0),
        response_digest TEXT NOT NULL CHECK (
          length(response_digest) = 71 AND substr(response_digest, 1, 7) = 'sha256:'
        ),
        delta_digest    TEXT NOT NULL CHECK (
          length(delta_digest) = 71 AND substr(delta_digest, 1, 7) = 'sha256:'
        ),
        overlay_digest  TEXT NOT NULL CHECK (
          length(overlay_digest) = 71 AND substr(overlay_digest, 1, 7) = 'sha256:'
        ),
        created_at      TEXT NOT NULL,
        PRIMARY KEY (job_id, revision),
        UNIQUE (job_id, work_batch_id),
        FOREIGN KEY (job_id, attempt_id)
          REFERENCES session_memory_anchor_attempts(job_id, id),
        FOREIGN KEY (job_id, work_batch_id)
          REFERENCES smc_work_batches(job_id, batch_id),
        CHECK (revision = parent_revision + 1)
      );
      CREATE INDEX smc_overlay_revisions_attempt
        ON smc_overlay_revisions(job_id, attempt_id, revision);

      CREATE TABLE smc_overlay_records (
        job_id         TEXT NOT NULL,
        revision       INTEGER NOT NULL,
        record_kind    TEXT NOT NULL CHECK (
          record_kind IN (
            'memory', 'memory_disposition', 'candidate', 'handoff', 'source_disposition'
          )
        ),
        staged_id      TEXT NOT NULL,
        stable_key     TEXT NOT NULL,
        operation      TEXT NOT NULL CHECK (operation IN ('upsert', 'discard')),
        base_memory_id TEXT,
        final_id       TEXT,
        payload_json   TEXT,
        payload_digest TEXT,
        created_at     TEXT NOT NULL,
        PRIMARY KEY (job_id, revision, record_kind, staged_id),
        FOREIGN KEY (job_id, revision) REFERENCES smc_overlay_revisions(job_id, revision),
        CHECK (
          (operation = 'upsert' AND payload_json IS NOT NULL AND payload_digest IS NOT NULL)
          OR (operation = 'discard' AND payload_json IS NULL AND payload_digest IS NULL)
        ),
        CHECK (payload_digest IS NULL OR length(payload_digest) = 71)
      );
      CREATE INDEX smc_overlay_records_reconstruct
        ON smc_overlay_records(job_id, record_kind, staged_id, revision DESC);

      CREATE TABLE smc_overlay_search_indexes (
        job_id                   TEXT NOT NULL,
        revision                 INTEGER NOT NULL,
        record_kind              TEXT NOT NULL DEFAULT 'memory' CHECK (record_kind = 'memory'),
        staged_id                TEXT NOT NULL,
        schema_version           INTEGER NOT NULL CHECK (schema_version = 1),
        normalized_text          TEXT NOT NULL,
        normalized_text_hash     TEXT NOT NULL CHECK (length(normalized_text_hash) = 64),
        embedding_contract_id    TEXT NOT NULL,
        embedding_provider       TEXT NOT NULL,
        embedding_model          TEXT NOT NULL,
        embedding_dimensions     INTEGER NOT NULL CHECK (embedding_dimensions > 0),
        embedding_purpose        TEXT NOT NULL CHECK (embedding_purpose = 'retrieval_document'),
        embedding_format_version INTEGER NOT NULL CHECK (embedding_format_version > 0),
        vector_bytes             BLOB NOT NULL CHECK (length(vector_bytes) = embedding_dimensions * 4),
        vector_digest            TEXT NOT NULL CHECK (length(vector_digest) = 71),
        index_digest             TEXT NOT NULL CHECK (length(index_digest) = 71),
        created_at               TEXT NOT NULL,
        PRIMARY KEY (job_id, revision, staged_id),
        FOREIGN KEY (job_id, revision, record_kind, staged_id)
          REFERENCES smc_overlay_records(job_id, revision, record_kind, staged_id)
      );
      CREATE INDEX smc_overlay_search_indexes_reconstruct
        ON smc_overlay_search_indexes(job_id, staged_id, revision DESC);

      CREATE TABLE smc_curator_batch_channel_plans (
        job_id                  TEXT NOT NULL REFERENCES smc_manifests(job_id),
        work_batch_id           TEXT NOT NULL,
        plan_revision           INTEGER NOT NULL CHECK (plan_revision > 0),
        parent_plan_digest      TEXT CHECK (parent_plan_digest IS NULL OR length(parent_plan_digest) = 71),
        manifest_digest         TEXT NOT NULL CHECK (length(manifest_digest) = 71),
        snapshot_token          TEXT NOT NULL CHECK (length(snapshot_token) = 71),
        overlay_revision        INTEGER NOT NULL CHECK (overlay_revision >= 0),
        overlay_digest          TEXT NOT NULL CHECK (length(overlay_digest) = 71),
        work_batch_digest       TEXT NOT NULL CHECK (length(work_batch_digest) = 71),
        affected_work_set_digest TEXT NOT NULL CHECK (length(affected_work_set_digest) = 71),
        normalization_identity  TEXT NOT NULL CHECK (length(normalization_identity) = 71),
        plan_json               TEXT NOT NULL,
        plan_digest             TEXT NOT NULL CHECK (length(plan_digest) = 71),
        created_at              TEXT NOT NULL,
        PRIMARY KEY (job_id, work_batch_id, plan_revision),
        UNIQUE (job_id, work_batch_id, plan_digest),
        FOREIGN KEY (job_id, work_batch_id)
          REFERENCES smc_work_batches(job_id, batch_id),
        CHECK (
          (plan_revision = 1 AND parent_plan_digest IS NULL)
          OR (plan_revision > 1 AND parent_plan_digest IS NOT NULL)
        )
      );
      CREATE INDEX smc_curator_batch_channel_plans_latest
        ON smc_curator_batch_channel_plans(job_id, work_batch_id, plan_revision DESC);

      CREATE TABLE smc_curator_fetch_receipts (
        job_id          TEXT NOT NULL REFERENCES smc_manifests(job_id),
        work_batch_id   TEXT NOT NULL,
        action_key      TEXT NOT NULL CHECK (
          length(action_key) = 79
          AND substr(action_key, 1, 15) = 'curator_action_'
        ),
        request_json    TEXT NOT NULL,
        request_digest  TEXT NOT NULL CHECK (length(request_digest) = 71 AND substr(request_digest, 1, 7) = 'sha256:'),
        result_json     TEXT NOT NULL,
        result_digest   TEXT NOT NULL CHECK (length(result_digest) = 71 AND substr(result_digest, 1, 7) = 'sha256:'),
        result_bytes    INTEGER NOT NULL CHECK (result_bytes > 0 AND result_bytes <= 9007199254740991),
        manifest_digest TEXT NOT NULL CHECK (length(manifest_digest) = 71 AND substr(manifest_digest, 1, 7) = 'sha256:'),
        created_at      TEXT NOT NULL,
        PRIMARY KEY (job_id, action_key),
        UNIQUE (action_key),
        FOREIGN KEY (job_id, work_batch_id)
          REFERENCES smc_work_batches(job_id, batch_id)
      );
      CREATE INDEX smc_curator_fetch_receipts_job
        ON smc_curator_fetch_receipts(job_id, work_batch_id, created_at, action_key);
      CREATE TRIGGER smc_curator_fetch_receipts_immutable_update
      BEFORE UPDATE ON smc_curator_fetch_receipts
      BEGIN
        SELECT RAISE(ABORT, 'smc_curator_fetch_receipt_immutable');
      END;

      CREATE TABLE smc_curator_action_charges (
        job_id          TEXT NOT NULL REFERENCES smc_manifests(job_id),
        action_key      TEXT NOT NULL CHECK (
          length(action_key) = 79
          AND substr(action_key, 1, 15) = 'curator_action_'
        ),
        action_kind     TEXT NOT NULL CHECK (action_kind IN ('query', 'fetch_record')),
        request_digest  TEXT NOT NULL CHECK (length(request_digest) = 71 AND substr(request_digest, 1, 7) = 'sha256:'),
        result_digest   TEXT NOT NULL CHECK (length(result_digest) = 71 AND substr(result_digest, 1, 7) = 'sha256:'),
        query_count     INTEGER NOT NULL CHECK (
          (action_kind = 'query' AND query_count IN (0, 1))
          OR (action_kind = 'fetch_record' AND query_count = 0)
        ),
        result_bytes    INTEGER NOT NULL CHECK (result_bytes > 0 AND result_bytes <= 9007199254740991),
        manifest_digest TEXT NOT NULL CHECK (length(manifest_digest) = 71 AND substr(manifest_digest, 1, 7) = 'sha256:'),
        created_at      TEXT NOT NULL,
        PRIMARY KEY (job_id, action_key),
        UNIQUE (action_key)
      );
      CREATE INDEX smc_curator_action_charges_job
        ON smc_curator_action_charges(job_id, action_kind, created_at, action_key);
      CREATE TRIGGER smc_curator_action_charges_immutable_update
      BEFORE UPDATE ON smc_curator_action_charges
      BEGIN
        SELECT RAISE(ABORT, 'smc_curator_action_charge_immutable');
      END;

      CREATE TABLE smc_action_journal (
        job_id                    TEXT NOT NULL REFERENCES smc_manifests(job_id),
        work_batch_id             TEXT NOT NULL,
        attempt_id                TEXT NOT NULL,
        sequence                  INTEGER NOT NULL CHECK (sequence >= 0),
        owner_epoch               INTEGER NOT NULL CHECK (owner_epoch > 0),
        protocol_version          TEXT NOT NULL,
        manifest_digest           TEXT NOT NULL CHECK (length(manifest_digest) = 71),
        snapshot_token            TEXT NOT NULL CHECK (length(snapshot_token) = 71),
        expected_overlay_revision INTEGER NOT NULL CHECK (expected_overlay_revision >= 0),
        action_kind               TEXT NOT NULL CHECK (
          action_kind IN ('query', 'fetch_record', 'submit_proposal', 'blocker')
        ),
        request_json              TEXT NOT NULL,
        request_digest            TEXT NOT NULL CHECK (length(request_digest) = 71),
        result_json               TEXT NOT NULL,
        result_digest             TEXT NOT NULL CHECK (length(result_digest) = 71),
        created_at                TEXT NOT NULL,
        PRIMARY KEY (job_id, work_batch_id, attempt_id, sequence),
        FOREIGN KEY (job_id, attempt_id)
          REFERENCES session_memory_anchor_attempts(job_id, id),
        FOREIGN KEY (job_id, work_batch_id)
          REFERENCES smc_work_batches(job_id, batch_id)
      );
      CREATE INDEX smc_action_journal_replay
        ON smc_action_journal(job_id, attempt_id, sequence);

      CREATE TABLE smc_coverage_receipts (
        id               TEXT PRIMARY KEY,
        job_id           TEXT NOT NULL REFERENCES smc_manifests(job_id),
        work_batch_id    TEXT NOT NULL,
        attempt_id       TEXT NOT NULL,
        owner_epoch      INTEGER NOT NULL CHECK (owner_epoch > 0),
        receipt_kind     TEXT NOT NULL CHECK (receipt_kind IN ('query', 'work_set')),
        channel          TEXT,
        manifest_digest  TEXT NOT NULL CHECK (length(manifest_digest) = 71),
        snapshot_token   TEXT NOT NULL CHECK (length(snapshot_token) = 71),
        overlay_revision INTEGER NOT NULL CHECK (overlay_revision >= 0),
        complete         INTEGER NOT NULL CHECK (complete IN (0, 1)),
        truncated        INTEGER NOT NULL CHECK (truncated IN (0, 1)),
        payload_json     TEXT NOT NULL,
        receipt_digest   TEXT NOT NULL CHECK (length(receipt_digest) = 71),
        created_at       TEXT NOT NULL,
        UNIQUE (job_id, receipt_digest),
        FOREIGN KEY (job_id, attempt_id)
          REFERENCES session_memory_anchor_attempts(job_id, id),
        FOREIGN KEY (job_id, work_batch_id)
          REFERENCES smc_work_batches(job_id, batch_id)
      );
      CREATE INDEX smc_coverage_receipts_batch
        ON smc_coverage_receipts(job_id, work_batch_id, receipt_kind, channel, created_at);

      CREATE TABLE smc_budget_grants (
        id               TEXT PRIMARY KEY,
        job_id           TEXT NOT NULL REFERENCES smc_manifests(job_id),
        owner_epoch      INTEGER NOT NULL CHECK (owner_epoch > 0),
        budget_name      TEXT NOT NULL,
        additive_amount  INTEGER NOT NULL CHECK (additive_amount > 0),
        operator_id      TEXT NOT NULL,
        reason           TEXT NOT NULL,
        manifest_digest  TEXT NOT NULL CHECK (length(manifest_digest) = 71),
        request_digest   TEXT NOT NULL CHECK (length(request_digest) = 71),
        grant_digest     TEXT NOT NULL CHECK (length(grant_digest) = 71),
        created_at       TEXT NOT NULL,
        UNIQUE (job_id, grant_digest)
      );
      CREATE INDEX smc_budget_grants_job_created
        ON smc_budget_grants(job_id, created_at, id);

      CREATE TABLE smc_terminal_receipts (
        job_id                TEXT PRIMARY KEY REFERENCES session_memory_anchor_jobs(job_id),
        id                    TEXT NOT NULL UNIQUE,
        schema_version        INTEGER NOT NULL CHECK (schema_version = 1),
        receipt_kind          TEXT NOT NULL CHECK (receipt_kind IN ('finalization', 'abandonment')),
        terminal_basis_kind   TEXT NOT NULL CHECK (
          terminal_basis_kind IN ('smc_manifest', 'legacy_quarantine')
        ),
        terminal_basis_digest TEXT NOT NULL CHECK (length(terminal_basis_digest) = 71),
        target_owner_epoch    INTEGER NOT NULL CHECK (target_owner_epoch > 0),
        result_json           TEXT NOT NULL,
        result_digest         TEXT NOT NULL CHECK (length(result_digest) = 71),
        receipt_digest        TEXT NOT NULL UNIQUE CHECK (length(receipt_digest) = 71),
        created_at            TEXT NOT NULL,
        CHECK (receipt_kind = 'abandonment' OR terminal_basis_kind = 'smc_manifest')
      );
      CREATE INDEX smc_terminal_receipts_created
        ON smc_terminal_receipts(created_at, job_id);
    `,
    apply: applyMigration21,
  },
  {
    version: 22,
    sql: `
      CREATE TABLE session_memory_audit_receipts (
        id                         TEXT PRIMARY KEY,
        project_key                TEXT NOT NULL,
        memory_id                  TEXT NOT NULL REFERENCES session_memories(id),
        reviewed_revision          INTEGER NOT NULL CHECK (reviewed_revision > 0),
        reviewed_state_digest      TEXT NOT NULL CHECK (
          length(reviewed_state_digest) = 71 AND substr(reviewed_state_digest, 1, 7) = 'sha256:'
        ),
        job_id                     TEXT NOT NULL REFERENCES session_memory_anchor_jobs(job_id),
        work_batch_id              TEXT NOT NULL,
        manifest_digest            TEXT NOT NULL CHECK (length(manifest_digest) = 71),
        accepted_projection_digest TEXT NOT NULL CHECK (
          length(accepted_projection_digest) = 71
          AND substr(accepted_projection_digest, 1, 7) = 'sha256:'
        ),
        policy_version             TEXT NOT NULL,
        policy_digest              TEXT NOT NULL CHECK (length(policy_digest) = 71),
        output_contract_version    TEXT NOT NULL,
        output_contract_digest     TEXT NOT NULL CHECK (length(output_contract_digest) = 71),
        tool_protocol_version      TEXT NOT NULL,
        tool_protocol_digest       TEXT NOT NULL CHECK (length(tool_protocol_digest) = 71),
        embedding_contract_id      TEXT NOT NULL REFERENCES embedding_contracts(id),
        disposition                TEXT NOT NULL CHECK (disposition IN ('keep', 'supersede', 'retract')),
        resulting_status           TEXT NOT NULL CHECK (resulting_status IN ('active', 'superseded', 'retracted')),
        resulting_revision         INTEGER NOT NULL CHECK (resulting_revision > 0),
        resulting_state_digest     TEXT NOT NULL CHECK (length(resulting_state_digest) = 71),
        receipt_digest             TEXT NOT NULL UNIQUE CHECK (length(receipt_digest) = 71),
        created_at                 TEXT NOT NULL,
        UNIQUE (
          memory_id, reviewed_revision, reviewed_state_digest,
          policy_version, policy_digest,
          output_contract_version, output_contract_digest,
          tool_protocol_version, tool_protocol_digest,
          embedding_contract_id
        )
      );
      CREATE INDEX session_memory_audit_receipts_current_coverage
        ON session_memory_audit_receipts (
          project_key, memory_id, resulting_revision, resulting_state_digest, resulting_status,
          policy_digest, output_contract_digest, tool_protocol_digest,
          embedding_contract_id
        );
      CREATE INDEX session_memory_audit_receipts_job
        ON session_memory_audit_receipts(job_id, created_at, id);
      CREATE TRIGGER session_memory_audit_receipts_immutable_update
      BEFORE UPDATE ON session_memory_audit_receipts
      BEGIN
        SELECT RAISE(ABORT, 'session_memory_audit_receipt_immutable');
      END;
      CREATE TRIGGER session_memory_audit_receipts_immutable_delete
      BEFORE DELETE ON session_memory_audit_receipts
      BEGIN
        SELECT RAISE(ABORT, 'session_memory_audit_receipt_immutable');
      END;
    `,
  },
  {
    version: 23,
    disableForeignKeys: true,
    apply: applyMigration23,
  },
  {
    version: 24,
    disableForeignKeys: true,
    apply: applyMigration24,
  },
];

export const LATEST_MEMORY_SCHEMA_VERSION = MIGRATIONS.at(-1)?.version ?? 0;

export class MemorySchemaCompatibilityError extends Error {
  readonly code = "installed_runtime_incompatible";

  constructor(
    readonly databaseVersion: number,
    readonly runtimeVersion: number,
  ) {
    super(
      `installed_runtime_incompatible: memory database schema ${databaseVersion} is newer than runtime schema ${runtimeVersion}`,
    );
    this.name = "MemorySchemaCompatibilityError";
  }
}

function applyMigration19(db: Database): void {
  if (tableExists(db, "session_memory_write_admissions")) {
    const hasTargetColumn = db.query("PRAGMA table_info(session_memory_write_admissions)").all()
      .some((row) => (row as { name: string }).name === "target_id");
    if (!hasTargetColumn) {
      db.exec(`ALTER TABLE session_memory_write_admissions
        ADD COLUMN target_id TEXT CHECK (target_id IS NULL OR length(target_id) > 0);`);
    }
    db.exec(`
      CREATE TRIGGER smwf_migrate_legacy_anchor_exact_target
      BEFORE UPDATE ON ingest_jobs
      WHEN EXISTS (
        SELECT 1 FROM session_memory_write_admissions a
        WHERE a.operation = 'migrate_legacy_anchor' AND a.project_or_scope = NEW.project_key
      )
        AND NOT EXISTS (
          SELECT 1 FROM session_memory_write_admissions a
          WHERE a.operation = 'migrate_legacy_anchor'
            AND a.project_or_scope = NEW.project_key
            AND a.target_id = NEW.id
        )
      BEGIN
        SELECT RAISE(ABORT, 'session_memory_legacy_write_denied:target_mismatch');
      END;
    `);
  }
  installProjectAuthorityAdmissionValidation(db);
}

function applyMigration21(db: Database, now: Date): void {
  if (tableExists(db, "experience_event_tombstones")) {
    db.exec(`
      DROP INDEX experience_event_tombstones_original_event;
      DROP INDEX experience_event_tombstones_dedupe_key;
      CREATE UNIQUE INDEX experience_event_tombstones_original_event
        ON experience_event_tombstones(original_event_id)
        WHERE state = 'claimed';
      CREATE UNIQUE INDEX experience_event_tombstones_dedupe_key
        ON experience_event_tombstones(dedupe_key)
        WHERE state = 'claimed' AND dedupe_key IS NOT NULL;
    `);
  }
  const rows = db.query("SELECT job_id FROM smc_manifests ORDER BY job_id").all() as Array<{ job_id: string }>;
  const insert = db.query(
    `INSERT INTO smc_overlay_state (job_id, current_revision, current_digest, updated_at)
     VALUES (?, 0, ?, ?)`,
  );
  for (const row of rows) {
    insert.run(row.job_id, initialSMCOverlayDigest(row.job_id), now.toISOString());
  }
  installProjectAuthorityAdmissionValidation(db);
}

function applyMigration23(db: Database): void {
  if (!tableExists(db, "smc_curator_action_charges")) return;
  db.exec(`
    DROP TRIGGER IF EXISTS smc_curator_action_charges_immutable_update;
    DROP INDEX IF EXISTS smc_curator_action_charges_job;
    ALTER TABLE smc_curator_action_charges RENAME TO smc_curator_action_charges_v22;
    CREATE TABLE smc_curator_action_charges (
      job_id          TEXT NOT NULL REFERENCES smc_manifests(job_id),
      action_key      TEXT NOT NULL CHECK (
        length(action_key) = 79 AND substr(action_key, 1, 15) = 'curator_action_'
      ),
      action_kind     TEXT NOT NULL CHECK (action_kind IN ('query', 'fetch_record')),
      request_digest  TEXT NOT NULL CHECK (length(request_digest) = 71 AND substr(request_digest, 1, 7) = 'sha256:'),
      result_digest   TEXT NOT NULL CHECK (length(result_digest) = 71 AND substr(result_digest, 1, 7) = 'sha256:'),
      query_count     INTEGER NOT NULL CHECK (
        (action_kind = 'query' AND query_count IN (0, 1))
        OR (action_kind = 'fetch_record' AND query_count = 0)
      ),
      result_bytes    INTEGER NOT NULL CHECK (result_bytes > 0 AND result_bytes <= 9007199254740991),
      manifest_digest TEXT NOT NULL CHECK (length(manifest_digest) = 71 AND substr(manifest_digest, 1, 7) = 'sha256:'),
      created_at      TEXT NOT NULL,
      PRIMARY KEY (job_id, action_key),
      UNIQUE (action_key)
    );
    INSERT INTO smc_curator_action_charges
      (job_id, action_key, action_kind, request_digest, result_digest, query_count,
       result_bytes, manifest_digest, created_at)
    SELECT job_id, action_key, action_kind, request_digest, result_digest, query_count,
           result_bytes, manifest_digest, created_at
    FROM smc_curator_action_charges_v22;
    DROP TABLE smc_curator_action_charges_v22;
    CREATE INDEX smc_curator_action_charges_job
      ON smc_curator_action_charges(job_id, action_kind, created_at, action_key);
    CREATE TRIGGER smc_curator_action_charges_immutable_update
    BEFORE UPDATE ON smc_curator_action_charges
    BEGIN
      SELECT RAISE(ABORT, 'smc_curator_action_charge_immutable');
    END;
  `);
}

function applyMigration24(db: Database): void {
  if (!tableExists(db, "smc_curator_action_charges")) return;
  db.exec(`
    DROP TRIGGER IF EXISTS smc_curator_action_charges_immutable_update;
    DROP INDEX IF EXISTS smc_curator_action_charges_job;
    ALTER TABLE smc_curator_action_charges RENAME TO smc_curator_action_charges_v23;
    CREATE TABLE smc_curator_action_charges (
      job_id          TEXT NOT NULL REFERENCES smc_manifests(job_id),
      action_key      TEXT NOT NULL CHECK (
        length(action_key) = 79 AND substr(action_key, 1, 15) = 'curator_action_'
      ),
      action_kind     TEXT NOT NULL CHECK (action_kind IN ('query', 'fetch_record')),
      request_digest  TEXT NOT NULL CHECK (length(request_digest) = 71 AND substr(request_digest, 1, 7) = 'sha256:'),
      result_digest   TEXT NOT NULL CHECK (length(result_digest) = 71 AND substr(result_digest, 1, 7) = 'sha256:'),
      query_count     INTEGER NOT NULL CHECK (
        (action_kind = 'query' AND query_count IN (0, 1))
        OR (action_kind = 'fetch_record' AND query_count = 0)
      ),
      result_bytes    INTEGER NOT NULL CHECK (
        (action_kind = 'query' AND result_bytes = 0)
        OR (action_kind = 'fetch_record' AND result_bytes BETWEEN 1 AND 9007199254740991)
      ),
      manifest_digest TEXT NOT NULL CHECK (length(manifest_digest) = 71 AND substr(manifest_digest, 1, 7) = 'sha256:'),
      created_at      TEXT NOT NULL,
      PRIMARY KEY (job_id, action_key),
      UNIQUE (action_key)
    );
    INSERT INTO smc_curator_action_charges
      (job_id, action_key, action_kind, request_digest, result_digest, query_count,
       result_bytes, manifest_digest, created_at)
    SELECT job_id, action_key, action_kind, request_digest, result_digest, query_count,
           CASE WHEN action_kind = 'query' THEN 0 ELSE result_bytes END,
           manifest_digest, created_at
    FROM smc_curator_action_charges_v23;
    DROP TABLE smc_curator_action_charges_v23;
    CREATE INDEX smc_curator_action_charges_job
      ON smc_curator_action_charges(job_id, action_kind, created_at, action_key);
    CREATE TRIGGER smc_curator_action_charges_immutable_update
    BEFORE UPDATE ON smc_curator_action_charges
    BEGIN
      SELECT RAISE(ABORT, 'smc_curator_action_charge_immutable');
    END;
  `);
}

export type MigrationFailureInjection = {
  beforeMigration?: (version: number) => void;
  afterMigrationApply?: (version: number) => void;
};

export function runMigrations(
  db: Database,
  now: Date = new Date(),
  failureInjection: MigrationFailureInjection = {},
): void {
  db.exec("CREATE TABLE IF NOT EXISTS schema_migrations (version INTEGER PRIMARY KEY, applied_at TEXT NOT NULL);");
  const row = db.query("SELECT MAX(version) AS v FROM schema_migrations").get() as { v: number | null };
  const current = row?.v ?? 0;
  if (current > LATEST_MEMORY_SCHEMA_VERSION) {
    throw new MemorySchemaCompatibilityError(current, LATEST_MEMORY_SCHEMA_VERSION);
  }

  for (const migration of MIGRATIONS) {
    if (migration.version <= current) continue;
    failureInjection.beforeMigration?.(migration.version);
    if (migration.disableForeignKeys) db.exec("PRAGMA foreign_keys = OFF;");
    try {
      const apply = db.transaction(() => {
        if (migration.sql) db.exec(migration.sql);
        if (migration.apply) migration.apply(db, now);
        failureInjection.afterMigrationApply?.(migration.version);
        db.query("INSERT INTO schema_migrations (version, applied_at) VALUES (?, ?)").run(
          migration.version,
          now.toISOString(),
        );
      });
      apply(); // throws on failure → transaction rolls back, version stays unrecorded → re-open resumes
    } finally {
      if (migration.disableForeignKeys) db.exec("PRAGMA foreign_keys = ON;");
    }
  }
}

type TableColumn = { name: string };

type LegacyExperienceEventTombstone = {
  id: string;
  original_event_id: string;
  dedupe_key: string | null;
  project_key: string;
  processed_at: string;
  terminal_decision: string | null;
  output_references_json: string | null;
};

function migrateExperienceEventTombstonesToClaimFinalizeSchema(db: Database): void {
  const columns = db.query("PRAGMA table_info(experience_event_tombstones)").all() as TableColumn[];
  const columnNames = new Set(columns.map((column) => column.name));

  if (columnNames.has("ingest_job_id")) return;
  if (!columnNames.has("processed_at")) return;

  const legacyRows = db.query("SELECT * FROM experience_event_tombstones ORDER BY processed_at, id").all() as
    LegacyExperienceEventTombstone[];

  db.exec(`
    CREATE TABLE experience_event_tombstones_new (
      id                    TEXT PRIMARY KEY,
      original_event_id      TEXT NOT NULL,
      dedupe_key             TEXT,
      project_key            TEXT NOT NULL,
      ingest_job_id          TEXT,
      provider               TEXT,
      provider_session_id    TEXT,
      claimed_at             TEXT NOT NULL,
      finalized_at           TEXT,
      state                  TEXT NOT NULL CHECK (state IN ('claimed', 'output', 'no_output', 'failed', 'unfinished')),
      terminal_decision      TEXT,
      source_metadata_json   TEXT NOT NULL,
      retained_evidence_json TEXT NOT NULL,
      output_references_json TEXT NOT NULL
    );
  `);

  const insert = db.query(
    `INSERT INTO experience_event_tombstones_new
      (id, original_event_id, dedupe_key, project_key, ingest_job_id, provider, provider_session_id,
       claimed_at, finalized_at, state, terminal_decision, source_metadata_json, retained_evidence_json,
       output_references_json)
     VALUES (?, ?, ?, ?, ?, NULL, NULL, ?, ?, 'output', ?, ?, ?, ?)`,
  );

  for (const row of legacyRows) {
    insert.run(
      row.id,
      row.original_event_id,
      row.dedupe_key,
      row.project_key,
      "legacy-terminal",
      row.processed_at,
      row.processed_at,
      row.terminal_decision,
      JSON.stringify({
        original_event_id: row.original_event_id,
        project_key: row.project_key,
        migrated_from: "terminal_tombstone",
      }),
      JSON.stringify({}),
      row.output_references_json ?? JSON.stringify([]),
    );
  }

  db.exec(`
    DROP TABLE experience_event_tombstones;
    ALTER TABLE experience_event_tombstones_new RENAME TO experience_event_tombstones;
    CREATE INDEX experience_event_tombstones_project_time ON experience_event_tombstones(project_key, claimed_at);
    CREATE UNIQUE INDEX experience_event_tombstones_original_event ON experience_event_tombstones(original_event_id);
    CREATE UNIQUE INDEX experience_event_tombstones_dedupe_key ON experience_event_tombstones(dedupe_key) WHERE dedupe_key IS NOT NULL;
  `);
}

function migrateSessionMemoryEmbeddings(db: Database, now: Date): void {
  db.exec(`
    CREATE TABLE session_memory_embeddings (
      id                    TEXT PRIMARY KEY,
      session_memory_id     TEXT NOT NULL REFERENCES session_memories(id),
      project_key           TEXT NOT NULL,
      embedding_provider    TEXT NOT NULL,
      embedding_model       TEXT NOT NULL,
      embedding_dimensions  INTEGER NOT NULL,
      embedding_purpose     TEXT NOT NULL CHECK (embedding_purpose IN ('retrieval_document', 'retrieval_query')),
      format_version        INTEGER NOT NULL,
      normalized_text_hash  TEXT,
      status                TEXT NOT NULL CHECK (status IN ('pending', 'indexed', 'failed')),
      failure_reason        TEXT,
      retry_count           INTEGER NOT NULL DEFAULT 0,
      created_at            TEXT NOT NULL,
      updated_at            TEXT NOT NULL,
      indexed_at            TEXT,
      UNIQUE (
        session_memory_id,
        embedding_provider,
        embedding_model,
        embedding_dimensions,
        embedding_purpose,
        format_version
      )
    );
    CREATE INDEX session_memory_embeddings_project_status
      ON session_memory_embeddings(project_key, status, updated_at);
    CREATE INDEX session_memory_embeddings_memory
      ON session_memory_embeddings(session_memory_id);
  `);

  const tables = db
    .query("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'session_memories'")
    .all() as Array<{ name: string }>;
  if (tables.length === 0) return;

  const contract = DEFAULT_SESSION_MEMORY_EMBEDDING_CONTRACT;
  const timestamp = now.toISOString();
  const rows = db.query("SELECT id, project_key FROM session_memories ORDER BY created_at, id").all() as Array<{
    id: string;
    project_key: string;
  }>;
  const insert = db.query(
    `INSERT OR IGNORE INTO session_memory_embeddings
      (id, session_memory_id, project_key, embedding_provider, embedding_model, embedding_dimensions,
       embedding_purpose, format_version, status, retry_count, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'pending', 0, ?, ?)`,
  );

  for (const row of rows) {
    insert.run(
      sessionMemoryEmbeddingId({
        session_memory_id: row.id,
        contract,
      }),
      row.id,
      row.project_key,
      contract.provider,
      contract.model,
      contract.dimensions,
      contract.purpose,
      contract.formatVersion,
      timestamp,
      timestamp,
    );
  }
}

function migrateBranchAwareSessionMemoryContext(db: Database): void {
  if (tableExists(db, "experience_events")) {
    const experienceColumns = tableColumns(db, "experience_events");
    if (!experienceColumns.has("repo_path")) db.exec("ALTER TABLE experience_events ADD COLUMN repo_path TEXT;");
    if (!experienceColumns.has("git_branch")) db.exec("ALTER TABLE experience_events ADD COLUMN git_branch TEXT;");
    if (!experienceColumns.has("git_commit")) db.exec("ALTER TABLE experience_events ADD COLUMN git_commit TEXT;");
    if (!experienceColumns.has("git_worktree_id")) db.exec("ALTER TABLE experience_events ADD COLUMN git_worktree_id TEXT;");
    db.exec(`
      CREATE INDEX IF NOT EXISTS experience_events_project_branch_time
        ON experience_events(project_key, git_branch, occurred_at);
    `);
  }

  db.exec(`
    CREATE TABLE IF NOT EXISTS session_memory_contexts (
      id                INTEGER PRIMARY KEY AUTOINCREMENT,
      session_memory_id TEXT NOT NULL REFERENCES session_memories(id),
      project_key       TEXT NOT NULL,
      repo_path         TEXT,
      git_branch        TEXT,
      git_commit        TEXT,
      git_worktree_id   TEXT,
      source_event_ref  TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS session_memory_contexts_project_branch
      ON session_memory_contexts(project_key, git_branch, session_memory_id);
    CREATE INDEX IF NOT EXISTS session_memory_contexts_memory
      ON session_memory_contexts(session_memory_id);
  `);
}

function migrateSessionMemoryLifecycle(db: Database): void {
  if (tableExists(db, "session_memories")) {
    const columns = tableColumns(db, "session_memories");
    if (!columns.has("status")) {
      db.exec("ALTER TABLE session_memories ADD COLUMN status TEXT NOT NULL DEFAULT 'active';");
    }
    if (!columns.has("superseded_by")) db.exec("ALTER TABLE session_memories ADD COLUMN superseded_by TEXT;");
    if (!columns.has("lifecycle_reason")) db.exec("ALTER TABLE session_memories ADD COLUMN lifecycle_reason TEXT;");
    if (!columns.has("superseded_at")) db.exec("ALTER TABLE session_memories ADD COLUMN superseded_at TEXT;");
    if (!columns.has("retracted_at")) db.exec("ALTER TABLE session_memories ADD COLUMN retracted_at TEXT;");
    db.exec(`
      CREATE INDEX IF NOT EXISTS session_memories_project_status_created
        ON session_memories(project_key, status, created_at);
    `);
  }

  db.exec(`
    CREATE TABLE IF NOT EXISTS session_memory_links (
      id                     INTEGER PRIMARY KEY AUTOINCREMENT,
      source_memory_id       TEXT NOT NULL REFERENCES session_memories(id),
      target_memory_id       TEXT NOT NULL REFERENCES session_memories(id),
      project_key            TEXT NOT NULL,
      relationship           TEXT NOT NULL CHECK (relationship IN ('supersedes', 'refines', 'contradicts', 'duplicates')),
      reason                 TEXT NOT NULL,
      source_event_refs_json TEXT NOT NULL,
      created_at             TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS session_memory_links_project_source
      ON session_memory_links(project_key, source_memory_id, relationship);
    CREATE INDEX IF NOT EXISTS session_memory_links_project_target
      ON session_memory_links(project_key, target_memory_id, relationship);
  `);
}

function migrateEmbeddingContracts(db: Database, now: Date): void {
  db.exec(`
    CREATE TABLE embedding_contracts (
      id                   TEXT PRIMARY KEY,
      scope                TEXT NOT NULL CHECK (scope IN ('session_memory', 'project_memory')),
      embedding_provider   TEXT NOT NULL CHECK (embedding_provider IN ('ollama_nomic', 'ollama_qwen', 'gemini')),
      embedding_model      TEXT NOT NULL,
      embedding_dimensions INTEGER NOT NULL,
      format_version       INTEGER NOT NULL,
      lifecycle            TEXT NOT NULL CHECK (lifecycle IN ('active', 'previous', 'staging', 'retired', 'failed')),
      vector_table         TEXT NOT NULL,
      created_at           TEXT NOT NULL,
      updated_at           TEXT NOT NULL,
      activated_at         TEXT,
      retired_at           TEXT,
      failure_reason       TEXT,
      UNIQUE (scope, embedding_provider, embedding_model, embedding_dimensions, format_version)
    );
    CREATE UNIQUE INDEX embedding_contracts_active_scope
      ON embedding_contracts(scope) WHERE lifecycle = 'active';
    CREATE UNIQUE INDEX embedding_contracts_previous_scope
      ON embedding_contracts(scope) WHERE lifecycle = 'previous';
    CREATE INDEX embedding_contracts_scope_lifecycle
      ON embedding_contracts(scope, lifecycle, updated_at);
  `);

  seedActiveContract(db, {
    scope: "session_memory",
    metadataTable: "session_memory_embeddings",
    vectorTable: "session_memory_vec",
    now: now.toISOString(),
  });
  seedActiveContract(db, {
    scope: "project_memory",
    metadataTable: "project_memory_retrieval_embeddings",
    vectorTable: "project_memory_section_vec",
    now: now.toISOString(),
  });
}

type LegacySessionMemoryRow = {
  id: string;
  project_key: string;
  provider: string | null;
  provider_session_id: string | null;
  ingest_job_id: string | null;
  source_event_refs_json: string;
  memory_kind: string;
  title: string | null;
  summary: string;
  payload_json: string;
  confidence: string;
  risk: string;
  status: string;
  superseded_by: string | null;
  lifecycle_reason: string | null;
  superseded_at: string | null;
  retracted_at: string | null;
  created_at: string;
  updated_at: string;
};

function migrateSessionMemoryRevisionIdentity(db: Database): void {
  if (!tableExists(db, "session_memories")) return;
  const columns = tableColumns(db, "session_memories");
  if (columns.has("revision") || columns.has("state_digest")) {
    throw new Error("Session Memory revision identity migration found an incomplete pre-existing schema");
  }

  createSessionMemoryWriteFirewallSchema(db);
  installSessionMemoryWriteFirewallGuards(db, {
    sessionMemoryTable: "session_memories",
    sessionMemoryTriggerPrefix: "smwf_legacy_session_memories",
    includeSharedTables: true,
  });

  db.exec(`
    CREATE TABLE session_memories_v16 (
      id                    TEXT PRIMARY KEY,
      project_key           TEXT NOT NULL,
      provider              TEXT,
      provider_session_id   TEXT,
      ingest_job_id         TEXT REFERENCES ingest_jobs(id),
      source_event_refs_json TEXT NOT NULL,
      memory_kind           TEXT NOT NULL CHECK (memory_kind IN ('continuity', 'decision', 'blocker', 'next_action', 'verification')),
      title                 TEXT,
      summary               TEXT NOT NULL,
      payload_json          TEXT NOT NULL,
      confidence            TEXT NOT NULL,
      risk                  TEXT NOT NULL,
      status                TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'superseded', 'retracted')),
      superseded_by         TEXT,
      lifecycle_reason      TEXT,
      superseded_at         TEXT,
      retracted_at          TEXT,
      revision              INTEGER NOT NULL CHECK (revision > 0),
      state_digest          TEXT NOT NULL CHECK (
        length(state_digest) = 71
        AND substr(state_digest, 1, 7) = 'sha256:'
        AND substr(state_digest, 8) NOT GLOB '*[^0-9a-f]*'
      ),
      created_at            TEXT NOT NULL,
      updated_at            TEXT NOT NULL
    );
  `);
  installSessionMemoryWriteFirewallGuards(db, {
    sessionMemoryTable: "session_memories_v16",
    sessionMemoryTriggerPrefix: "smwf_session_memories",
    includeSharedTables: false,
  });

  const rows = db.query(
    `SELECT id, project_key, provider, provider_session_id, ingest_job_id, source_event_refs_json,
            memory_kind, title, summary, payload_json, confidence, risk, status, superseded_by,
            lifecycle_reason, superseded_at, retracted_at, created_at, updated_at
     FROM session_memories
     ORDER BY id`,
  ).all() as LegacySessionMemoryRow[];
  const insert = db.query(
    `INSERT INTO session_memories_v16
      (id, project_key, provider, provider_session_id, ingest_job_id, source_event_refs_json,
       memory_kind, title, summary, payload_json, confidence, risk, status, superseded_by,
       lifecycle_reason, superseded_at, retracted_at, revision, state_digest, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?, ?)`,
  );
  withMigration16WriteAdmission(db, () => {
    for (const row of rows) {
      const stateDigest = sessionMemoryCanonicalStateDigest(readSessionMemoryCanonicalState(db, row.id));
      insert.run(
        row.id,
        row.project_key,
        row.provider,
        row.provider_session_id,
        row.ingest_job_id,
        row.source_event_refs_json,
        row.memory_kind,
        row.title,
        row.summary,
        row.payload_json,
        row.confidence,
        row.risk,
        row.status,
        row.superseded_by,
        row.lifecycle_reason,
        row.superseded_at,
        row.retracted_at,
        stateDigest,
        row.created_at,
        row.updated_at,
      );
    }
  });

  db.exec(`
    DROP TABLE session_memories;
    ALTER TABLE session_memories_v16 RENAME TO session_memories;
    CREATE INDEX session_memories_project_created ON session_memories(project_key, created_at);
    CREATE INDEX session_memories_project_kind_created ON session_memories(project_key, memory_kind, created_at);
    CREATE INDEX session_memories_project_status_created ON session_memories(project_key, status, created_at);
  `);
  assertSessionMemoryWriteFirewallInstalled(db);
  probeMigration16WriteFirewall(db);

  const incomplete = db.query(
    `SELECT id FROM session_memories
     WHERE revision < 1
        OR length(state_digest) != 71
        OR substr(state_digest, 1, 7) != 'sha256:'
        OR substr(state_digest, 8) GLOB '*[^0-9a-f]*'
     LIMIT 1`,
  ).get();
  if (incomplete) throw new Error("Session Memory revision identity migration produced an invalid row");

  const foreignKeyViolation = db.query("PRAGMA foreign_key_check").get();
  if (foreignKeyViolation) throw new Error("Session Memory revision identity migration failed foreign key verification");
  const integrity = db.query("PRAGMA integrity_check").get() as { integrity_check: string } | null;
  if (integrity?.integrity_check !== "ok") {
    throw new Error(`Session Memory revision identity migration failed integrity verification: ${integrity?.integrity_check ?? "unknown"}`);
  }
}

function withMigration16WriteAdmission<T>(db: Database, callback: () => T): T {
  return withMigration16ProbeAdmission(db, "migration_16", "*", callback);
}

function withMigration16ProbeAdmission<T>(
  db: Database,
  operation: string,
  projectOrScope: string,
  callback: () => T,
): T {
  if (!db.inTransaction) throw new Error("Migration 16 write admission requires an open transaction");
  const token = randomUUID();
  db.query(
    `INSERT INTO session_memory_write_admissions
      (token, operation, project_or_scope, owner_id, owner_epoch, phase, created_at)
     VALUES (?, ?, ?, 'migration:16', 1, 'migration', CURRENT_TIMESTAMP)`,
  ).run(token, operation, projectOrScope);
  try {
    return callback();
  } finally {
    const result = db.query("DELETE FROM session_memory_write_admissions WHERE token = ?").run(token);
    if (result.changes !== 1) throw new Error("Migration 16 write admission was not revoked");
  }
}

function probeMigration16WriteFirewall(db: Database): void {
  const project = "__smwf_probe_project__";
  const now = "1970-01-01T00:00:00.000Z";
  const hasFullProtectedSchema = [
    "ingest_jobs",
    "experience_events",
    "experience_event_tombstones",
    "session_memory_contexts",
    "session_memory_links",
    "embedding_contracts",
  ].every((table) => tableExists(db, table));
  if (!hasFullProtectedSchema) {
    probeMigration16CanonicalFirewall(db, project, now);
    return;
  }
  db.exec("SAVEPOINT smwf_migration_16_probe;");
  try {
    assertFirewallAllowed(() => withMigration16ProbeAdmission(db, "migration_16", project, () => {
      db.query(
        `INSERT INTO ingest_jobs
          (id, project_key, status, provider, input_json, output_counts_json, created_at, updated_at)
         VALUES ('__smwf_job__', ?, 'starting', 'codex', '{}', '{}', ?, ?)`,
      ).run(project, now, now);
      insertFirewallProbeEvent(db, "__smwf_event__", project, now);
      db.query(
        `INSERT INTO experience_event_tombstones
          (id, original_event_id, project_key, ingest_job_id, claimed_at, state,
           source_metadata_json, retained_evidence_json, output_references_json)
         VALUES ('__smwf_tomb__', '__smwf_event__', ?, '__smwf_job__', ?, 'claimed', '{}', '{}', '[]')`,
      ).run(project, now);
      insertFirewallProbeMemory(db, "__smwf_memory_a__", project, now);
      insertFirewallProbeMemory(db, "__smwf_memory_b__", project, now);
      db.query(
        `INSERT INTO session_memory_contexts
          (session_memory_id, project_key, source_event_ref)
         VALUES ('__smwf_memory_a__', ?, '__smwf_tomb__')`,
      ).run(project);
      db.query(
        `INSERT INTO session_memory_links
          (source_memory_id, target_memory_id, project_key, relationship, reason, source_event_refs_json, created_at)
         VALUES ('__smwf_memory_a__', '__smwf_memory_b__', ?, 'refines', 'probe', '[]', ?)`,
      ).run(project, now);
    }), "seed protected rows");
    assertFirewallAllowed(() => withMigration16ProbeAdmission(db, "migration_16", "session_memory", () => {
      insertFirewallProbeEmbeddingContract(db, "__smwf_contract__", "session_memory", now);
    }), "seed Session embedding contract");

    assertFirewallDenied(() => directFirewallProbeJobInsert(db, "__smwf_denied_job__", project, now), "ingest_jobs INSERT");
    assertFirewallDenied(() => db.query("UPDATE ingest_jobs SET updated_at = ? WHERE id = '__smwf_job__'").run(now), "ingest_jobs UPDATE");
    assertFirewallDenied(() => db.query("DELETE FROM ingest_jobs WHERE id = '__smwf_job__'").run(), "ingest_jobs DELETE");
    assertFirewallDenied(() => db.query(
      `INSERT INTO experience_event_tombstones
        (id, original_event_id, project_key, ingest_job_id, claimed_at, state,
         source_metadata_json, retained_evidence_json, output_references_json)
       VALUES ('__smwf_denied_tomb__', '__smwf_event__', ?, '__smwf_job__', ?, 'claimed', '{}', '{}', '[]')`,
    ).run(project, now), "experience_event_tombstones INSERT");
    assertFirewallDenied(() => db.query(
      "UPDATE experience_event_tombstones SET claimed_at = ? WHERE id = '__smwf_tomb__'",
    ).run(now), "experience_event_tombstones UPDATE");
    assertFirewallDenied(() => db.query("DELETE FROM experience_event_tombstones WHERE id = '__smwf_tomb__'").run(), "experience_event_tombstones DELETE");
    assertFirewallDenied(() => db.query("UPDATE experience_events SET raw_text = 'denied' WHERE id = '__smwf_event__'").run(), "experience_events UPDATE");
    assertFirewallDenied(() => db.query("DELETE FROM experience_events WHERE id = '__smwf_event__'").run(), "experience_events DELETE");
    assertFirewallDenied(() => insertFirewallProbeMemory(db, "__smwf_denied_memory__", project, now), "session_memories INSERT");
    assertFirewallDenied(() => db.query("UPDATE session_memories SET summary = 'denied' WHERE id = '__smwf_memory_a__'").run(), "session_memories UPDATE");
    assertFirewallDenied(() => db.query("DELETE FROM session_memories WHERE id = '__smwf_memory_b__'").run(), "session_memories DELETE");
    assertFirewallDenied(() => db.query(
      `INSERT INTO session_memory_contexts (session_memory_id, project_key, source_event_ref)
       VALUES ('__smwf_memory_a__', ?, 'denied')`,
    ).run(project), "session_memory_contexts INSERT");
    assertFirewallDenied(() => db.query("UPDATE session_memory_contexts SET source_event_ref = 'denied'").run(), "session_memory_contexts UPDATE");
    assertFirewallDenied(() => db.query("DELETE FROM session_memory_contexts").run(), "session_memory_contexts DELETE");
    assertFirewallDenied(() => db.query(
      `INSERT INTO session_memory_links
        (source_memory_id, target_memory_id, project_key, relationship, reason, source_event_refs_json, created_at)
       VALUES ('__smwf_memory_b__', '__smwf_memory_a__', ?, 'refines', 'denied', '[]', ?)`,
    ).run(project, now), "session_memory_links INSERT");
    assertFirewallDenied(() => db.query("UPDATE session_memory_links SET reason = 'denied'").run(), "session_memory_links UPDATE");
    assertFirewallDenied(() => db.query("DELETE FROM session_memory_links").run(), "session_memory_links DELETE");
    assertFirewallDenied(() => insertFirewallProbeEmbeddingContract(db, "__smwf_denied_contract__", "session_memory", now), "embedding_contracts Session INSERT");
    assertFirewallDenied(() => db.query("UPDATE embedding_contracts SET updated_at = ? WHERE id = '__smwf_contract__'").run(now), "embedding_contracts Session UPDATE");
    assertFirewallDenied(() => db.query("DELETE FROM embedding_contracts WHERE id = '__smwf_contract__'").run(), "embedding_contracts Session DELETE");

    assertFirewallAllowed(() => insertFirewallProbeEvent(db, "__smwf_capture_allowed__", project, now), "capture INSERT");
    assertFirewallAllowed(() => insertFirewallProbeEmbeddingContract(db, "__smwf_project_contract__", "project_memory", now), "Project embedding INSERT");
    assertFirewallAllowed(() => db.query("UPDATE embedding_contracts SET updated_at = ? WHERE id = '__smwf_project_contract__'").run(now), "Project embedding UPDATE");
    assertFirewallDenied(() => db.query(
      "UPDATE embedding_contracts SET scope = 'session_memory' WHERE id = '__smwf_project_contract__'",
    ).run(), "embedding_contracts NEW Session scope");
    assertFirewallDenied(() => db.query(
      "UPDATE embedding_contracts SET scope = 'project_memory' WHERE id = '__smwf_contract__'",
    ).run(), "embedding_contracts OLD Session scope");
    assertFirewallAllowed(() => db.query("DELETE FROM embedding_contracts WHERE id = '__smwf_project_contract__'").run(), "Project embedding DELETE");

    for (const operation of ["compat_job_create", "anchor_prepare"] as const) {
      assertFirewallAllowed(() => withMigration16ProbeAdmission(db, operation, project, () =>
        directFirewallProbeJobInsert(db, `__smwf_${operation}_job__`, project, now)), `ingest_jobs INSERT via ${operation}`);
    }
    for (const operation of [
      "compat_job_transition", "migrate_legacy_anchor", "anchor_resume", "anchor_finalize", "anchor_abandon",
    ] as const) {
      assertFirewallAllowed(() => withMigration16ProbeAdmission(db, operation, project, () =>
        db.query("UPDATE ingest_jobs SET updated_at = ? WHERE id = '__smwf_job__'").run(now)), `ingest_jobs UPDATE via ${operation}`);
    }
    for (const operation of ["compat_event_lease", "anchor_prepare"] as const) {
      insertFirewallProbeEvent(db, `__smwf_${operation}_event__`, project, now);
      assertFirewallAllowed(() => withMigration16ProbeAdmission(db, operation, project, () => db.query(
        `INSERT INTO experience_event_tombstones
          (id, original_event_id, project_key, ingest_job_id, claimed_at, state,
           source_metadata_json, retained_evidence_json, output_references_json)
         VALUES (?, ?, ?, '__smwf_job__', ?, 'claimed', '{}', '{}', '[]')`,
      ).run(`__smwf_${operation}_tomb__`, `__smwf_${operation}_event__`, project, now)), `tombstone INSERT via ${operation}`);
    }
    for (const operation of [
      "compat_event_lease", "migrate_legacy_anchor", "anchor_resume", "anchor_finalize", "anchor_abandon",
    ] as const) {
      assertFirewallAllowed(() => withMigration16ProbeAdmission(db, operation, project, () => db.query(
        "UPDATE experience_event_tombstones SET claimed_at = ? WHERE id = '__smwf_tomb__'",
      ).run(now)), `tombstone UPDATE via ${operation}`);
    }
    for (const operation of ["compat_event_finalize", "anchor_finalize"] as const) {
      const eventId = `__smwf_${operation}_delete_event__`;
      insertFirewallProbeEvent(db, eventId, project, now);
      assertFirewallAllowed(() => withMigration16ProbeAdmission(db, operation, project, () =>
        db.query("DELETE FROM experience_events WHERE id = ?").run(eventId)), `experience event DELETE via ${operation}`);
    }
    for (const operation of ["compat_canonical_apply", "repair_session_memory", "anchor_finalize"] as const) {
      assertFirewallAllowed(() => withMigration16ProbeAdmission(db, operation, project, () => {
        const memoryId = `__smwf_${operation}_memory__`;
        insertFirewallProbeMemory(db, memoryId, project, now);
        db.query("UPDATE session_memories SET summary = summary WHERE id = ?").run(memoryId);
        db.query(
          "INSERT INTO session_memory_contexts (session_memory_id, project_key, source_event_ref) VALUES (?, ?, 'probe')",
        ).run(memoryId, project);
        db.query("UPDATE session_memory_contexts SET source_event_ref = source_event_ref WHERE session_memory_id = ?").run(memoryId);
        db.query("DELETE FROM session_memory_contexts WHERE session_memory_id = ?").run(memoryId);
        db.query(
          `INSERT INTO session_memory_links
            (source_memory_id, target_memory_id, project_key, relationship, reason, source_event_refs_json, created_at)
           VALUES (?, '__smwf_memory_a__', ?, 'refines', 'probe', '[]', ?)`,
        ).run(memoryId, project, now);
        db.query("UPDATE session_memory_links SET reason = reason WHERE source_memory_id = ?").run(memoryId);
        db.query("DELETE FROM session_memory_links WHERE source_memory_id = ?").run(memoryId);
        db.query("DELETE FROM session_memories WHERE id = ?").run(memoryId);
      }), `canonical DML via ${operation}`);
    }
    assertFirewallAllowed(() => withMigration16ProbeAdmission(db, "register_session_embedding_contract", "session_memory", () =>
      insertFirewallProbeEmbeddingContract(db, "__smwf_register_contract__", "session_memory", now)), "Session embedding INSERT via registration");
    assertFirewallAllowed(() => withMigration16ProbeAdmission(db, "session_embedding_lifecycle", "session_memory", () => {
      insertFirewallProbeEmbeddingContract(db, "__smwf_lifecycle_contract__", "session_memory", now);
      db.query("UPDATE embedding_contracts SET updated_at = ? WHERE id = '__smwf_lifecycle_contract__'").run(now);
      db.query("DELETE FROM embedding_contracts WHERE id = '__smwf_lifecycle_contract__'").run();
    }), "Session embedding lifecycle DML");
  } finally {
    db.exec("ROLLBACK TO smwf_migration_16_probe; RELEASE smwf_migration_16_probe;");
  }
}

function probeMigration16CanonicalFirewall(db: Database, project: string, now: string): void {
  db.exec("SAVEPOINT smwf_migration_16_canonical_probe;");
  try {
    assertFirewallAllowed(() => withMigration16ProbeAdmission(db, "migration_16", project, () => {
      insertFirewallProbeMemory(db, "__smwf_partial_memory__", project, now);
    }), "partial-schema canonical seed");
    assertFirewallDenied(() => insertFirewallProbeMemory(db, "__smwf_partial_denied__", project, now), "session_memories INSERT");
    assertFirewallDenied(() => db.query(
      "UPDATE session_memories SET summary = 'denied' WHERE id = '__smwf_partial_memory__'",
    ).run(), "session_memories UPDATE");
    assertFirewallDenied(() => db.query(
      "DELETE FROM session_memories WHERE id = '__smwf_partial_memory__'",
    ).run(), "session_memories DELETE");
    for (const operation of ["compat_canonical_apply", "repair_session_memory", "anchor_finalize"] as const) {
      assertFirewallAllowed(() => withMigration16ProbeAdmission(db, operation, project, () => {
        const id = `__smwf_partial_${operation}__`;
        insertFirewallProbeMemory(db, id, project, now);
        db.query("UPDATE session_memories SET summary = summary WHERE id = ?").run(id);
        db.query("DELETE FROM session_memories WHERE id = ?").run(id);
      }), `partial-schema canonical DML via ${operation}`);
    }
  } finally {
    db.exec("ROLLBACK TO smwf_migration_16_canonical_probe; RELEASE smwf_migration_16_canonical_probe;");
  }
}

function assertFirewallAllowed(callback: () => unknown, label: string): void {
  try {
    callback();
  } catch (error) {
    throw new Error(`Migration 16 firewall probe unexpectedly denied ${label}: ${String(error)}`);
  }
}

function assertFirewallDenied(callback: () => unknown, label: string): void {
  try {
    callback();
  } catch (error) {
    if (String(error).includes(SESSION_MEMORY_WRITE_FIREWALL_DENIAL)) return;
    throw new Error(`Migration 16 firewall probe failed unexpectedly for ${label}: ${String(error)}`);
  }
  throw new Error(`Migration 16 firewall probe did not deny ${label}`);
}

function directFirewallProbeJobInsert(db: Database, id: string, project: string, now: string): void {
  db.query(
    `INSERT INTO ingest_jobs
      (id, project_key, status, provider, input_json, output_counts_json, created_at, updated_at)
     VALUES (?, ?, 'starting', 'codex', '{}', '{}', ?, ?)`,
  ).run(id, project, now, now);
}

function insertFirewallProbeEvent(db: Database, id: string, project: string, now: string): void {
  db.query(
    `INSERT INTO experience_events
      (id, project_key, occurred_at, event_kind, provider, raw_text, raw_payload_json, source, status, inserted_at)
     VALUES (?, ?, ?, 'user.prompt', 'codex', 'probe', '{}', 'migration-probe', 'valid', ?)`,
  ).run(id, project, now, now);
}

function insertFirewallProbeMemory(db: Database, id: string, project: string, now: string): void {
  db.query(
    `INSERT INTO session_memories
      (id, project_key, source_event_refs_json, memory_kind, summary, payload_json, confidence, risk,
       status, revision, state_digest, created_at, updated_at)
     VALUES (?, ?, '[]', 'continuity', 'probe', '{}', 'high', 'low', 'active', 1,
       'sha256:0000000000000000000000000000000000000000000000000000000000000000', ?, ?)`,
  ).run(id, project, now, now);
}

function insertFirewallProbeEmbeddingContract(
  db: Database,
  id: string,
  scope: EmbeddingScope,
  now: string,
): void {
  db.query(
    `INSERT INTO embedding_contracts
      (id, scope, embedding_provider, embedding_model, embedding_dimensions, format_version,
       lifecycle, vector_table, created_at, updated_at)
     VALUES (?, ?, 'ollama_nomic', ?, 768, 1, 'staging', ?, ?, ?)`,
  ).run(id, scope, id, `${id}_vec`, now, now);
}

function seedActiveContract(
  db: Database,
  input: { scope: EmbeddingScope; metadataTable: string; vectorTable: string; now: string },
): void {
  if (!tableExists(db, input.metadataTable)) return;
  const row = db.query(
    `SELECT embedding_provider, embedding_model, embedding_dimensions, format_version, count(*) AS indexed_count
     FROM ${input.metadataTable}
     WHERE status = 'indexed'
       AND embedding_purpose = 'retrieval_document'
       AND embedding_provider IN ('ollama_nomic', 'ollama_qwen', 'gemini')
     GROUP BY embedding_provider, embedding_model, embedding_dimensions, format_version
     ORDER BY indexed_count DESC, embedding_provider, embedding_model
     LIMIT 1`,
  ).get() as (Omit<EmbeddingContractIdentity, "provider" | "formatVersion" | "dimensions" | "model"> & {
    embedding_provider: EmbeddingContractIdentity["provider"];
    embedding_model: string;
    embedding_dimensions: number;
    format_version: number;
  }) | null;
  if (!row) return;
  registerInitialActiveEmbeddingContract(db, {
    scope: input.scope,
    contract: {
      provider: row.embedding_provider,
      model: row.embedding_model,
      dimensions: row.embedding_dimensions,
      formatVersion: row.format_version,
    },
    vectorTable: input.vectorTable,
    now: input.now,
  });
}

function tableExists(db: Database, table: string): boolean {
  return Boolean(db.query("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?").get(table));
}

function tableColumns(db: Database, table: string): Set<string> {
  const columns = db.query(`PRAGMA table_info(${table})`).all() as TableColumn[];
  return new Set(columns.map((column) => column.name));
}
