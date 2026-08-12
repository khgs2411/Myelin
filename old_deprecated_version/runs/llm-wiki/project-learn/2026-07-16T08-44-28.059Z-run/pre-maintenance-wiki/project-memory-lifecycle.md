# Project Memory lifecycle

Project Memory moves a registered software repository from an uncurated shell to canonical markdown, then keeps that markdown current through isolated, validated runs.

## Bootstrap and the project shell

`myelin bootstrap <project-key> --repo <absolute-path>` is the registration boundary. `src/runtime/bootstrap.ts` accepts only lowercase keys containing letters, digits, `_`, or `-`; resolves and requires an existing absolute directory; and rejects a repository path already registered to a different project. It repairs rather than replaces the shell, writes or preserves `state/<key>/project.json`, and merges the resolved repository path into `repo_paths`.

Bootstrap creates or preserves these project-scoped roots: `projects/<key>/`, `state/<key>/`, `sources/<key>/` (including `inbox/`), and `runs/<key>/`. Its initial `projects/<key>/index.md` says the memory is not curated, while `bootstrap-state.json` has status `uncurated` and records missing `curated_project_memory` and `experience_log_capture_verification`. Re-running bootstrap is intentionally idempotent: it preserves existing curated pages and source material instead of overwriting them (`src/runtime/project-shell.ts`; `tests/runtime/bootstrap.test.ts`).

The authority boundary is explicit: bootstrap registers a repository and establishes the storage shell; it does not author canonical Project Memory. `myelin project learn <key>` is the authoring path. This separation prevents a registration operation from silently rewriting curated knowledge.

## Learn: create, maintain, recreate, and resume

`myelin project learn <key>` is the supported operator workflow for authoring and maintaining canonical Project Memory (`src/commands/project.ts`, `src/project/project-memory-curator-service.ts`). Before an ordinary run, it repairs the shell, verifies or builds schema context, reconciles prior source consumption, intakes the runtime inbox, and writes an immutable input packet into a new `runs/<key>/...` directory. Blocking source-reconciliation or inbox-intake failures stop the run before canonical writes.

Mode selection is state-driven, with `--recreate` taking precedence:

| Condition | Curator mode | Run kind | User-visible outcome |
| --- | --- | --- | --- |
| `--recreate` | `create` | `recreate` | Rebuilds the documentation draft and publishes it as a create run. |
| No `--recreate`, `state/<key>/project-memory.json` is `curated` | `maintain` | `maintenance` | Starts from the current canonical wiki and processes pending project sources. |
| No `--recreate`, Project Memory is not `curated` | `create` | `create_then_maintenance` | Builds a subject manifest and draft wiki, then runs maintenance before publication. |
| `--resume <run>` | `create` | `create_then_maintenance` | Reuses a verified create checkpoint and continues with maintenance. |

`--resume` is exclusive: it cannot be combined with `--dry-run`, `--review`, or `--recreate`. Resume first rejects incomplete canonical apply journals, then requires a valid source-run checkpoint whose project, repository, packet, and schema-context inputs still verify. A missing or invalid checkpoint requires a fresh `project learn`; it is not treated as a best-effort restart.

Create produces a subject manifest, planner report, subject reports, a pre-maintenance draft, and a checkpoint. Maintenance always receives pending project candidates and handoffs from the packet. For each pending source its report must choose exactly one supported disposition: `applied_to_project_memory`, `already_covered`, `insufficient_evidence`, `not_durable`, `belongs_to_other_layer`, `deferred_unsafe_change`, or `blocked_by_runner_failure` (`src/project/project-memory-agent-contracts.ts`). This is the durable-knowledge gate: unverified, ephemeral, unsafe, or other-layer material is recorded with a disposition rather than silently folded into Project Memory.

`--dry-run` validates and records run artifacts but stops before canonical publication; `--review` likewise stops before writes and returns `needs_review`. A successful publication returns `completed`; successful canonical writes whose retrieval index remains unavailable return `completed_with_pending_index`, leaving Project Memory usable but its retrieval readiness pending. Failures return `failed`; create-stage or publication failures that retain a valid checkpoint may return a resume command.

## Packets and administration

