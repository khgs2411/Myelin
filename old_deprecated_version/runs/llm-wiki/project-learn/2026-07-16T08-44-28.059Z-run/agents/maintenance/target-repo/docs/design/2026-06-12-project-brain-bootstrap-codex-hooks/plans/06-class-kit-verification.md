# Chunk 06: Class Kit Verification

**Plan Set:** `../plan.md`
**Spec:** `../spec.md`
**Status:** Ready For Implementation
**Depends on:** `01-bootstrap-project-memory-shell.md`, `02-experience-log-storage.md`, `03-provider-install-lifecycle.md`, `04-capture-routing-and-errors.md`, `05-codex-capture-adapter.md`
**Enables:** Later ingestion, Session Memory, Practice Memory, and Personal Memory design slices

## Goal

Verify the complete first slice against the live `class-kit` repo: preview and then explicitly approve global Codex install, bootstrap `class-kit`, capture safe hook events, prove rows land in local SQLite for bootstrapped repos only, prove hooks do not mutate curated wiki memory, and either write redacted live fixture files or create an owned follow-up record explaining why no safe fixture file was written.

## Source Artifacts

- `../spec.md`: User-Facing Behavior, Integrations, Testing Strategy.
- `../agenda.md`: Questions 20, 21, 33, 34, 37-40.
- `../../../docs/adr/0055-use-global-install-with-per-repo-capture-opt-in.md`
- Completed chunks 01-05.
- External repo target: `/Users/liadgoren/Repositories/class-kit`.

## Relationships

- **Depends on:** all implementation chunks.
- **Enables:** confidence to design ingestion/promotion and later real fixture additions.
- **Shared contracts:** real command flow `myelin install`, `myelin install --apply --provider codex`, `myelin bootstrap class-kit --repo /Users/liadgoren/Repositories/class-kit`, `MYELIN_ROOT=/Users/liadgoren/Repositories/llm-wiki myelin capture codex-hook`.
- **Integration points:** real `~/.codex/hooks.json`, real Myelin `state/memory.db`, `projects/class-kit/`, redacted fixtures under `tests/fixtures/capture/codex/`.

## File Responsibility Map

**Create:**
- `docs/design/2026-06-12-project-brain-bootstrap-codex-hooks/verification/class-kit-codex-capture.md` - verification transcript, commands, results, approval note, fixture outcome.
- Optional redacted fixture files under `tests/fixtures/capture/codex/live-*.json` - only if safe to write as working-tree files.

**Modify:**
- None unless adding redacted fixtures or a follow-up record.

**Test:**
- No new unit tests required in this chunk unless live fixtures are written; if fixtures are written, extend `src/capture/providers/codex.test.ts` to parse them.

## Implementation Tasks

### Task 1: Preflight Without Mutating Real Provider State

**Files:**
- Create: `docs/design/2026-06-12-project-brain-bootstrap-codex-hooks/verification/class-kit-codex-capture.md`

- [ ] **Step 1: Verify prerequisites**

Run: `test -d /Users/liadgoren/Repositories/class-kit`  
Expected: exit code 0.

Run: `bun test`  
Expected: all tests pass.

Run: `bun run typecheck`  
Expected: TypeScript completes without errors.

Run: `bun src/cli.ts install`  
Expected: previews Codex provider state and does not write.

- [ ] **Step 2: Create verification log**

Write `docs/design/2026-06-12-project-brain-bootstrap-codex-hooks/verification/class-kit-codex-capture.md` with:

```md
# Class Kit Codex Capture Verification

Date: 2026-06-12

## Preflight

- `bun test`: record the actual pass or fail result and the final output line.
- `bun run typecheck`: record the actual pass or fail result and the final output line.
- `bun src/cli.ts install`: record the provider preview summary printed by the command.

## Approval Gate

Real `~/.codex` mutation was approved by Liad immediately before running install apply: record `yes` with timestamp, or record `no` and stop before mutation.

## Bootstrap

- Command: `bun src/cli.ts bootstrap class-kit --repo /Users/liadgoren/Repositories/class-kit`
- Result: record the command output summary.

## Capture

- Command: record the exact command, including `MYELIN_ROOT=/Users/liadgoren/Repositories/llm-wiki`.
- Safe prompt used: record the exact synthetic prompt or a redacted prompt label.
- Rows observed: record the count and event kinds.
- Hook errors observed: record the count.
- Wiki mutation check: record the status command used and result.

## Fixture Outcome

Either:
- Redacted live fixture files written: record fixture paths.

Or:
- Follow-up owner: record the accountable owner.
- Reason no fixture file was written: record the reason.
- Required next capture conditions: record the exact next safe capture conditions.
```

If the executor cannot fill a field with an actual value, stop and ask the user; do not leave unresolved template text in the verification file.

### Task 2: Bootstrap Class Kit

**Files:**
- Writes project shell under `projects/class-kit/`

- [ ] **Step 1: Run bootstrap**

Run: `bun src/cli.ts bootstrap class-kit --repo /Users/liadgoren/Repositories/class-kit`  
Expected output contains:

```text
Bootstrapped project class-kit.
repo: /Users/liadgoren/Repositories/class-kit
```

- [ ] **Step 2: Verify project shell**

Run: `test -f projects/class-kit/state/project.json`  
Expected: exit code 0.

Run: `test -f projects/class-kit/wiki/index.md`  
Expected: exit code 0.

Run: `bun src/cli.ts status class-kit`  
Expected: succeeds and prints project key `class-kit`.

### Task 3: Explicit Approval Gate Before Real Codex Install

**Files:**
- Real external path: `~/.codex/hooks.json`

- [ ] **Step 1: Ask for approval immediately before mutation**

Required user-facing approval question:

