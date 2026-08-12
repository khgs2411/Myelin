# Installation and capture integration

Installation provides a preview-first, machine-scoped launcher and immutable runtime lifecycle, while the Codex provider integration converts selected hook events into durable Experience Log evidence for registered projects.

## Machine installation

`myelin install` plans changes by default; `--apply` is the only mode that writes machine artifacts. The rendered plan exposes the operation, mode, Myelin data root, source root, launcher, locator, version store, active and previous versions, PATH diagnosis, actions, and warnings ([`src/commands/install.ts`](../target-repo/src/commands/install.ts), [`src/install/types.ts`](../target-repo/src/install/types.ts)). The default entrypoint script delegates to this lifecycle through `./install` / `./install --apply` ([`install`](../target-repo/install)).

The machine locator is the authority boundary. It records the data root, stable launcher hash and path, active and previous immutable versions, version-store root, and installed provider ownership. By default, the launcher is `~/.local/bin/myelin`, the locator and resumable transaction journal are under `~/.myelin/`, and immutable versions are under `~/.local/share/myelin`; a custom absolute `--bin-dir` changes only the launcher destination ([`src/install/install-service.ts`](../target-repo/src/install/install-service.ts), [`src/install/machine-locator.ts`](../target-repo/src/install/machine-locator.ts)). The locator and its directory are written with restrictive permissions, and the launcher is copied rather than symlinked.

The stable launcher reads the locator on every invocation, checks that the recorded roots are absolute existing directories, sets installed-invocation context, and runs `src/cli.ts` from the locator's active runtime. Thus the checkout/data root can remain separate from the executable runtime, and changing the active version is a locator update rather than an in-place runtime overwrite ([`src/install/launcher.ts`](../target-repo/src/install/launcher.ts)).

### Install choices and gate order

| Request or condition | Outcome |
| --- | --- |
| `install` without `--apply` | Returns a preview and makes no machine writes. |
| `install --apply` | Journals and executes the planned install, then verifies the activated immutable version through the stable launcher. |
| `--command-only` | Installs/repairs the launcher and runtime only; it cannot be combined with `--provider`. Existing provider records are retained. |
| No provider option | Selects the sole detected supported provider; no provider installs command-only with a warning; more than one provider requires explicit `--provider`. |
| Explicit `--provider codex` | Requires that Codex is both supported and detected; otherwise it fails before journaling or mutation. Duplicate selections are coalesced. |
| Custom `--bin-dir` | Must be absolute. An existing locator prevents targeting a different launcher path. |
| Existing locator points at another data root | Preview identifies `rebind`; apply is refused until `--rebind --apply` explicitly consents. |
| Missing launcher recorded by locator | It may be repaired. An unowned launcher, symlink, or hash mismatch is never overwritten or removed. |
| Changed runtime bytes | A new installation requires a greater semantic package version; use rollback rather than an install downgrade. |
| `--rollback` | May be previewed or applied, but cannot be combined with rebind, command-only, bin-dir, prune, or provider options. It requires a managed V2 locator and recorded previous version; apply swaps active and previous versions after verification. |

These gates are ordered to protect ownership before mutation: command argument validation and provider eligibility happen before a journal is written; locator ownership constrains launcher and store paths; artifact/hash checks block overwrite; rebind requires explicit consent; only then is the immutable snapshot planned, journaled, promoted, and activated ([`src/commands/install.ts`](../target-repo/src/commands/install.ts), [`src/install/install-service.ts`](../target-repo/src/install/install-service.ts), [`src/install/provider-registry.ts`](../target-repo/src/install/provider-registry.ts)). PATH is diagnostic only: a missing bin directory produces a warning and `PATH active: no`; installation does not edit shell configuration.

### Immutable versions and recovery

An installed version is a content-addressed copy of the runtime artifacts (`src`, optional `vendor`, `node_modules`, `package.json`, and `bun.lock`) with a version manifest. Staging verifies content before atomic promotion, rejects symlinks escaping the snapshot, and re-verifies the promoted manifest and content digest ([`src/install/version-store.ts`](../target-repo/src/install/version-store.ts)). Upgrades preserve the immediately previous managed version for rollback; normal upgrades prune older owned versions, and `install --prune --apply` removes every inactive manifest-owned version and clears the rollback record.

Apply work is recorded in an install journal with pending/completed actions. A matching later command resumes an incomplete transaction; a different operation is refused until recovery. If activation verification fails after an upgrade, the previous locator is restored. If it fails on a first install, the incomplete launcher, provider integration, locator, and staged managed versions are removed while the source checkout/data root remains intact ([`src/install/install-journal.ts`](../target-repo/src/install/install-journal.ts), [`src/install/install-service.ts`](../target-repo/src/install/install-service.ts)).

## Codex hook capture

