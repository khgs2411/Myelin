# Chunk 04: Provider Reconciliation And Conservative Removal

**Plan Set:** ../plan.md
**Approved Source:** ../spec.md
**Status:** Ready for Review
**Depends on:** Chunk 03
**Enables:** Chunks 05, 06, and 08

## Goal

Complete the unified public machine lifecycle by composing Capture Provider actions into the launcher/locator transaction. Implement deterministic provider detection and selection, preservation of unselected recorded providers, provider-only uninstall, full uninstall, backups, and ownership-safe removal. Codex is the only implemented Capture Provider.

## Source Artifacts And Constraints

- Bare install includes exactly one detected supported provider; none means command-only with warning; several means stop for explicit selection.
- Repeatable `--provider <name>` selects only named providers. `--provider codex` is supported; no `--codex` flag.
- Explicit unavailable provider fails before apply.
- `--command-only` and explicit provider install preserve already recorded unselected providers.
- Only provider-scoped uninstall or full uninstall removes provider integrations.
- Preserve unrelated hooks and unexpected contents; hash/ownership mismatch blocks destructive action.
- This chunk owns lifecycle changes in `src/install/codex.ts`; Chunk 05 later owns only its invocation argv.

## Relationships

- Extends the journal, locator, and base service from Chunk 03 rather than creating provider-specific installers.
- Hands stable Codex ownership paths to Chunk 05 for invocation-only migration.
- Completes provider facts consumed read-only by Chunk 06.

## File Responsibility Map

### Create

- `src/install/provider-registry.ts` — supported provider registry, detection, explicit-selection validation, and adapter lookup.
- `tests/install/provider-registry.test.ts`

### Modify

- `src/commands/install.ts` — repeatable provider selection and provider-scoped uninstall parsing.
- `src/install/types.ts` — provider adapter/action/ownership types and provider-aware manifest composition.
- `src/install/install-service.ts` — reconcile provider actions in the unified plan/journal/apply/uninstall transaction.
- `src/install/codex.ts` — contribute owned hook/shim/manifest actions, backups, and conservative removal.
- `tests/commands/install.test.ts`
- `tests/install/install-service.test.ts`
- `tests/install/codex.test.ts`

### Test

- `tests/install/provider-registry.test.ts`
- `tests/install/install-service.test.ts`
- `tests/install/codex.test.ts`
- `tests/commands/install.test.ts`

## Behavioral And Contract Changes

- Provider adapters plan owned actions; the central service owns ordering, locator composition, journaling, backup records, and full uninstall.
- Bare install selection follows the exact 0/1/many detection rule.
- Explicit selection validates provider support and availability before any journal or filesystem mutation.
- Provider actions update the locator provider map only after their owned artifacts are durable.
- Provider-only uninstall removes verified named provider hook/shim/manifest state, retains launcher/locator and other provider records, and requires `--apply`.
- Full uninstall removes all verified recorded provider integrations, then launcher and locator, with the locator removed last.
- Codex hook edits preserve unrelated entries and back up changed shared files; uninstall removes only Myelin-owned hook entries.
- Missing owned artifacts are reported idempotently; changed/unexpected artifacts block deletion and remain available for operator review.

## Implementation Tasks

- [ ] Write provider-registry tests for no providers, exactly Codex, multiple simulated providers, unsupported names, repeatable selection, and explicitly unavailable Codex.
- [ ] Add a table-driven preservation matrix covering: bare install; explicit provider install; command-only repair; provider-only uninstall; full uninstall.
- [ ] In every matrix row, assert selected providers, preserved recorded providers, removed providers, launcher/locator outcome, and preview/apply parity.
- [ ] Adapt Codex planning to return typed actions and ownership evidence instead of operating as a separate lifecycle.
- [ ] Preserve unrelated `hooks.json` entries byte-for-byte or structurally according to the existing adapter contract and record backups for shared-file changes.
- [ ] Compose provider desired state with existing manifest records so unselected integrations survive repair/reinstall.
- [ ] Implement provider-only uninstall ordering and manifest-last update.
- [ ] Complete full uninstall ordering across provider artifacts, launcher, journal, and locator.
- [ ] Add hash mismatch, missing artifact, unexpected hook contents, interrupted provider apply, and interrupted provider uninstall recovery tests.
- [ ] Confirm checkout configuration, secrets, canonical markdown, SQLite, logs, runs, and unrelated provider files remain untouched.
- [ ] Freeze `src/install/codex.ts` ownership behavior for sequential handoff to Chunk 05.

## Verification

- `bun test tests/install tests/commands/install.test.ts`
  - Expected: selection, preservation matrix, provider/full uninstall, backup, collision, and recovery cases pass.
- `bun test tests/install/install-service.test.ts --test-name-pattern "preserve|provider|uninstall|command-only"`
  - Expected: every public lifecycle mode has explicit preservation/removal assertions.
- `bun run typecheck`
  - Expected: adapters cannot bypass the central action/ownership model.
- `git diff --check`
  - Expected: no whitespace errors.

## Acceptance Criteria Covered

- Bare install defaults deterministically to Codex only when it is the single detected provider.
- `--provider codex` and `--command-only` behave as approved.
- Full and provider-only uninstall remain preview-first and ownership-safe.
- Unselected providers, unrelated hooks, and canonical checkout state are preserved.
- Launcher and provider setup form one lifecycle.

## Risks, Rollback, And Isolation

- Shared provider configuration can contain unrelated user data. Treat provider edits as merge/remove-owned-entry operations with backups, never replacement.
- Provider map loss during repair would make later uninstall unsafe. Matrix tests must begin from manifests with recorded unselected providers.
- All automated mutations use temporary provider/home roots; real provider directories remain untouched.

## Non-Goals

- Claude capture integration or speculative provider APIs.
- Changing Codex shim argv; Chunk 05 owns that.
- Operational status implementation.
- Public bootstrap distribution or Step 11 dogfood.

## Consistency Check

- Completes the single lifecycle established by Chunk 03 without creating provider-specific install commands.
- Implements the approved preservation rule and full/provider-only uninstall distinction.
- Preserves the explicit `src/install/codex.ts` handoff: lifecycle here, invocation only in Chunk 05.