```text
This will run `bun src/cli.ts install --apply --provider codex` and may create or update Myelin-owned entries in `~/.codex/hooks.json`, with backups under `~/.codex/.myelin/backups/`. Approve this real Codex config mutation?
```

Expected: user explicitly approves. If not approved, stop chunk execution and record that manual verification is blocked by approval.

- [ ] **Step 2: Apply install only after approval**

Run: `bun src/cli.ts install --apply --provider codex`  
Expected output contains:

```text
Provider: codex
Mode: apply
```

Run: `test -f ~/.codex/hooks.json`  
Expected: exit code 0.

Run: `test -d ~/.codex/.myelin/backups`  
Expected: exit code 0.

### Task 4: Capture Safe Events

**Files:**
- Reads/writes `state/memory.db`
- May create redacted live fixtures under `tests/fixtures/capture/codex/`

- [ ] **Step 1: Run synthetic capture from class-kit cwd**

Run from `/Users/liadgoren/Repositories/class-kit`. The explicit `MYELIN_ROOT` is required because the hook caller cwd is the target repo, not the Myelin checkout:

```bash
printf '%s\n' '{"hook_event_name":"UserPromptSubmit","session_id":"manual-session","turn_id":"manual-turn","cwd":"/Users/liadgoren/Repositories/class-kit","prompt":"Synthetic verification prompt for Myelin capture."}' | MYELIN_ROOT=/Users/liadgoren/Repositories/llm-wiki bun /Users/liadgoren/Repositories/llm-wiki/src/cli.ts capture codex-hook
```

Expected output contains `capture stored`.

- [ ] **Step 2: Verify SQLite row with Bun**

Run from `/Users/liadgoren/Repositories/llm-wiki`:

```bash
bun -e 'import { openMemoryDb } from "./src/memory/db.ts"; const db = openMemoryDb(process.cwd()); const rows = db.query("select project_key,event_kind,provider,source,status from experience_events where project_key = ? order by occurred_at").all("class-kit"); console.log(JSON.stringify(rows, null, 2)); db.close();'
```

Expected output includes one row with:

```json
{
  "project_key": "class-kit",
  "event_kind": "user.prompt",
  "provider": "codex",
  "source": "codex-hook",
  "status": "valid"
}
```

Expected: no `state/memory.db` is created under `/Users/liadgoren/Repositories/class-kit`; the captured row is read from `/Users/liadgoren/Repositories/llm-wiki/state/memory.db`.

- [ ] **Step 3: Verify no curated wiki mutation from hook**

Run: `git status --short projects/class-kit/wiki`  
Expected: no changes caused by hook capture beyond the bootstrap placeholder created in Task 2.

### Task 5: Fixture Outcome

**Files:**
- Optional create/modify: `tests/fixtures/capture/codex/live-*.json`
- Modify: verification log

- [ ] **Step 1: Decide fixture outcome**

If a captured payload can be safely redacted, add a fixture such as `tests/fixtures/capture/codex/live-user-prompt-submit-redacted.json`:

```json
{
  "hook_event_name": "UserPromptSubmit",
  "session_id": "redacted-session",
  "turn_id": "redacted-turn",
  "cwd": "/Users/liadgoren/Repositories/class-kit",
  "prompt": "Synthetic verification prompt for Myelin capture."
}
```

Then extend `src/capture/providers/codex.test.ts` with a test that loads every `live-*.json` fixture and asserts `normalizeCodexHookPayload` returns a non-null event.

If no safe fixture can be written, update the verification log with:

```md
## Fixture Outcome

- Follow-up owner: Liad / next Myelin executor
- Reason no fixture file was written: live payload contained sensitive or non-synthetic content
- Required next capture conditions: capture a synthetic prompt/response pair in `class-kit`, redact session identifiers, and write only the redacted fixture file
```

- [ ] **Step 2: Run tests if fixtures were added**

Run: `bun test src/capture/providers/codex.test.ts`  
Expected: passes.

## Verification

Run: `bun test`  
Expected: all tests pass.

Run: `bun run typecheck`  
Expected: TypeScript completes without errors.

Run: `bun src/cli.ts status class-kit`  
Expected: prints project key `class-kit`.

Run: `git status --short projects/class-kit/wiki state/memory.db state/hook-errors.jsonl`  
Expected: `state/memory.db` and `state/hook-errors.jsonl` are ignored and should not appear; no hook-created curated wiki changes appear.

## Acceptance Criteria Covered

- `class-kit` can be bootstrapped as the first V2 brain target.
- Global Codex install is previewed and only applied after explicit approval.
- Safe hook event capture writes to local SQLite for bootstrapped repo.
- Hooks do not mutate curated wiki memory.
- Real fixture outcome is explicit: redacted fixture file written or owned follow-up recorded.

## Risks And Rollback

- Risk: real `~/.codex` mutation affects active Codex behavior. Mitigation: explicit approval gate, backups, and uninstall command.
- Rollback: run `bun src/cli.ts uninstall --provider codex` to remove Myelin-owned Codex entries; use backups under `~/.codex/.myelin/backups/` if manual recovery is needed.
- Risk: raw SQLite contains sensitive prompt text. Mitigation: `state/memory.db` is gitignored; do not copy raw rows into tracked files.

## Non-Goals

- Do not ingest raw rows into curated memory.
- Do not run LLM promotion workflows.
- Do not capture real private work content as fixtures.
- Do not verify Claude/Gemini providers.

## Type And Name Consistency

- Project key: `class-kit`.
- Repo path: `/Users/liadgoren/Repositories/class-kit`.
- Provider: `codex`.
- Source: `codex-hook`.
- Verification log: `docs/design/2026-06-12-project-brain-bootstrap-codex-hooks/verification/class-kit-codex-capture.md`.