The supported capture-provider value is `codex`. Installation adds one owned command hook for each of Codex's `SessionStart`, `UserPromptSubmit`, and `Stop` events, via a provider-local shim that calls the stable launcher as `myelin capture codex-hook`. The provider's `hooks.json` is merged rather than replaced; the pre-change file is backed up when changed, and an ownership manifest plus hashed shim are stored under the provider's `.myelin/` directory ([`src/install/codex.ts`](../target-repo/src/install/codex.ts)).

`capture codex-hook` consumes JSON from stdin. It is intentionally fail-open: disabled capture (`MYELIN_CAPTURE_DISABLED=1`), malformed input, normalization errors, storage errors, and scheduler errors do not interrupt the provider session ([`src/commands/capture.ts`](../target-repo/src/commands/capture.ts), [`src/capture/capture-service.ts`](../target-repo/src/capture/capture-service.ts), [`src/capture/facade.ts`](../target-repo/src/capture/facade.ts)).

| Codex payload condition | Normalized Experience Log outcome |
| --- | --- |
| `SessionStart` | Valid `session.start` event; subsequent auto-maintenance scheduling is forced to perform a bounded ingest attempt. |
| `UserPromptSubmit` with string `prompt` | Valid `user.prompt` event containing the prompt text. |
| `Stop` with nonblank `last_assistant_message` | Valid `assistant.response` event containing that message. |
| Empty `Stop`, unknown hook, or malformed payload | Invalid evidence with raw JSON retained; no event kind or raw text is synthesized. |
| Missing `cwd`, or `cwd` not within a registered project repository | Dropped as an unregistered-repository no-op. |
| Registered repository | Stored with project key, provider/session/turn metadata, raw payload, and best-effort Git branch, commit, and worktree context. |
| Storage failure | Returns failed-open and records an error in SQLite when possible, otherwise in `state/hook-errors.jsonl`. |

Capture first normalizes external provider data, then resolves the project from `cwd`, derives Git context from the matching configured repository, persists the raw normalized event, and only afterward schedules automatic Session Memory maintenance. Scheduler failure is swallowed to preserve hook availability ([`src/capture/providers/codex.ts`](../target-repo/src/capture/providers/codex.ts), [`src/capture/facade.ts`](../target-repo/src/capture/facade.ts), [`src/capture/git-context.ts`](../target-repo/src/capture/git-context.ts)). A Codex `Stop` is therefore an assistant-turn event, not a declaration that the session has ended.

## Safe removal and irreversible effects

`myelin uninstall` is also preview-first. `uninstall --apply --provider codex` removes only the verified Codex hook entries, shim, and ownership manifest, then updates the locator; it preserves the launcher, immutable store, and other providers. Full `uninstall --apply` removes recorded providers first, then a verified launcher, the locator, and managed immutable versions. It does not delete the source checkout, project markdown, database, configuration, or run artifacts ([`src/install/install-service.ts`](../target-repo/src/install/install-service.ts)).

Removal remains conservative at each transition:

- A launcher without a locator, a symlink launcher, or a changed launcher hash is treated as unowned and is retained.
- Provider uninstall requires the provider to be recorded in the locator and its inspected ownership paths to exactly match that record. A malformed manifest, unexpected command, unowned shim, or shim hash mismatch aborts removal.
- Version pruning deletes only directories with a valid manifest whose version ID matches the directory name. Unknown/operator-owned version directories survive. Store-root removal removes managed versions and staging, then removes only now-empty managed directories ([`src/install/version-store.ts`](../target-repo/src/install/version-store.ts)).

Both provider removal and version pruning are destructive once applied: removed hooks stop capture, removed immutable versions cannot be rolled back to, and full uninstall removes the global `myelin` command. Preview exposes these actions before the destructive transition; backups preserve the prior Codex hook file when it was rewritten, but do not make removed runtime versions or the launcher recoverable without a later installation.

## Evidence and known gaps

Regression coverage exercises preview/apply boundaries, option conflicts, provider selection, rebind consent, ownership/hash refusals, journal recovery, failed-activation rollback/cleanup, immutable version retention and pruning, provider-only removal, and source-checkout preservation ([`tests/commands/install.test.ts`](../target-repo/tests/commands/install.test.ts), [`tests/install/install-service.test.ts`](../target-repo/tests/install/install-service.test.ts), [`tests/install/version-store.test.ts`](../target-repo/tests/install/version-store.test.ts)). Capture tests cover all normalized Codex event cases, routing/drop behavior, Git metadata, invalid-evidence preservation, maintenance scheduling, and fail-open error logging ([`tests/capture/providers/codex.test.ts`](../target-repo/tests/capture/providers/codex.test.ts), [`tests/capture/facade.test.ts`](../target-repo/tests/capture/facade.test.ts), [`tests/capture/capture-service.test.ts`](../target-repo/tests/capture/capture-service.test.ts)).

The supplied checkout snapshot lacks `repository-identity.json`; no assertion here identifies its remote, branch, or repository identity. The inspected tests are fixture/service coverage rather than an end-to-end run against a live Codex hook installation and shell PATH configuration.
