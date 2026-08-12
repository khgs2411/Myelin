# Chunk 08: Operator Docs And Step 10 Acceptance

**Plan Set:** ../plan.md
**Approved Source:** ../spec.md
**Status:** Ready for Review
**Depends on:** Chunks 05 and 07
**Enables:** Roadmap Step 11 external-project dogfood

## Goal

Make the installed `myelin` command the documented operator boundary and prove Step 10 end to end in isolated temporary machine roots. Reconcile README, CLI, implementation-alignment, Make, and roadmap evidence without mutating the real user home or performing Step 11 Class Kit/Droplet Bot dogfood.

## Source Artifacts And Constraints

- Operator examples use `myelin`; `bun src/cli.ts` remains only in contributor/source guidance.
- Make is checkout-local convenience, not the public product boundary.
- Automated install/uninstall acceptance injects temporary HOME, bin, locator, provider, checkout, and target-repo roots.
- Do not write actual `~/.myelin`, `~/.local/bin`, or `~/.codex` without separate explicit approval.
- Preserve the existing dirty `docs/ROADMAP.md` edits. Review its diff before and after the named Step 10 update.
- Step 11 external invocation from real Class Kit and Droplet Bot remains out of scope.

## Relationships

- Integrates the stable hook/worker invocation from Chunk 05 and status CLI/contract from Chunk 07.
- Closes Step 10 only after all earlier chunk verification passes.
- Enables, but does not execute, Step 11 dogfood.

## File Responsibility Map

### Create

- `tests/acceptance/working-skeleton-hardening.test.ts` — isolated install, cross-cwd invocation, status, repair, and uninstall smoke.

### Modify

- `README.md` — installed-command quick start, install preview/apply, provider selection, status, repair, and uninstall.
- `docs/CLI.md` — complete operator syntax and source/contributor distinction.
- `docs/IMPLEMENTATION_ALIGNMENT.md` — current installed-command, launch-context, lifecycle, and status implementation truth.
- `Makefile` — keep checkout-local aliases coherent with the installed/source boundary and document any source override.
- `docs/ROADMAP.md` — record evidence-backed Step 10 completion/progress without changing Step 11/12 intent or erasing user edits.

### Test

- `tests/acceptance/working-skeleton-hardening.test.ts`
- Full repository Bun test suite and typecheck.

## Behavioral And Contract Changes

- A trusted local clone can run `./install` to preview and `./install --apply` to install the copied command lifecycle.
- Docs show `--provider codex`, bare detection behavior, `--command-only`, `--rebind`, `--bin-dir`, provider-only uninstall, full uninstall, and preview-first semantics.
- PATH warning documentation matches the installer's exact diagnostic and remedy.
- Acceptance invokes the copied launcher from: the Myelin checkout; a registered external fixture repo with omitted key; and an unrelated cwd with explicit key.
- Acceptance proves unrelated cwd without a key fails instead of selecting the first project.
- Acceptance covers source and installed root equivalence across hook, ingest worker, and both maintenance-worker command construction without launching real provider work.
- Acceptance proves status healthy/blocked output, V1 JSON, exit semantics, and read-only content/hash invariants.
- Acceptance proves uninstall removes only recorded machine/provider artifacts and preserves checkout/config/memory/state/unrelated hooks.

## Implementation Tasks

