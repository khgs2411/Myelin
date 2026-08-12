# Destructive operations

Destructive Myelin operations are explicit CLI actions that either delete only recorded-owned artifacts or replace project/derived state after preview, confirmation, and coverage checks appropriate to their boundary.

The inspected checkout is the `llm-wiki` project on `master` at `78cc13dfcc73145db780b80c38c7d247efd9eca9`; its registered root and origin are recorded in [repository-identity.json](../repository-identity.json). The current implementation, rather than historical plans, is the evidence for the behavior below.

## Project shell reset

`myelin project reset <project-key> --clean --confirm <project-key> [--json]` is the destructive administration operation for one registered project shell (`src/commands/project.ts`). It refuses every other form: the project key must be present, `--clean` must be supplied, and the confirmation value must exactly equal that key. There is no preview mode.

After locating the registered project and its first configured repository path, `ProjectResetService.cleanRebootstrap` deletes exactly these project-scoped paths, then bootstraps the project from that repository path (`src/project/project-reset-service.ts`):

- `projects/<key>/` — curated Project Memory markdown;
- `state/<key>/` — project-local machine state;
- `sources/<key>/` — preserved project sources; and
- `runs/<key>/` — project run artifacts and logs.

The authority boundary is enforced before deletion: the project directory must resolve beneath the root `projects/` directory, and a project without a repository path cannot be reset. The reset result reports `reset_scope: "project_shell"`, all deleted paths, the preserved database path, and `bootstrap_status: "rebootstrapped"`. Root `state/memory/memory.db` is deliberately outside the deletion set; if it existed before reset and disappears, the service errors. The reset test proves old wiki and project state are removed while that root database and a fresh bootstrap state remain (`tests/commands/project.test.ts`). Consequently, project-shell content is irrecoverably removed unless separately backed up, while root Session Memory serving state is preserved.

## Machine installation, rollback, prune, and uninstall

The installation surface (`src/commands/install.ts`, `src/install/install-service.ts`) controls a machine launcher, machine locator/ownership record, immutable version store, and optional Codex integration. `install` and `uninstall` are preview-first: omitting `--apply` only returns a plan; `--apply` performs its listed mutations. Plans expose operation, mode, launcher/locator/store paths, active and previous version, PATH state, and warnings.

Installation will not overwrite an unowned launcher, repair a launcher whose recorded hash mismatches (including a symlink), switch an owned launcher or V2 store to a different path, or rebind to another data root without `--rebind --apply`. An incomplete install journal must match the requested operation, roots, launcher, and locator before it can resume; otherwise it blocks a new install or uninstall. A failed activation restores the previous locator, or removes the incomplete first installation. These checks make the locator and recorded hashes—not path names alone—the authority for machine removal.

`myelin install --rollback [--apply]` has only preview/apply modes and may not be combined with rebind, command-only, bin-dir, prune, or provider selection. It is available only to a managed V2 installation with a recorded previous immutable version. Apply verifies that version, atomically swaps active and previous locator entries, and verifies activation through the stable launcher; it does not delete a version. The regression test confirms both the preview actions and the swapped active/previous identities (`tests/install/install-service.test.ts`).

`myelin install --prune [--apply]` removes inactive *owned* immutable versions. A normal upgrade retains the active version plus one previous rollback version; explicit prune updates the locator so `previous_version` is null and retains only the active version. This is irreversible for pruned versions and removes their rollback path. The service also prunes obsolete owned versions during upgrades while retaining the active and previous IDs.

`myelin uninstall [--apply] [--provider codex]` accepts no other options. With `--provider codex`, it removes only a verified recorded Codex integration, writes the reduced provider set to the locator, and preserves the launcher and version store. Without a provider selector, it first removes all verified recorded provider integrations, then removes an owned launcher (only if the hash remains valid), the locator, and, for V2, manifest-owned immutable versions. An absent locator with an existing unowned launcher is refused; changed/symlink launchers and provider ownership mismatches are also refused. Uninstall does not remove the checkout, `myelin.config`, project markdown, run artifacts, or root memory database, as verified by `tests/install/install-service.test.ts`. Preview and apply behavior, including provider-only preservation, are covered by `tests/commands/install.test.ts` and `tests/install/install-service.test.ts`.

## Embedding contract rollback and retirement

`myelin memory embeddings rollback [--apply] [--json]` and `myelin memory embeddings prune [--apply] [--json]` operate on two independently evaluated scopes: `session_memory` and `project_memory` (`src/commands/memory.ts`, `src/memory/embedding-contract-lifecycle-service.ts`). Both default to preview; `--apply` is the mutation authority. Unknown lifecycle options fail parsing.

For rollback, each scope is `rollback` only when it has a `previous` contract; otherwise its action is `none`. Apply changes each rollback-eligible scope in a transaction: current `active` becomes `previous`, its prior `previous` becomes `active`, and any old active is first moved to `staging`. It is a reversible contract swap, not deletion; a later rollback can swap the pair again. The store rejects removal of `active` and `previous` contracts (`src/memory/embedding-contract-store.ts`).

Prune identifies every inactive registered contract except the scope's active and previous IDs, plus historical embedding metadata whose identity is not registered or protected. Candidate lifecycle can therefore be retired/staging/failed or `historical`. On apply it first requires active-contract coverage for every scope represented by candidates:

- for `session_memory`, every `active` memory must have an indexed retrieval embedding under the active contract;
- for `project_memory`, every canonical markdown section below the top-level heading must have an indexed active-contract retrieval embedding.

Missing active contracts or incomplete coverage aborts before the transaction. Once protected, prune deletes candidate embedding metadata and query-embedding cache rows; it deletes a candidate's owned vector table when applicable, otherwise its owned vector rows, and removes the unprotected registered contract. This permanently discards retired/failed historical derived state and may eliminate the ability to retrieve through it. Tests demonstrate a successful historical/failed cleanup while retaining active rows, and refusal when one active memory lacks active indexing (`tests/memory/embedding-contract-lifecycle-service.test.ts`).

## Failed ingest-job resolution

`myelin ingest jobs resolve <project-key> (--id <job-id> | --all) --reason <text> [--code <error-code>] [--dry-run] [--json]` is administrative state resolution, not retry or deletion (`src/commands/ingest.ts`). The command requires exactly one target form and a non-empty reason. It selects only jobs for that project whose current status is `failed`; repeated `--id` values target named failed rows, while `--all` selects every failed row. Optional `--code` further filters by `error_json.code`. Non-failed, other-project, and nonmatching-code rows are not touched.

`--dry-run` returns the matched rows with `dry_run: true` and makes no change. Without it, `IngestJobAdminService.resolveFailed` changes each selected failed job to `completed`, clears the active `error_json`, writes a terminal summary containing the operator reason, and retains audit data under `followup_state_json.resolved_failed_job` (resolution time, reason, and previous error). This is a user-visible terminal-state override: it resolves the failed job administratively but does not restore or rerun its work. The tests cover code-filtered dry runs, explicit target/reason validation, and the completed row's preserved resolution metadata (`tests/commands/ingest.test.ts`).

## Known gaps

- The inspected tests cover command/service outcomes and safety gates, but do not demonstrate an end-to-end real-provider uninstall, embedding migration/prune, or detached-ingest resolution run outside test fixtures.
- Project reset has no preview mode by design; operators must rely on its exact key confirmation and reported deletion scope before invoking it.
