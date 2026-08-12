# Project Brain Bootstrap And Codex Hook Capture Design Agenda

## Status

- Spec: `spec.md`
- State: Complete
- Completion gate:
  - Live agenda questions resolved: Yes
  - Pressure test complete: Yes
  - Spec finalized: Yes

## Documented Decisions

- Start a new brainstorming session for Project Brain Bootstrap and Codex Hook Capture.
- Use `class-kit` at `/Users/liadgoren/Repositories/class-kit` as the first active project target.
- Keep `wizepal` as a later static comparison fixture.
- The first goal is input capture and preserved evidence, not curated wiki generation.
- Hooks must not call models or mutate curated memory.
- V1 compatibility should not drive the design.
- Codex capture is a provider implementation behind a provider-agnostic Myelin capture facade, not the core product boundary. ADR 0054 records this.
- Machine-level capture install, per-repo bootstrap opt-in, no-op drops for unbootstrapped repos, and fail-open hook behavior are recorded in ADR 0055.

## Questions

### Question 0: V1 codebase boundary

- Status: Answered
- Branch type: Initial
- Why it matters: Old runtime code, command names, and pipeline assumptions can distort the V2 brain design if agents treat them as current product truth.
- Scenario probe: A future agent finds old `compile`, `update`, Python MCP, or archived stage logic. Should it use that as implementation guidance for the new brain bootstrap?
- Options:
  - A. Keep V1 accessible as live reference - easier behavior lookup, but risks parity-chasing.
  - B. Archive/quarantine V1 and treat it as historical only - protects V2 design, but may require occasional git-history lookup.
  - C. Delete every V1 trace, including archived docs - cleanest surface, but discards useful provenance.
- Recommendation: B. The repo already mostly does this; preserve historical docs/provenance, but make V1 non-authoritative.
- Answer: V1 root runtime code is already removed from the current tree. `legacy/` was deleted in commit `cc5532e`, historical design docs moved under `docs/archive/`, and `mcp/.deprecated/python-mcp/` is isolated. Treat current `stages/` as provisional/reference if they carry V1 assumptions, not design authority.
- Answer impact: Confirms branch
- Spec impact: Added V1 Boundary section.
- Context impact: Not needed; existing glossary already defines V2 Breakage Budget and V2 CLI Vocabulary.
- ADR impact: Not needed; ADRs 0015, 0016, 0047 already cover the durable decision.
- Follow-ups: If later exploration finds live V1 references outside archive/deprecated paths, add a cleanup task before implementation.

### Question 1: First implemented memory/storage subset

- Status: Answered
- Branch type: Initial
- Why it matters: The product has five memory types and four storage layers, but implementing all of them at once would make the first slice too broad. We need one coherent subset that still proves the core model.
- Scenario probe: `class-kit` is onboarded and a Codex session starts. What must exist immediately so captured input is useful and not misleading?
- Options:
  - A. Project Memory shell plus raw Experience Log only - smallest useful slice; defers Session/Practice/Personal promotion.
  - B. Project Memory shell plus raw Experience Log plus Session Memory records - better continuity, but expands schema and source-of-truth decisions.
  - C. All five memory types as first-class stores - conceptually complete, but likely overbuilt and refactor-prone.
- Recommendation: A for implementation, while documenting all five memory types as target scopes. Capture raw evidence first; derive Session Memory in the next slice once event shape is proven.
- Answer: Confirm option A. The first implemented subset is a Project Memory shell plus raw Experience Log only. The five memory types remain the target model, but Session, Practice, and Personal Memory are not first-class implemented stores in this slice.
- Answer impact: Confirms branch
- Spec impact: Updated Data / State to define Project Memory shell plus raw Experience Log as the first implemented subset.
- Context impact: Not needed; this uses existing memory-type terms without renaming them.
- ADR impact: Not needed; this is scope sequencing, not a durable architecture reversal.
- Follow-ups: Later planning must define what "Project Memory shell" minimally creates for `class-kit`.

### Question 2: Hook capture scope

- Status: Answered
- Branch type: Initial
- Why it matters: Codex hooks can fire for many lifecycle and tool events. Capturing too much will create noise and privacy risk; capturing too little may not prove the input layer.
- Scenario probe: During active `class-kit` work, should Myelin capture every tool call, only user prompts, or lifecycle summaries?
- Options:
  - A. Lifecycle only: `SessionStart` and `Stop` - safest and low-volume, but may miss the actual user intent stream.
  - B. Lifecycle plus `UserPromptSubmit` - captures the session narrative and task intent, with privacy controls required.
  - C. Lifecycle, prompts, and tool-level events - richest evidence, but high-volume and higher privacy/noise risk.
- Recommendation: B. Start with lifecycle plus user prompt capture, with explicit redaction/privacy policy. Add tool events later if the event contract proves too thin.
- Answer: Modify to option C, but scoped tightly. Capture `SessionStart`, `UserPromptSubmit`, and `Stop` in the first slice. The reason is that user input often supplies context but not durable knowledge; the assistant's final answer after reading project docs/code may be the useful evidence. `Stop` capture must remain raw Experience Log evidence and should not parse unstable transcripts or capture full tool logs.
- Answer impact: Changes model
- Spec impact: Updated Codex Hook Input to include `Stop` as minimal assistant-answer evidence, while explicitly deferring tool-level events and avoiding transcript parsing.
- Context impact: Not needed; this uses existing Experience Log and memory-type terms.
- ADR impact: Not needed yet; this is first-slice capture scope and remains reversible.
- Follow-ups: Privacy policy must decide how much of `prompt` and `last_assistant_message` can be stored by default.

### Question 3: Hook location and trust model

- Status: Answered
- Branch type: Initial
- Why it matters: Project-local hooks keep capture scoped to `class-kit`, while global hooks could capture across projects but add broader privacy and routing risk.
- Scenario probe: You work in `class-kit` today and another repo tomorrow. Should Myelin capture both automatically, or only projects that explicitly opt in?
- Options:
  - A. Project-local `.codex/hooks.json` in `class-kit` - explicit opt-in and safer, but requires per-project setup/trust.
  - B. Global `~/.codex/hooks.json` with project routing - captures across projects, but increases privacy and routing complexity.
  - C. Plugin-bundled hook later - clean distribution path eventually, but premature before event shape is proven.
- Recommendation: A. Start project-local for `class-kit`, then generalize once the hook payload and routing contract are stable.
- Answer: Change to option B. Myelin is a cross-project global memory system, so the correct Codex hook location is `~/.codex/hooks.json`. Myelin should provide a provider-aware install/check command that creates or updates this file with Myelin hook entries while preserving unrelated hooks. The hooks route events to this Myelin checkout and detect the active project from `cwd`.
- Answer impact: Changes model
- Spec impact: Updated Integrations and Permissions / Security to use global hooks plus explicit install/check behavior.
- Context impact: Not needed; global-vs-project hook location is an implementation boundary, not a new product term.
- ADR impact: Created ADR 0054 for the provider-agnostic capture adapter boundary.
- Follow-ups: Add a later question for installation ownership and safe merge behavior for `~/.codex/hooks.json`.

### Question 4: Raw event storage destination