- [ ] Capture and review `git diff -- docs/ROADMAP.md` before editing; identify pre-existing user lines that must survive.
- [ ] Add an isolated acceptance harness with temp HOME/bin/locator/Codex/target directories and deterministic config/database fixtures.
- [ ] Exercise repo-root install preview/apply/reapply, command-only and explicit Codex paths, PATH warning, moved-root/rebind diagnostics, repair, provider-only uninstall, and full uninstall.
- [ ] Invoke the copied launcher from all three required cwd classes and assert authoritative root plus project-resolution behavior.
- [ ] Assert hook and detached-worker argv use the same root/absolute executable while preserving target cwd and capture-disable env.
- [ ] Run human and JSON status fixtures through the installed launcher; assert V1 exactness, parity, exit codes, and no mutations by content/hash with mtimes as secondary evidence.
- [ ] Assert canonical wiki, `projects/`, root SQLite, `myelin.config`, `.env`, runs/logs, and unrelated Codex hooks survive uninstall.
- [ ] Rewrite operator-facing command examples in README and CLI docs; retain a clearly labeled contributor source invocation.
- [ ] Update implementation alignment to describe only implemented, verified behavior.
- [ ] Reconcile Make aliases with the product boundary; retain an explicit checkout-source override if tests/development require it.
- [ ] Update Step 10 roadmap evidence conservatively, then review `git diff -- docs/ROADMAP.md` again and prove all pre-existing edits remain.
- [ ] Run the combined Chunk 05 plus Chunk 06/07 focused suites immediately after their join, before relying on the end-to-end acceptance harness.
- [ ] Run focused acceptance, full tests, typecheck, command-example search, and diff checks.

## Verification

- `bun test tests/acceptance/working-skeleton-hardening.test.ts`
  - Expected: isolated install/cross-cwd/status/uninstall smoke passes without touching real home paths.
- `bun test tests/install/codex.test.ts tests/commands/maintenance.test.ts tests/ingest/runtime.test.ts tests/maintenance/auto-memory-maintenance.test.ts tests/maintenance/auto-project-memory-maintenance.test.ts tests/status/status-inspectors.test.ts tests/status/operational-status-service.test.ts tests/status/status-v1.test.ts tests/status/status-renderer.test.ts tests/commands/status.test.ts`
  - Expected: the parallel invocation and status branches pass together, including the shared liveness export, before end-to-end acceptance.
- `bun test`
  - Expected: complete repository suite passes.
- `bun run typecheck`
  - Expected: no TypeScript errors.
- `rg -n "bun src/cli\.ts" README.md docs/CLI.md docs/IMPLEMENTATION_ALIGNMENT.md`
  - Expected: occurrences are limited to explicitly labeled contributor/source usage.
- `git diff --check`
  - Expected: no whitespace errors.
- `git diff -- docs/ROADMAP.md`
  - Expected: Step 10 evidence is updated, Step 11/12 sequence is unchanged, and pre-existing user edits remain.
- Inspect the acceptance temp-root cleanup assertions.
  - Expected: no path under the real `~/.myelin`, `~/.local/bin`, or `~/.codex` was read for mutation or written.

## Acceptance Criteria Covered

- Operators use `myelin` from checkout, registered external repo, and unrelated cwd without source-command knowledge.
- Install/reapply/rebind/repair/uninstall and provider preservation are proven end to end.
- All Myelin-owned entrypoints share the authoritative root and retain target cwd.
- Operational status is useful, exact, read-only, and automatable.
- Documentation and Make reflect the implemented boundary.
- Step 10 is ready to hand off to Step 11 dogfood.

## Risks, Rollback, And Isolation

- Risk: an acceptance test may resolve the real home through an un-injected path. Fail fast if any computed machine/provider path escapes the temp root.
- Risk: roadmap editing can overwrite user work. Preserve and compare the before/after named-file diff.
- Risk: docs can outrun behavior. Every public example must map to an acceptance or command test.
- Rollback is docs plus isolated test code; real machine state is explicitly excluded.

## Non-Goals

- Installing into the operator's actual home.
- Running real Class Kit or Droplet Bot dogfood.
- Public curl acquisition, Linux/Windows bootstrap, or shell-profile mutation.
- MCP, Current Briefing, Practice Memory, or Personal Memory implementation.

## Consistency Check

- Closes only the approved Step 10 boundary and preserves the roadmap's Step 11/12 sequence.
- Uses the installed command for operators and source invocation only for contributors.
- Requires full repo-native verification and preserves pre-existing `docs/ROADMAP.md` work.
