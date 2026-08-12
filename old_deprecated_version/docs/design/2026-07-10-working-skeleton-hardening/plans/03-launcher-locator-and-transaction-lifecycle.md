# Chunk 03: Launcher, Locator, And Transaction Lifecycle

**Plan Set:** ../plan.md
**Approved Source:** ../spec.md
**Status:** Ready for Review
**Depends on:** Chunk 02
**Enables:** Chunks 04, 06, and 08

## Goal

Implement the command-only machine lifecycle: root `install`, a copied launcher, fixed versioned locator/ownership manifest, recoverable journal, preview/apply/reapply/rebind/uninstall foundations, collision protection, permissions, and PATH reporting. This is an intermediate infrastructure milestone; Chunk 04 must compose provider reconciliation before the unified public lifecycle is complete.

## Source Artifacts And Constraints

- Use root installer filename `install`.
- Default launcher path is `~/.local/bin/myelin`; locator and journal remain fixed at `~/.myelin/install.json` and `~/.myelin/install-journal.json` even with `--bin-dir`.
- Launcher is copied, mode `0755`, not symlinked; `~/.myelin` is `0700`; locator/journal are `0600`.
- `install.json` schema version 1 is both locator and ownership record; it is promoted last.
- No force overwrite. Unowned collisions or owned hash mismatches block.
- Preview is default; only `--apply` writes. Tests inject home/bin/locator roots and never write the real user home.
- Remove `package.json`'s private `bin` registration so it cannot compete with this installer.

## Relationships

- Receives context-wired `src/commands/install.ts` from Chunk 02.
- Establishes the transaction and manifest model that Chunk 04 extends with provider actions.
- Supplies installation facts later observed by Chunk 06.
- Does not modify provider hooks or claim final lifecycle acceptance.

## File Responsibility Map

### Create

- `install` — repo-root bootstrap that delegates to the same CLI install service.
- `src/install/machine-locator.ts` — schema-1 parse, validate, serialize, permissions, and atomic promotion.
- `src/install/install-journal.ts` — journal schema, action state, recovery compatibility, and durable cleanup.
- `src/install/launcher.ts` — deterministic launcher content, hash, validation, and ownership inspection.
- `tests/install/machine-locator.test.ts`
- `tests/install/install-journal.test.ts`
- `tests/install/launcher.test.ts`
- `tests/install/repo-installer.test.ts`

### Modify

- `package.json` — remove the private `bin` path while retaining contributor scripts.
- `src/commands/install.ts` — add preview/apply, rebind, bin-dir, command-only, and base uninstall parsing against the shared service.
- `src/install/types.ts` — typed owned artifacts, plan/actions, locator, journal, collision, and result vocabulary.
- `src/install/install-service.ts` — plan/apply/recovery for command-only install and base full-uninstall artifacts.
- `tests/commands/install.test.ts`
- `tests/install/install-service.test.ts`

### Test

- All files under `tests/install/` plus `tests/commands/install.test.ts`.

## Behavioral And Contract Changes

- Root `./install` and `myelin install` delegate to one service and preview the same desired command-only state.
- `--apply` creates or repairs owned artifacts idempotently; repeated apply converges without timestamp-only churn except the specified update record.
- Rebinding to another checkout is shown in preview and requires `--rebind` on apply.
- Locator records absolute root, launcher path/hash, empty provider map for command-only state, timestamps, and nullable source revision.
- Journal is durable before mutation and records transaction id, operation, desired manifest, action states, ownership hashes, and backup paths.
- Atomic promotion order is launcher temp/write/rename first and locator last; journal removal occurs only after durable completion.
- Matching interrupted operations resume; a different operation is blocked until recovery completes.
- Missing recorded launcher is repairable; mismatched launcher hash blocks repair/uninstall; launcher without locator is unowned and untouched.
- Preview/apply reports whether the selected bin directory is currently on PATH and names the required operator action if not.
- Uninstall foundations remove only verified launcher/locator lifecycle artifacts and never checkout data.

## Implementation Tasks

- [ ] Add temp-root fixtures that isolate home, bin, locator, journal, and checkout paths.
- [ ] Add exact locator/journal schema validation, mode, hash, and incompatible-version tests.
- [ ] Add launcher content tests for locator discovery, cwd preservation, missing/malformed locator, missing/moved root, and non-symlink installation.
- [ ] Define typed plan actions and deterministic preview output before mutation logic.
- [ ] Implement journal-first apply with temp files and atomic rename where supported.
- [ ] Add failure injection before launcher promotion, before locator promotion, and after launcher promotion but before manifest completion; prove matching resume converges.
- [ ] Implement unowned-path, hash-mismatch, missing-launcher repair, and different-operation recovery blocks.
- [ ] Implement explicit rebind preview/apply behavior and source revision capture when available.
- [ ] Implement PATH inspection/reporting without modifying shell profiles.
- [ ] Add root `install`, ensure it delegates rather than duplicating lifecycle logic, and test preview/apply forwarding.
- [ ] Mark the root `install` entrypoint executable in the repository and assert its mode in the installer test.
- [ ] Remove `package.json` `bin` and update tests that previously assumed package-link installation.
- [ ] Prove uninstall preserves `myelin.config`, `.env`, `projects/`, `state/memory.db`, logs, runs, and unrelated files.

## Verification

- `bun test tests/install tests/commands/install.test.ts`
  - Expected: preview/apply/reapply/rebind/recovery/collision/permission/PATH cases pass in temporary roots.
- `bun test tests/install/install-service.test.ts --test-name-pattern "failure|resume|journal|promotion"`
  - Expected: all three required failure-injection boundaries leave recoverable state and matching apply converges.
- `bun run typecheck`
  - Expected: lifecycle actions and schema records are exhaustively typed.
- `test ! -L install`
  - Expected: repository installer is a regular executable file, not a symlink.
- `test -x install`
  - Expected: repository installer has executable mode.
- `git diff --check`
  - Expected: no whitespace errors.

## Acceptance Criteria Covered

- A copied global launcher binds to one checkout through `~/.myelin/install.json`.
- Install and uninstall are preview-first and recoverable.
- Reapply converges; rebind is explicit; ownership conflicts block safely.
- Installation preserves canonical memory, configuration, and checkout data.
- PATH limitations are reported honestly.

## Risks, Rollback, And Isolation

- Highest risk is interruption between launcher and locator promotion. Journal tests must make every boundary observable and resumable.
- Filesystem mode behavior is macOS/Bun-first; test actual modes without expanding to Linux/Windows bootstrap work.
- Rollback in development uses only injected temporary roots. Real-home mutation requires separate explicit approval.

## Non-Goals

- Final provider auto-detection, selection, preservation, or removal.
- Provider hook invocation changes.
- Public curl acquisition or shell-profile edits.
- Status rendering or Step 11 external dogfood.

## Consistency Check

- Matches ADR 0068 and the approved fixed locator, copied launcher, and manifest-last recovery design.
- Explicitly remains an intermediate command-only milestone; Chunk 04 completes the unified lifecycle.
- Preserves the sequential handoff from Chunk 02 to Chunk 04 and introduces no second installation product.