- Status: Answered
- Branch type: Dependency
- Why it matters: Experience Log is raw evidence, but raw evidence can be served from SQLite, preserved as files, or both. The storage choice affects auditability, query, performance, and future promotion.
- Scenario probe: A captured prompt later becomes evidence for Project Memory. What exact artifact should the curator cite?
- Options:
  - A. SQLite-first Experience Log, with file preservation only for larger/source-like payloads - efficient and queryable, but citations need stable event ids.
  - B. File-first under `projects/<key>/sources/` or `raw/`, with SQLite index metadata - auditable and citation-friendly, but more filesystem churn.
  - C. Dual-write every event to SQLite and file - maximum flexibility, but creates sync and duplication risk.
- Recommendation: A with explicit preserved-source escalation. Small hook events go to SQLite with stable ids; source-like payloads are preserved as files and linked.
- Answer: Choose option A. Store full raw hook payloads SQLite-first in a gitignored database. The user does not need to manually audit raw logs; later ingestion/curation agents will inspect Experience Log data through tools and decide what becomes preserved source, Project Memory, Session Memory, Practice Memory, or Personal Memory.
- Answer impact: Confirms branch
- Spec impact: Updated Data / State, Permissions / Security, and Error Handling to make SQLite-first Experience Log the raw hook storage decision.
- Context impact: Not needed; this follows the existing "SQLite is serving state, not curated truth" model.
- ADR impact: Candidate later; the exact raw event DB placement may deserve an ADR if it becomes hard to reverse.
- Follow-ups: Decide whether to reuse `state/memory.db` or create a separate gitignored raw event database.

### Question 8: Raw event database placement

- Status: Answered
- Branch type: Follow-up
- Why it matters: Existing `state/memory.db` already holds sessions and is gitignored serving state, but raw prompt/answer capture has project ownership and retention concerns.
- Scenario probe: `class-kit` and `wizepal` both emit hook events. Should Myelin query one shared event table filtered by project, or create/drop tables as projects are onboarded?
- Options:
  - A. Reuse `state/memory.db` with shared `experience_events` tables partitioned by `project_key` - one DB and simple cross-project querying, while keeping project ownership explicit.
  - B. Separate `state/experience.db` with shared project-keyed tables - isolates raw capture from sessions, but adds another DB.
  - C. Per-project event tables such as `class_kit_experience_events` - strong visual separation, but causes schema churn and awkward querying.
- Recommendation: A. Use the root DB and project-keyed tables. Avoid table-per-project because project ownership belongs in indexed data, not schema shape.
- Answer: Use the A+C intent: one root SQLite DB, but experience events are split by project via a `project_key` column and indexes. Do not create prefixed per-project tables.
- Answer impact: Resolves branch
- Spec impact: Updated Permissions / Security to specify root DB with project-keyed shared event tables.
- Context impact: Not needed; this applies existing repo-root SQLite and project-scoped memory terms.
- ADR impact: Candidate later; root DB partitioning is already established, but raw event table shape may be worth recording when finalized.
- Follow-ups: Define the exact event envelope/table shape.

### Question 9: Event envelope/table shape

- Status: Answered
- Branch type: Follow-up
- Why it matters: This becomes the contract between Codex hooks, Myelin storage, and future curation agents.
- Scenario probe: A future curation agent wants to find all `class-kit` Supabase authentication discussions without parsing every raw JSON payload. What fields must be indexed or directly readable?
- Options:
  - A. Minimal routing: `id`, `project_key`, `occurred_at`, `hook_event_name`, `cwd`, `raw_payload_json` - flexible, but future agents must parse raw JSON heavily.
  - B. Structured core plus raw payload: option A plus `codex_session_id`, `turn_id`, `event_kind`, `summary_text`, `raw_text`, `source` - more useful and queryable, but requires more validation.
  - C. Fully normalized event tables per hook type - strongest schema, but too early and brittle.
- Recommendation: B. Store a structured core for common querying and curation, plus the raw payload for fidelity.
- Answer: Choose option B.
- Answer impact: Confirms branch
- Spec impact: Added the minimum Experience Log event envelope to Data / State.
- Context impact: Not needed; this is schema detail, not product terminology.
- ADR impact: Candidate later; table shape may deserve an ADR once finalized in implementation planning.
- Follow-ups: Later planning should decide indexes, nullable fields, and validation rules.

### Question 5: Repo bootstrap command shape

- Status: Answered
- Branch type: Initial
- Why it matters: The first ingestion path should tell Myelin how to create a project brain from a repo without importing V1 pipeline assumptions.
- Scenario probe: You run a command against `/Users/liadgoren/Repositories/class-kit`. What should it create before hooks can safely capture events?
- Options:
  - A. Implement `myelin project onboard class-kit --repo <path>` as the bootstrap path - matches existing CLI vocabulary and current stub.
  - B. Add a separate `myelin brain create` command - closer to user language, but introduces new product vocabulary before CLI conventions settle.
  - C. Manual project directory setup first - fastest for discovery, but does not prove the operator path.
- Recommendation: A. Use the existing `project onboard` vocabulary, but design it around brain bootstrap rather than old init/compile mechanics.
- Answer: Modify the command vocabulary to `myelin bootstrap class-kit --repo <path>`. The name is intentionally agnostic and behavior-light: the command bootstraps whatever Myelin defines as the first project brain shell. It must be explicitly distinguished from any old V1 bootstrap pipeline assumptions.
- Answer impact: Changes model
- Spec impact: Updated Repo Bootstrap Input and V1 Boundary to use `myelin bootstrap <key> --repo <path>` and define bootstrap as V2 project brain shell creation.
- Context impact: Candidate later; if this command name survives pressure testing, add a glossary entry for Bootstrap Command or update V2 CLI Vocabulary.
- ADR impact: Candidate later; command vocabulary may deserve an ADR if it supersedes `project onboard`.
- Follow-ups: Need a later vocabulary check against existing CLI docs and Makefile aliases before finalizing.

### Question 6: Privacy and prompt capture policy

- Status: Answered
- Branch type: Risk
- Why it matters: `UserPromptSubmit` can capture sensitive instructions, secrets, or private context. The design must avoid turning Myelin into an unsafe transcript logger.
- Scenario probe: A prompt accidentally includes an API key or client-private detail. Should the hook store it, redact it, reject it, or store only metadata?
- Options:
  - A. Store prompt text by default with local-only assumption - useful, but too risky for accidental secrets.
  - B. Store prompt metadata plus optional redacted text - safer, but may lose context unless redaction is good.
  - C. Store no prompt text until explicit opt-in - safest, but weakens the first input stream.
- Recommendation: B. Capture enough to prove the input layer, but make raw prompt text a conscious redaction/retention design, not an accidental default.
- Answer: Choose option A for the first slice. Store full prompt and assistant-answer text locally because Myelin is local-first and the raw data belongs on the operator's machine. The raw storage directory must be gitignored so captured prompts/answers do not create repository leakage risk.
- Answer impact: Changes model
- Spec impact: Updated Permissions / Security and Error Handling to make full local raw capture the starting policy, conditional on gitignored local-only storage.
- Context impact: Not needed; this applies existing Experience Log and local-first product concepts.
- ADR impact: Candidate later; full raw local capture is a meaningful privacy/security stance, but the ADR decision should wait until storage path and retention policy are finalized.
- Follow-ups: Raw event storage destination must now explicitly include gitignore/local-only behavior.

### Question 7: Hook failure behavior