`myelin project packet <key> [--json]` is a read-only inspection surface. It assembles project registration, bootstrap/Project Memory/freshness/page state, canonical markdown and extracted sections, pending project handoffs and candidates, selected Session Memory, and lookup results (`src/project/project-memory-packet.ts`). Packet mode is `maintain` when either `project-memory.json` or `bootstrap-state.json` reports `curated`; otherwise it is `create`.

Packet degradation is explicit. An empty wiki, an unavailable `state/memory/memory.db`, or blocking lookup-quality reasons mark `degraded` and enumerate `degraded_reasons`; the command still exposes the packet rather than pretending those inputs exist. Session Memory selection is limited to 10 items, pending handoffs and candidates to 20 each, and lookup input queries to 25.

`myelin project list [--include-legacy] [--json]` inventories registered project shells. By default it lists only `active` projects; `--include-legacy` also returns `legacy` and `deprecated` lifecycle entries. It exposes each key, display name, lifecycle, and registered repository paths, not the contents of a repository.

`myelin project migrate-layout <key>` is the administrative migration boundary. It creates required current roots, moves legacy wiki/state/source/run/log locations, relocates the root memory database to `state/memory/`, rewrites recorded state and retrieval paths, and rewrites repository-identity links (`src/runtime/layout.ts`). It refuses destination collisions and reports every `created-dir`, `moved`, `updated-state`, `kept`, or `removed` action. Migration can remove only generated scaffolding, `.DS_Store`, and empty legacy directories; nevertheless, it is a state-transforming operation and should be run only after reviewing its action result.

## Publication authority and safeguards

Agents author only a run-local draft. `promoteDraftWiki` is the authority boundary that turns that draft into canonical state (`src/project/project-memory-draft-promotion.ts`). It requires at least `index.md`, validates all internal wiki links, requires every planned subject page to be linked from the index, rejects agent-workspace and unsupported ephemeral links, and converts target-repository citations to stable `repo:<path>` text. If repository identity was collected, run-local `repository-identity.json` links are rewritten to `state/<key>/repository-identity.json` during publication.

Publication stages markdown, project state, repository identity, and source-consumption state through the markdown applier and apply journal. A create-mode publication removes stale canonical markdown pages that are absent from the new draft; maintenance does not perform that stale-page sweep. That makes `--recreate` materially more destructive than ordinary maintenance. The apply journal supports recovery: an ordinary later learn first recovers an incomplete journal instead of starting a competing update.

## Project-shell reset

`myelin project reset <key> --clean --confirm <key> [--json]` is the explicit destructive recovery operation. Both `--clean` and an exact confirmation matching the project key are required; otherwise the CLI only returns usage guidance. After locating the registered repository path, `ProjectResetService` confirms that the resolved project path remains under `projects/`, deletes `projects/<key>/`, `state/<key>/`, `sources/<key>/`, and `runs/<key>/`, then bootstraps the shell again (`src/project/project-reset-service.ts`).

The user-visible result has `reset_scope: "project_shell"`, the deleted paths, the preserved root memory database path, and `bootstrap_status: "rebootstrapped"`. Curated markdown, Project Memory state, preserved project sources, runtime inbox items, and run artifacts are irreversibly removed. The root `state/memory/memory.db` is deliberately preserved; the service verifies that an existing database remains after the reset. Reset requires a registered repository path, so it cannot rebootstrap a shell that has lost that authority record.

## Evidence and known gaps

Current behavior is grounded in `src/commands/bootstrap.ts`, `src/commands/project.ts`, `src/bootstrap/bootstrap-service.ts`, `src/project/`, `src/runtime/bootstrap.ts`, `src/runtime/project-shell.ts`, and `src/runtime/layout.ts`, with regression coverage in `tests/commands/bootstrap.test.ts`, `tests/commands/project.test.ts`, `tests/runtime/bootstrap.test.ts`, `tests/runtime/layout.test.ts`, and `tests/project/`.

The required sanitized checkout evidence file `repository-identity.json` is absent from this repository snapshot. Consequently, this page makes no assertion about the checkout's remote, branch, or repository identity; a completed create or maintenance run normally records identity into canonical project state during publication.