- Status: Answered
- Branch type: Risk
- Why it matters: Hooks sit inside the Codex loop. A broken Myelin hook should not derail coding unless the failure would silently lose critical evidence.
- Scenario probe: The hook cannot write to Myelin because the project is not registered or the DB is locked. Should Codex continue?
- Options:
  - A. Fail open with a local hook error log - keeps Codex usable, but risks unnoticed capture gaps.
  - B. Fail closed for project-routing errors - ensures capture integrity, but can interrupt active work.
  - C. Mixed: fail open for write/runtime errors, fail loud but non-blocking for invalid project setup - pragmatic, but needs clear operator feedback.
- Recommendation: C. Hooks should not block normal work by default, but setup/routing failures must be visible and actionable.
- Answer: Choose option A. Myelin should never interrupt an ongoing Codex agent session. The user's work with the agent is more important than missing Myelin inputs. Hook failures should fail open and write to a local hook error log.
- Answer impact: Changes model
- Spec impact: Updated Error Handling to make fail-open behavior mandatory and local hook error logging the repair path.
- Context impact: Candidate later; this may belong in product guidance as "Myelin capture must not interrupt active agent work."
- ADR impact: Candidate later; fail-open hook behavior is a durable product safety decision and may deserve an ADR during finalization.
- Follow-ups: Define the local hook error log path and how `status` or health checks surface capture gaps later.

### Question 10: Provider-agnostic capture boundary

- Status: Answered
- Branch type: Follow-up
- Why it matters: If Codex hook logic is wired directly into core Myelin concepts, adding Claude Code, Gemini, or another agent provider later will require refactoring the capture and ingestion model.
- Scenario probe: Later, Claude Code exposes a native session hook or transcript event stream. Should Myelin need to rewrite its Experience Log and project routing logic, or just add a Claude capture provider?
- Options:
  - A. Codex-specific hook ingestion in core - fastest for the first provider, but bakes Codex assumptions into Myelin.
  - B. Provider-specific capture adapters behind a Myelin capture facade - slightly more design work, but keeps core Experience Log provider-neutral.
  - C. Wait to abstract until a second provider exists - avoids premature abstraction, but likely creates migration debt because hooks shape the raw event contract.
- Recommendation: B. The capture boundary is important enough to define now, while keeping the first implementation Codex-only.
- Answer: Choose option B. Codex is a provider, not the driver. Hook ingestion logic should live under a Codex provider/adapter and implement a Myelin capture interface. Future providers implement the same interface using their native mechanisms.
- Answer impact: Introduces branch
- Spec impact: Updated Codex Hook Input and Integrations to define a provider-agnostic capture facade with Codex as the first adapter.
- Context impact: Candidate later; may need glossary language for Capture Provider or Capture Facade.
- ADR impact: Created ADR 0054.
- Follow-ups: Keep the first implementation Codex-only while preserving provider-neutral core contracts.

### Question 11: Global provider install command

- Status: Answered
- Branch type: Follow-up
- Why it matters: Installing global capture hooks modifies user-level provider config. The command must be explicit, provider-aware, and safe around existing user hooks.
- Scenario probe: `~/.codex/hooks.json` exists with unrelated hooks. The user runs Myelin install. What should happen?
- Options:
  - A. `myelin hooks install` installs only Codex hooks - explicit but provider-specific at the CLI surface.
  - B. `myelin install` auto-detects supported providers and installs selected integrations - provider-agnostic and future-proof, but needs clear selection/preview behavior.
  - C. `myelin bootstrap` installs hooks automatically - convenient, but surprising because bootstrapping one repo changes global capture behavior.
- Recommendation: B. Use `myelin install` as the provider-aware setup command; start with Codex auto-detection and safe merge into `~/.codex/hooks.json`.
- Answer: Choose option B. Use `myelin install`, auto-detect supported provider roots, and initially support Codex only by detecting `~/.codex/`, creating `~/.codex/hooks.json` if missing, or safely merging Myelin hook entries if it exists.
- Answer impact: Changes model
- Spec impact: Updated Integrations to replace hook-specific install/check language with provider-aware `myelin install`.
- Context impact: Candidate later; command vocabulary should be reflected in V2 CLI Vocabulary if finalized.
- ADR impact: Covered by ADR 0054 for provider-agnostic capture; install command details may not need a separate ADR unless the CLI surface remains surprising.
- Follow-ups: Need an install safety question: preview/diff, provider selection, and merge ownership.

### Question 12: Install safety and provider selection

- Status: Answered
- Branch type: Follow-up
- Why it matters: `myelin install` writes outside the repo into user-level provider config. It must be safe, explicit, and not clobber existing hooks.
- Scenario probe: `~/.codex/hooks.json` exists with unrelated hooks. The user runs `myelin install`. Should Myelin write immediately, ask interactively, or preview only?
- Options:
  - A. Preview by default, require `--apply` to write - safest and auditable, but adds one extra step.
  - B. Apply by default after printing a summary - convenient, but easier to surprise the user.
  - C. Interactive prompt per provider - friendly locally, but harder to test and script.
- Recommendation: A. `myelin install` should auto-detect providers, print what it would change, and only write with `--apply`.
- Answer: Choose option A.
- Answer impact: Confirms branch
- Spec impact: Updated Integrations to require preview-by-default install behavior with `--apply` for writes.
- Context impact: Not needed; this is command behavior, not terminology.
- ADR impact: Not needed separately; this is a safety detail under the provider-agnostic install direction.
- Follow-ups: Later planning should define exact diff/summary output and merge ownership markers for Myelin hook entries.

### Question 13: Project routing for global hooks

- Status: Answered
- Branch type: Follow-up
- Why it matters: Global hooks will fire from every Codex session. Myelin needs deterministic routing so supported project events are captured and unrelated repos do not pollute memory.
- Scenario probe: Codex runs in a repo that has never been bootstrapped in Myelin. Should Myelin create a project, store an unclaimed event, or ignore it with a hook error?
- Options:
  - A. Route only if `cwd` is inside a registered `repo_paths` entry in `projects/<key>/state/project.json`; otherwise log a local hook error and do not store the event - precise, but requires bootstrap before capture.
  - B. Auto-create a project for unknown repos - convenient, but risks junk project brains.
  - C. Store unknown repo events under an `unclaimed` bucket - preserves data, but creates cleanup/privacy clutter.
- Recommendation: A. Only registered projects capture events; bootstrap is the opt-in boundary.
- Answer: Confirm option A. If Myelin should support a project, the project reference must be initialized first. Global hooks can fire everywhere, but Myelin only stores events for registered projects.
- Answer impact: Confirms branch
- Spec impact: Added Project routing decision to Data / State.
- Context impact: Not needed; this applies existing project registration semantics.
- ADR impact: Candidate later; registered-project-only capture may deserve mention in the capture adapter ADR or a follow-up ADR if it remains central.
- Follow-ups: Later planning should define local hook error log entries for unknown repos.

### Question 14: Bootstrap shell contents

- Status: Answered
- Branch type: Follow-up
- Why it matters: This defines "turn a repo into a brain" without accidentally generating Project Memory or reviving old pipeline assumptions.
- Scenario probe: After `myelin bootstrap class-kit --repo /Users/liadgoren/Repositories/class-kit`, what files must exist before global hooks can route events safely?
- Options:
  - A. Minimal shell: `projects/class-kit/state/project.json`, canonical dirs, schema context if required, and empty/missing markers - enough for hook routing.
  - B. Shell plus initial `wiki/index.md` placeholder - gives Project Memory a human-readable landing page, but risks inventing project facts.
  - C. Shell plus generated initial project summary - useful, but pulls the first slice back into curation/generation too early.
- Recommendation: B, but the `wiki/index.md` must be a placeholder saying "uncurated project memory," not a project summary.
- Answer: Confirm option B, understood as A plus a placeholder. Bootstrap creates the minimal shell plus an explicitly uncurated `wiki/index.md` home for Project Memory. It does not generate project facts.
- Answer impact: Confirms branch
- Spec impact: Updated Repo Bootstrap Input to include an uncurated `wiki/index.md` placeholder.
- Context impact: Not needed; this uses existing Project Memory vocabulary.
- ADR impact: Not needed; this is implementation-scope detail.
- Follow-ups: Later planning should define the exact placeholder copy and missing-state metadata.

### Question 15: Hook error log location

- Status: Answered
- Branch type: Follow-up
- Why it matters: Hooks must never interrupt Codex, but capture failures need to be visible later so Myelin can explain missing data.
- Scenario probe: The hook cannot write an Experience Log event because SQLite is locked or unavailable. Where does the failure record go?
- Options:
  - A. Root SQLite `hook_errors` table in `state/memory.db` - queryable and fits serving state, but cannot help if DB write is the failure.
  - B. Gitignored file log under Myelin state, e.g. `state/hook-errors.jsonl` - robust fallback when DB writes fail, but less queryable.
  - C. Both: try SQLite first, fall back to gitignored JSONL - most robust, but slightly more moving parts.
- Recommendation: C. Since DB failure is one expected failure mode, the final fallback should be a gitignored JSONL file.
- Answer: Choose option C.
- Answer impact: Confirms branch
- Spec impact: Updated Error Handling to use a `hook_errors` table when possible and gitignored JSONL fallback when SQLite cannot be used.
- Context impact: Not needed; this is operational behavior, not product terminology.
- ADR impact: Not needed; this is implementation resilience detail under the fail-open hook policy.
- Follow-ups: Later planning should define JSONL schema, retention, and how status/health checks surface hook errors.

### Question 16: Duplicate event handling

- Status: Answered
- Branch type: Follow-up
- Why it matters: Hooks can retry, multiple matching hooks can run, and installs may be edited over time. Duplicate raw events could pollute later curation.
- Scenario probe: The same `UserPromptSubmit` event reaches Myelin twice. Should both rows remain, or should the second insert be ignored?
- Options:
  - A. No dedupe in v0 - simplest, but raw log may contain duplicates.
  - B. Deduplicate by provider event identity when available, such as `codex_session_id + turn_id + hook_event_name` - good for prompt/turn events, but not every event has all fields.
  - C. Deduplicate by computed content hash over `provider + session + turn + hook_event_name + raw_text` - more general, but risks suppressing legitimate repeated prompts.
- Recommendation: B with a fallback hash. Prefer provider identity when present; otherwise use a conservative hash and keep duplicates if uncertain.
- Answer: Confirm recommendation. Prefer provider identity when present; otherwise use a conservative fallback hash. If dedupe is uncertain, keep the event.
- Answer impact: Confirms branch
- Spec impact: Added duplicate handling decision to Error Handling.
- Context impact: Not needed; this is storage behavior.
- ADR impact: Not needed; this is a local persistence policy.
- Follow-ups: Later planning should define the unique index or insert behavior for provider identity dedupe.

### Question 17: Local hook command entrypoint

- Status: Answered
- Branch type: Follow-up
- Why it matters: `~/.codex/hooks.json` needs a stable command. Provider-specific adapters should not require embedding fragile repo-internal paths or database logic in hook config.
- Scenario probe: Internal Myelin scripts move during refactor. Should the user's `~/.codex/hooks.json` need to be rewritten?
- Options:
  - A. Call `myelin capture codex-hook` from PATH - clean CLI surface, but depends on `myelin` being installed/resolvable.
  - B. Call an absolute script inside this checkout - reliable locally, but ties hooks to this checkout path.
  - C. Call a small generated shim under `~/.codex/myelin/` that points to the active Myelin install - stable for Codex config, but adds install-state management.
- Recommendation: C. `myelin install --apply` can write a shim in user Codex state, and the shim routes to the active Myelin checkout.
- Answer: Choose option C.
- Answer impact: Confirms branch
- Spec impact: Updated Integrations to define a user-level Codex shim written by `myelin install --apply`.
- Context impact: Not needed; this is install mechanics.
- ADR impact: Not needed separately; this is an implementation consequence of provider-agnostic capture adapters.
- Follow-ups: Later planning should define shim path, contents, update behavior, and uninstall behavior.

### Question 18: Install update and uninstall lifecycle

- Status: Answered
- Branch type: Follow-up
- Why it matters: If Myelin writes global provider config, it needs a safe way to update and remove only its own entries.
- Scenario probe: Myelin's Codex hook command changes after a release. How does the user's `~/.codex/hooks.json` and shim get updated without touching unrelated hooks?
- Options:
  - A. Install/update only; manual removal if needed - simpler first slice, but leaves cleanup vague.
  - B. Install/update plus `myelin uninstall` that removes Myelin-owned hook entries and shim only - safer ownership story, more implementation work.
  - C. Shared reconciliation: `myelin install --update` removes and rewrites Myelin-owned artifacts; `myelin uninstall` uses the same removal logic without rewriting - explicit lifecycle and reusable implementation.
- Recommendation: C. Use one ownership/discovery path for update and uninstall.
- Answer: Revised after follow-up. Drop `--update`. `myelin install --apply` is idempotent create-or-update: it finds existing Myelin artifacts and hook entries, removes/reconciles them, then writes current versions. `myelin uninstall` uses the same discovery/removal logic but does not rewrite.
- Answer impact: Changes model
- Spec impact: Added install lifecycle behavior to Integrations, then simplified it so `--apply` handles create/update.
- Context impact: Not needed; command behavior only.
- ADR impact: Not needed separately; part of provider install lifecycle.
- Follow-ups: Later planning should define Myelin ownership markers and backup behavior before mutating `hooks.json`.

### Question 19: Ownership markers and backup behavior

- Status: Answered
- Branch type: Follow-up
- Why it matters: Safe install/update/uninstall depends on removing only Myelin-owned entries and recovering from bad writes without dirtying unrelated machine locations.
- Scenario probe: `~/.codex/hooks.json` contains both user hooks and Myelin hooks. `myelin install --apply` needs to update Myelin hooks. How does it identify its own entries and preserve recovery state?
- Options:
  - A. Use a recognizable command path only, no extra marker, no backup - simple, but brittle.
  - B. Add explicit Myelin metadata fields where Codex tolerates them, plus backup before writes - safest if unknown fields are preserved/tolerated.
  - C. Use command/path markers plus a sidecar ownership manifest under `.codex/.myelin/`, and backup `hooks.json` before writes - robust without relying on Codex preserving unknown hook fields.
- Recommendation: C. Mark ownership through the shim path/command plus a Myelin sidecar manifest, and always write a timestamped backup before mutating `hooks.json`.
- Answer: Choose a B+C hybrid, effectively C. Use path markers to identify Myelin hook entries, keep install ownership state under `.codex/.myelin/`, and store backups under `.codex/.myelin/backups/`.
- Answer impact: Confirms branch
- Spec impact: Added ownership and backup behavior to Integrations.
- Context impact: Not needed; install mechanics only.
- ADR impact: Not needed separately; implementation safety detail.
- Follow-ups: Later planning should define backup retention and exact manifest shape.

### Question 20: Bootstrap versus install ordering

- Status: Answered
- Branch type: Follow-up
- Why it matters: Global hooks can be installed before a project is registered, but events should only be stored once project routing can resolve the repo.
- Scenario probe: The user installs Myelin hooks today, but only bootstraps `class-kit` tomorrow. What happens to events from other repos?
- Options:
  - A. `myelin bootstrap class-kit --repo ...` first, then `myelin install --apply` - project is ready before hooks start firing.
  - B. `myelin install --apply` first, then `myelin bootstrap ...` per repo - install is machine-level setup; unregistered repo events are ignored/logged until a repo opts in.
  - C. Either order is allowed, but docs recommend bootstrap first - flexible, but less clear as product setup.
- Recommendation: C, with docs recommending bootstrap first for the first project.
- Answer: Choose option B. `myelin install --apply` is machine environment setup. Global hooks can fire everywhere, but nothing is saved until a repo is bootstrapped. After `class-kit` is bootstrapped, only `class-kit` inputs save to SQLite.
- Answer impact: Changes model
- Spec impact: Updated User-Facing Behavior and Project routing decision to make install-first, bootstrap-per-repo the product flow.
- Context impact: Candidate later; install vs bootstrap distinction may belong in CLI vocabulary.
- ADR impact: Candidate later; machine-level install and per-repo opt-in is a durable capture boundary.
- Follow-ups: Later planning should define install output that explains "installed but no projects bootstrapped yet."

### Question 21: Unknown repo hook behavior

- Status: Answered
- Branch type: Follow-up
- Why it matters: After install-first, hooks will naturally fire in repos that are not opted into Myelin. Treating those as errors would create noise for expected behavior.
- Scenario probe: The user has installed Myelin hooks but has not bootstrapped `class-kit`. A Codex hook fires from `class-kit`. What happens?
- Options:
  - A. Log every unregistered repo event to hook error log - visible, but noisy and expected after install-first.
  - B. Drop unregistered repo events as no-ops - simplest and matches per-repo opt-in, but provides no diagnostic trail.
  - C. Rate-limited diagnostic per repo/path - debuggable without log spam, but adds state for non-participating repos.
- Recommendation: C before user correction.
- Answer: Choose option B. If a hook has no matching Myelin project entry, discard it. Unbootstrapped repos are outside Myelin's capture scope, so unmatched hooks are no-ops, not errors.
- Answer impact: Changes model
- Spec impact: Updated Project routing decision and Error Handling to treat unknown repo hooks as dropped no-ops.
- Context impact: Not needed; this is routing behavior.
- ADR impact: Candidate later; no-op behavior for unbootstrapped repos may belong with the install/bootstrap capture boundary if an ADR is added.
- Follow-ups: Later planning should still define errors for malformed events inside a bootstrapped project.

### Question 22: Malformed event behavior inside a bootstrapped project

- Status: Answered
- Branch type: Follow-up
- Why it matters: Malformed provider events are different from unbootstrapped repo events. The project is opted in, and raw payloads may still be useful evidence even when structure extraction fails.
- Scenario probe: A Codex hook fires from `class-kit`, but the payload is missing expected fields. Should Myelin drop it, log an error, or save the raw payload as invalid evidence?
- Options:
  - A. Drop malformed events silently - simplest, but loses opted-in project evidence.
  - B. Fail open and write a hook error record - visible, but treats raw evidence as an operational failure.
  - C. Store malformed events in Experience Log with `status=invalid` and raw payload preserved - keeps evidence for later agents, but requires ingestion to tolerate partial structure.
- Recommendation: C after user correction.
- Answer: Choose option C. Hooks are side-effect logs and must never interfere with the Codex agent flow. For bootstrapped projects, save malformed events to the Experience Log with `status=invalid`, preserve raw data, and leave unparseable fields empty.
- Answer impact: Changes model
- Spec impact: Added `status` to the event envelope and updated Error Handling to preserve malformed bootstrapped-project events as invalid Experience Log records.
- Context impact: Not needed; this applies existing Experience Log raw-evidence semantics.
- ADR impact: Candidate later; "capture raw even when malformed" may belong in an event contract ADR if the table contract is finalized.
- Follow-ups: Later planning should define required minimum fields for an invalid event row.

### Question 23: Minimum fields for invalid events

- Status: Answered
- Branch type: Follow-up
- Why it matters: If a provider event is malformed, Myelin may not have all structured fields. The invalid row still needs enough routing and provenance to be useful.
- Scenario probe: Project routing succeeds for `class-kit`, but the hook payload lacks `hook_event_name` or `cwd`. Should Myelin preserve it anyway?
- Options:
  - A. Require only `project_key`, `occurred_at`, `source`, `status=invalid`, and `raw_payload_json` - easiest to preserve malformed data.
  - B. Also require `hook_event_name` and `cwd` - better diagnostics, but may reject more malformed events.
  - C. Require the full normal envelope even for invalid events - defeats the point of invalid capture.
- Recommendation: A.
- Answer: Use an A+B hybrid. Require the minimal A fields, and opportunistically extract `hook_event_name` and `cwd` when present, but do not require them.
- Answer impact: Resolves branch
- Spec impact: Updated Error Handling with the invalid event minimum envelope and optional diagnostics.
- Context impact: Not needed; schema detail only.
- ADR impact: Not needed separately; event table detail.
- Follow-ups: Later planning should reflect optional fields in validation schema.

### Question 24: Event kind taxonomy

- Status: Answered
- Branch type: Follow-up
- Why it matters: This is the normalized layer future ingestion agents will use. It should be provider-neutral, not Codex-specific.
- Scenario probe: Codex, Claude Code, and Gemini eventually emit different native hook/event names for the same user-prompt or assistant-response concept. Should Myelin expose provider-specific event kinds or normalize them?
- Options:
  - A. Mirror Codex hook names: `SessionStart`, `UserPromptSubmit`, `Stop` - simple, but provider-specific.
  - B. Provider-neutral kinds: `session.start`, `user.prompt`, `assistant.response` - cleaner core model, while raw payload keeps provider details.
  - C. Broad generic kind only: `codex.hook` - flexible, but less useful for querying and curation.
- Recommendation: B. Normalize into provider-neutral event kinds, and keep the original hook name in `hook_event_name`.
- Answer: Choose option B. Provider-neutral event kinds let Myelin support Gemini, Claude Code, and Codex later without a provider-specific core schema.
- Answer impact: Confirms branch
- Spec impact: Added initial provider-neutral `event_kind` values to Data / State.
- Context impact: Candidate later; `event_kind` taxonomy may belong in schema docs or CONTEXT if it becomes product language.
- ADR impact: Covered by ADR 0054 provider-agnostic capture adapters.
- Follow-ups: Later planning should define how Codex `SessionStart`, `UserPromptSubmit`, and `Stop` map into these kinds.

### Question 25: Event text fields and raw-row lifecycle

- Status: Answered
- Branch type: Follow-up
- Why it matters: Future agents need enough text to ingest without parsing raw JSON every time, but hooks should stay deterministic and Experience Log rows should not become permanent curated summaries.
- Scenario probe: A `user.prompt` raw row is later ingested into a Project Memory update candidate. Should the raw row stay forever with a summary, or should ingestion output live elsewhere and the raw row be removed/terminally marked?
- Options:
  - A. `raw_text` only; no `summary_text` in v0 - simple and faithful, with summary as later ingestion output.
  - B. Deterministic `summary_text` from event kind and first line/truncated text - query-friendly, but blurs raw capture with ingestion output.
  - C. LLM-generated summary at capture time - better summaries, but violates the "hooks do not call models" rule.
- Recommendation: A. Store full `raw_text` where applicable and leave `summary_text` out of v0.
- Answer: Choose option A and remove `summary_text`. Summary text is an ingestion output, not a raw capture field. Once a future ingestion workflow processes an Experience Log row, that raw row should be removed and replaced with a tombstone record instead of retained indefinitely.
- Answer impact: Changes model
- Spec impact: Removed `summary_text` from the event envelope and added transient raw-row lifecycle guidance.
- Context impact: Candidate later; Experience Log retention/deletion semantics may belong in product glossary relationships.
- ADR impact: Candidate later; deleting processed Experience Log rows may deserve an ADR when ingestion lifecycle is finalized.
- Follow-ups: Later planning should define tombstone fields and output reference format.

### Question 26: Raw row post-ingestion lifecycle

- Status: Answered
- Branch type: Follow-up
- Why it matters: Deleting keeps the raw store small and privacy-friendly. Keeping some terminal record helps audit/debug ingestion and prevent duplicate processing.
- Scenario probe: A raw `assistant.response` event has been ingested into a Project Memory update candidate. Should the raw prompt/answer remain in the Experience Log?
- Options:
  - A. Physical delete after successful ingestion - simplest and privacy-friendly, but no raw audit trail.
  - B. Mark `status=processed` and keep raw payload - auditable, but keeps sensitive raw data around.
  - C. Delete raw payload but keep a small tombstone row with event identity, project key, processed timestamp, and output references - balances privacy with traceability.
- Recommendation: C.
- Answer: Choose option C now, not deferred. Ingestion should remove the raw Experience Log row and create a tombstone record in a tombstone table for traceability, auditability, debugging, and duplication prevention.
- Answer impact: Changes model
- Spec impact: Added processed Experience Log tombstones to Data / State.
- Context impact: Candidate later; tombstones may become part of Experience Log lifecycle terminology.
- ADR impact: Candidate later; raw deletion plus tombstone retention may deserve an ADR when ingestion is designed.
- Follow-ups: Later planning should define tombstone table fields and output reference format.

### Question 27: What counts as ingested

- Status: Answered
- Branch type: Follow-up
- Why it matters: If raw rows are deleted too early, Myelin loses useful evidence. If they are deleted too late, raw capture grows forever.
- Scenario probe: An ingestion worker reads a raw prompt/answer event but decides it contains no durable memory. Is the raw row processed?
- Options:
  - A. Tombstone after any ingestion attempt, even if no memory/candidate is created - clears raw quickly, but may lose data after weak/no-op ingestion.
  - B. Tombstone only after successful ingestion creates at least one durable output reference or explicit terminal decision, such as a candidate, source preservation record, session summary, curated update, or rejected/no-action record - safer and auditable.
  - C. Tombstone only after curated wiki memory is updated - too strict; raw rows that produce candidates or rejections would pile up.
- Recommendation: B. A row is processed only when ingestion creates a durable output or explicit terminal decision.
- Answer: Choose option B.
- Answer impact: Confirms branch
- Spec impact: Added the condition for Experience Log deletion/tombstoning.
- Context impact: Candidate later; terminal decision language may belong in ingestion lifecycle docs.
- ADR impact: Candidate later; this may belong with the tombstone lifecycle ADR if created.
- Follow-ups: Later planning should define valid output reference types and rejected/no-action record shape.

### Question 28: Hook event mapping

- Status: Answered
- Branch type: Follow-up
- Why it matters: This is the first capture adapter contract. It should be simple and provider-neutral.
- Scenario probe: Codex emits `Stop`, but the payload has no assistant text. Should Myelin create an `assistant.response` row anyway?
- Options:
  - A. `SessionStart -> session.start`, `UserPromptSubmit -> user.prompt`, `Stop -> assistant.response` - simple, but `Stop` is turn-scoped and may not always mean a meaningful assistant response.
  - B. Same as A, but only write `assistant.response` from `Stop` when `last_assistant_message` is non-empty - avoids empty response rows.
  - C. Store all Codex events as generic `provider.event` and let ingestion classify later - flexible, but weakens normalized querying.
- Recommendation: B. Map directly, but only create `assistant.response` when there is actual assistant text.
- Answer: Choose option B.
- Answer impact: Confirms branch
- Spec impact: Added initial Codex adapter mapping to Data / State.
- Context impact: Not needed; provider adapter detail.
- ADR impact: Covered by ADR 0054 provider-agnostic capture adapters.
- Follow-ups: Later planning should verify actual Codex hook payload field names against fixtures.

### Question 29: Turn relationship

- Status: Answered
- Branch type: Follow-up
- Why it matters: Many future memory updates depend on pairing the user question with the assistant answer. If rows are independent, ingestion has to infer pairs from timestamps/session.
- Scenario probe: A user asks about Supabase auth and the assistant answers after reading docs. How does ingestion know those two rows belong together?
- Options:
  - A. Store independent rows only - simplest, but later ingestion must infer pairing.
  - B. Store provider-supplied `turn_id` when available and use it to pair prompt/response rows - better pairing, provider-neutral enough if nullable.
  - C. Create Myelin's own turn ids if provider lacks one - stronger relationship, but adds sequencing complexity.
- Recommendation: B. Use provider-supplied `turn_id` when available; do not invent Myelin turn ids in v0.
- Answer: Choose option B.
- Answer impact: Confirms branch
- Spec impact: Added prompt/response pairing guidance to Data / State.
- Context impact: Not needed; event schema detail.
- ADR impact: Not needed separately.
- Follow-ups: Later planning should define indexes involving `project_key`, provider session id, and `turn_id`.

### Question 30: Session identity

- Status: Answered
- Branch type: Follow-up
- Why it matters: Existing `sessions` tables exist, but the first slice is raw Experience Log, not full Session Memory.
- Scenario probe: Codex emits `SessionStart`. Should Myelin create a `sessions` row or just store the provider session id on Experience Log rows?
- Options:
  - A. Use provider session id only, e.g. `codex_session_id`, stored on Experience Log rows - simplest and avoids pretending Session Memory is done.
  - B. Create a Myelin `sessions` row on `session.start` and link events to it - better continuity, but starts implementing Session Memory.
  - C. Store both provider session id and Myelin session id, creating Myelin sessions opportunistically - richer, but scope creep.
- Recommendation: A. Store provider session id only in Experience Log for v0. Derive Myelin Session Memory later.
- Answer: Choose option A.
- Answer impact: Confirms branch
- Spec impact: Added provider-owned session identity guidance to Data / State.
- Context impact: Not needed; this clarifies scope, not terminology.
- ADR impact: Not needed; aligns with first implemented subset decision.
- Follow-ups: Later Session Memory design should decide how provider session ids map to Myelin session records.

### Question 31: Provider field naming

- Status: Answered
- Branch type: Follow-up
- Why it matters: The Experience Log schema should not leak Codex-specific assumptions into Myelin core if capture providers are pluggable.
- Scenario probe: Claude Code later emits its own session id. Should Myelin add `claude_session_id`, or reuse a provider-neutral column?
- Options:
  - A. Keep `codex_session_id` - explicit for first provider, but not provider-neutral.
  - B. Use `provider_session_id` plus `provider`/`source` - provider-neutral and works for future providers.
  - C. Store provider IDs only inside `raw_payload_json` - flexible, but weak for querying.
- Recommendation: B. Use `provider_session_id`, `provider`, and `source`. The Codex adapter maps Codex's `session_id` into `provider_session_id`.
- Answer: Choose option B.
- Answer impact: Confirms branch
- Spec impact: Replaced `codex_session_id` with `provider` and `provider_session_id` in the event envelope and session identity guidance.
- Context impact: Not needed; schema detail only.
- ADR impact: Covered by ADR 0054 provider-agnostic capture adapters.
- Follow-ups: Later planning should define allowed provider identifiers, starting with `codex`.

### Question 32: Capture provider identifier

- Status: Answered
- Branch type: Follow-up
- Why it matters: This value becomes query/filter data and future provider contract precedent.
- Scenario probe: A future query asks for all raw events from Codex regardless of hook source. What provider value should it filter on?
- Options:
  - A. `codex` - simple product/provider name.
  - B. `openai.codex` - clearer namespace if OpenAI has multiple tools/providers later.
  - C. `codex-cli` - precise to the current surface, but may not cover Codex app/IDE hooks later.
- Recommendation: A. Use `codex` as the provider, and use `source` for more specific origin like `codex-hook`.
- Answer: Choose option A.
- Answer impact: Confirms branch
- Spec impact: Added first provider identifier guidance to Data / State.
- Context impact: Not needed; provider enum detail.
- ADR impact: Covered by ADR 0054.
- Follow-ups: Later planning should encode `codex` as the first allowed provider value.

### Question 33: Hook payload fixture strategy

- Status: Answered
- Branch type: Follow-up
- Why it matters: Provider adapter tests should not depend on live Codex sessions every time, but docs-based fixtures may drift from real payloads.
- Scenario probe: The Codex docs say `Stop` includes `last_assistant_message`, but a live payload includes additional fields or different null behavior. How do tests catch this?
- Options:
  - A. Use hand-authored JSON fixtures for `SessionStart`, `UserPromptSubmit`, and `Stop` - deterministic and easy, but may drift from actual Codex payloads.
  - B. Capture one real payload per hook event from `class-kit`, save redacted fixtures, then test against those - grounded, but requires live setup first.
  - C. Do both: start with hand-authored fixtures from docs, then replace/add real captured fixtures after first manual verification - best coverage, slightly more work.
- Recommendation: C. Use docs-based fixtures to build, then real captured fixtures to validate drift.
- Answer: Choose option C.
- Answer impact: Confirms branch
- Spec impact: Updated Testing Strategy with docs-based and real captured fixture requirements.
- Context impact: Not needed.
- ADR impact: Not needed.
- Follow-ups: Later planning should define where provider fixtures live and how real fixtures are redacted.

### Question 34: Provider fixture location

- Status: Answered
- Branch type: Follow-up
- Why it matters: Provider capture fixtures need to be maintainable test artifacts without becoming product memory or design-only evidence.
- Scenario probe: A future implementer adds real captured Codex hook fixtures after `class-kit` verification. Where should they live so tests can use them and agents do not confuse them with memory?
- Options:
  - A. `src/capture/providers/codex/__fixtures__/` - close to implementation, conventional for tests.
  - B. `tests/fixtures/capture/codex/` - centralizes test data and keeps source tree cleaner.
  - C. `docs/design/2026-06-12-project-brain-bootstrap-codex-hooks/fixtures/` - good for design evidence, but wrong for implementation tests.
- Recommendation: B. Use `tests/fixtures/capture/codex/` so fixtures are clearly test artifacts and provider-specific.
- Answer: Choose option B.
- Answer impact: Confirms branch
- Spec impact: Updated Testing Strategy with `tests/fixtures/capture/codex/`.
- Context impact: Not needed; test layout detail.
- ADR impact: Not needed.
- Follow-ups: Later planning should define fixture file naming and redaction rules.

### Question 35: Bootstrap idempotency and existing project handling

- Status: Answered
- Branch type: Pressure-test
- Why it matters: `myelin bootstrap` is the per-repo opt-in boundary for capture. It must be safe to rerun, and it must not accidentally reassign an existing repo path or overwrite project memory shell data.
- Scenario probe: `class-kit` was bootstrapped yesterday. Today the user reruns `myelin bootstrap class-kit --repo /Users/liadgoren/Repositories/class-kit`, or accidentally runs `myelin bootstrap other-key --repo /Users/liadgoren/Repositories/class-kit`. What should happen?
- Options:
  - A. Idempotent same-key rerun, fail on repo path already registered to another key - safe and predictable.
  - B. Always rewrite the project shell - convenient, but risks clobbering placeholders/state.
  - C. Allow repo path reassignment with a flag such as `--force` - flexible, but adds migration semantics to the first slice.
- Recommendation: A. Same key and same repo path should be a no-op/update of missing bootstrap artifacts. A repo path already owned by another project key should fail loudly.
- Answer: Choose option A. Bootstrap should be idempotent for the same key/repo path, and a repo path already registered to another key should fail loudly.
- Answer impact: Confirms branch
- Spec impact: Added bootstrap idempotency and repo ownership collision behavior to Repo Bootstrap Input.
- Context impact: Not needed; command behavior only.
- ADR impact: Not needed; local setup safety detail.
- Follow-ups: Later planning should define exact behavior when a project key exists with a different repo path.

### Question 36: Project key and repo path validation

- Status: Answered
- Branch type: Pressure-test
- Why it matters: The project key becomes directory name, routing key, and query/capture identifier. The repo path becomes the ownership boundary for global hook capture.
- Scenario probe: The user runs `myelin bootstrap "Class Kit" --repo ./class-kit` from a symlinked path or with a key containing spaces. Should Myelin normalize, reject, or infer?
- Options:
  - A. Require explicit slug key and absolute canonical repo path - strict but predictable for routing and filesystem layout.
  - B. Infer key from repo folder and accept relative repo path - convenient, but risks surprising key/path choices.
  - C. Allow flexible keys and normalize internally - user-friendly, but creates alias/canonicalization complexity.
- Recommendation: A. Require an explicit slug-like key and store a resolved absolute repo path for v0.
- Answer: Choose option A. Require an explicit slug-like key and an absolute canonical repo path.
- Answer impact: Confirms branch
- Spec impact: Added project key and repo path validation requirements to Repo Bootstrap Input.
- Context impact: Not needed; validation detail.
- ADR impact: Not needed.
- Follow-ups: Later planning should define the allowed key regex and path resolution behavior around symlinks.

### Question 37: Provider install selection when auto-detecting

- Status: Answered
- Branch type: Pressure-test
- Why it matters: `myelin install` is provider-agnostic and will eventually detect multiple provider roots. The first implementation supports Codex only, but the command contract should not become ambiguous later.
- Scenario probe: A future machine has both `~/.codex/` and a Claude Code config directory. The user runs `myelin install --apply`. Does it install all detected providers or require selection?
- Options:
  - A. Install all detected supported providers by default - convenient, but may surprise users by modifying multiple provider configs.
  - B. Preview all detected providers, require explicit `--provider <name>` for writes when more than one provider is detected - safer, but adds a flag.
  - C. Codex-only behavior for now; defer multi-provider selection semantics - simplest, but may force command redesign later.
- Recommendation: B as the durable contract, while v0 may only detect/support `codex`.
- Answer: Use an interactive terminal CLI by default when multiple supported providers are detected, and support explicit flags for scripted/non-interactive use. `--provider <name>` bypasses provider selection and installs Myelin only for that provider. This is option B with a CLI-choice default instead of hard failure.
- Answer impact: Changes model
- Spec impact: Updated Integrations to define interactive provider selection by default plus `--provider` override behavior.
- Context impact: Candidate later; provider selection behavior may belong in command vocabulary docs if finalized.
- ADR impact: Not needed separately; this is CLI behavior under the provider-agnostic install decision.
- Follow-ups: Later planning should define non-interactive failure behavior when multiple providers are detected and no terminal is available.

### Question 38: Non-interactive provider selection behavior

- Status: Answered
- Branch type: Pressure-test follow-up
- Why it matters: The install command is both a human terminal command and a scriptable setup command. If provider selection expects an interactive terminal, automation must fail predictably instead of hanging or modifying the wrong provider.
- Scenario probe: A future script runs `myelin install --apply` on a machine with Codex and Claude Code detected, but stdin is not a TTY and no `--provider` flag was passed. What should Myelin do?
- Options:
  - A. Fail before writing and print the detected providers plus the required `--provider <name>` flag - safest and predictable for scripts.
  - B. Install the default provider, such as `codex` - convenient, but surprising if multiple provider configs exist.
  - C. Install all detected providers in non-interactive mode - convenient for bootstrap scripts, but contradicts the no-surprise install model.
- Recommendation: A. Interactive selection is for humans. Non-interactive multi-provider writes should require explicit `--provider`.
- Answer: Choose option A. If multiple providers are detected and the command cannot prompt, `myelin install --apply` must fail before writing and print the detected providers plus the required `--provider <name>` usage.
- Answer impact: Confirms branch
- Spec impact: Updated Integrations with non-interactive multi-provider failure behavior.
- Context impact: Not needed; this is CLI error behavior, not new terminology.
- ADR impact: Not needed separately; this is part of the provider-agnostic install command contract.
- Follow-ups: Later planning should define the exact exit code and stderr/stdout split.

### Question 39: Interactive provider selection cardinality

- Status: Answered
- Branch type: Pressure-test follow-up
- Why it matters: Provider selection can mean "choose one provider target" or "choose any subset of detected providers." The install UX and safety model differ because selecting multiple providers intentionally writes multiple user-level configs.
- Scenario probe: A future machine has Codex, Claude Code, and Gemini detected. The user runs `myelin install --apply` in a terminal and reaches provider selection. Can they select Codex and Claude in one run, or must they run the command once per provider?
- Options:
  - A. Multi-select providers interactively, with a final summary before writing - flexible and explicit, but needs a slightly richer prompt.
  - B. Single-select provider per run - simpler and safer, but slower when setting up several providers.
  - C. Single-select for `--apply`, multi-select for preview only - cautious, but awkward and inconsistent.
- Recommendation: A. Interactive selection is already an explicit user choice, so multi-select plus a final write summary is safe and convenient. `--provider <name>` remains the simple single-provider scripted path.
- Answer: Choose option A. Interactive provider selection should allow selecting any subset of detected supported providers, then show a final summary before writing.
- Answer impact: Confirms branch
- Spec impact: Updated Integrations to make interactive provider selection multi-select with final write summary.
- Context impact: Not needed; this is CLI interaction behavior.
- ADR impact: Not needed separately; covered by provider-agnostic install command contract.
- Follow-ups: Later planning should decide whether scripted `--provider` can be repeated for multiple providers or remains one provider per invocation.

### Question 40: Provider selection in preview versus apply mode

- Status: Answered
- Branch type: Pressure-test follow-up
- Why it matters: `myelin install` previews by default, while `myelin install --apply` writes. Provider selection could happen in both modes or only when writing. If this is ambiguous, users may not know whether a prompt is safe.
- Scenario probe: The user runs plain `myelin install` on a machine with multiple supported providers. Should the CLI ask which providers to preview, preview all detected providers, or only ask during `--apply`?
- Options:
  - A. Plain `myelin install` previews all detected providers without prompting; `--apply` prompts or uses `--provider` before writing - clearest dry-run behavior.
  - B. Plain `myelin install` also opens provider selection, then previews only selected providers - consistent UX, but a preview command becomes interactive.
  - C. Plain `myelin install` requires `--provider` when multiple providers are detected - script-friendly, but less helpful for human discovery.
- Recommendation: A. Preview should be broad and non-mutating by default. Selection matters most before writes.
- Answer: Choose option A. Plain `myelin install` previews all detected providers without prompting. Provider selection is only needed before writes: `myelin install --apply` prompts interactively, or `--provider <name>` bypasses selection.
- Answer impact: Confirms branch
- Spec impact: Updated Integrations to make preview mode broad, non-interactive, and non-mutating by default.
- Context impact: Not needed; this is CLI interaction behavior.
- ADR impact: Not needed separately; part of the provider install command contract.
- Follow-ups: Later planning should define exact preview output for detected-but-unsupported providers.

### Question 41: Additional ADR coverage

- Status: Answered
- Branch type: Finalization
- Why it matters: ADR 0054 already records the provider-agnostic capture adapter decision. The remaining design includes several durable capture boundaries, but not every spec decision should become a separate ADR.
- Scenario probe: A future agent sees global hooks, no-op drops for unbootstrapped repos, fail-open hook behavior, and raw Experience Log deletion with tombstones. Which of these should be discoverable as ADR-level decisions instead of only appearing in this design spec?
- Options:
  - A. Create one additional ADR for the global-install/per-repo-bootstrap/fail-open capture boundary - captures the most surprising operational contract without over-recording details.
  - B. Create no additional ADRs now - keep ADR 0054 as the only durable decision record and let the spec carry the rest.
  - C. Create several ADRs: one for global install and bootstrap opt-in, one for fail-open hooks, and one for raw deletion/tombstones - maximally explicit, but likely over-documents first-slice details.
- Recommendation: A. The durable surprising decision is the capture boundary: global hooks are installed at machine level, but saved capture is per-repo opt-in and must never interrupt active agent work.
- Answer: Choose option A. Create one additional ADR for the global-install/per-repo-bootstrap/fail-open capture boundary.
- Answer impact: Confirms branch
- Spec impact: No spec behavior change; this records the already-settled operational boundary.
- Context impact: Already updated `CONTEXT.md` with Install Command, Bootstrap Command, Capture Provider, Capture Adapter, Project Memory Shell, and Experience Log Tombstone.
- ADR impact: Created ADR 0055 for the global install, per-repo opt-in, fail-open capture boundary.
- Follow-ups: None.
