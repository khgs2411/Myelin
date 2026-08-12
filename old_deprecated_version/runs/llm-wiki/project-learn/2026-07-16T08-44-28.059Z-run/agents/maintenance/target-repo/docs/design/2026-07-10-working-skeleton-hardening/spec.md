# Working Skeleton Hardening Design

Status: Approved — eligible for implementation planning.
Design directory: `docs/design/2026-07-10-working-skeleton-hardening/`
Spec: `docs/design/2026-07-10-working-skeleton-hardening/spec.md`
Agenda: `docs/design/2026-07-10-working-skeleton-hardening/agenda.md`

## Goal And Success Criteria

Roadmap Step 10 turns the existing Myelin loop into an operator product that can be used from another repository without knowledge of the Myelin source checkout's command internals.

The design succeeds when:

- an operator can invoke `myelin` from any working directory without spelling `bun src/cli.ts`;
- command execution resolves the authoritative Myelin root independently from the caller's working directory;
- the caller's working directory remains available for registered-project discovery;
- machine installation and removal are previewable, explicit, idempotent, and limited to Myelin-owned artifacts;
- installed capture hooks and detached workers use the same stable executable/root contract as interactive commands;
- operator documentation describes one real installation and invocation path, while retaining the source form only as a development fallback;
- project operational health is readable without opening SQLite tables, lock directories, maintenance state files, or logs manually;
- human and JSON status outputs report the same underlying facts and actionable degraded states;
- the result is sufficient to start Step 11 external dogfood without depending on the current shell being inside the Myelin checkout.

This design covers all three Step 10 outcomes: installed namespace, operator-documentation reconciliation, and operational health. It does not design the external-project dogfood itself.

## Current Repository Context

### Repository-backed facts

- `package.json` declares `"bin": { "myelin": "src/cli.ts" }`, and `src/cli.ts` has a Bun shebang, but the package is private and the repository does not currently provide a complete machine-install path for that binary.
- The documented operator examples conflict: `docs/CLI.md` says the installed binary is available, while `README.md` still teaches `bun src/cli.ts` as the quick-start path and the `Makefile` hard-codes that source invocation.
- `myelin install` currently previews or applies Codex capture-hook installation only. Its generated shim exports `MYELIN_ROOT` and directly executes `bun <myelin-root>/src/cli.ts capture codex-hook`.
- `myelin uninstall` currently removes Myelin-owned provider hook entries and provider shim files; it does not own a global CLI executable.
- Most command handlers call `repoRoot().root`, and `repoRoot()` resolves `process.cwd()`. Only capture and detached-worker entrypoints consistently honor `MYELIN_ROOT`. Therefore, a bin exposed on `PATH` still treats an external project as if it were the Myelin data root.
- Registered-project discovery already supports the desired caller behavior: `projectForRepoPath(root, cwd)` maps an external working directory to a project using `projects/<key>/state/project.json`.
- The current `StatusService` reports project identity, a latest session pointer, stale paths/pages, and a latest run. It does not report the Step 10 operational facts: Session and Project maintenance state, queue pressure, ingest jobs, candidates/inbox, locks, log paths, or retrieval readiness.
- The underlying operational facts already exist across root SQLite, per-project maintenance JSON, lock directories, project-memory state, retrieval rows, and project logs. Step 10 needs a read model over those sources rather than a new truth store.

### Inherited decisions

- Myelin is Bun/TypeScript-first and the operator binary is named `myelin` (ADRs 0009 and 0050).
- Capture integration is machine-level, while repositories opt into capture only through bootstrap (ADR 0055).
- The CLI is operator-facing, human-readable by default, and provides JSON for machine consumers (`CONTEXT.md`).
- The high-level status concept remains the Status Facade; detached MCP must consume stable core contracts rather than own status logic (ADRs 0005, 0011, and 0048).
- The Myelin checkout currently owns canonical project markdown plus the root SQLite serving database. This design must not relocate, duplicate, or silently recreate that state.
- Bun officially supports both globally linked package bins and compiled standalone executables. Tool capability therefore does not settle which product boundary Myelin should adopt.
- ADR 0068 records the selected checkout-backed launcher, machine locator, unified lifecycle, and conservative uninstall boundary.

### User-stated requirement

The current request is to design Roadmap Step 10 before implementation. The roadmap defines the active order as installed namespace, executable documentation, then operational health, all before external-project dogfood.

The user selected a repository-backed installation analogous in product shape to Quillmit, but explicitly does not want Myelin's command installed as a symlink. Installation creates a real thin global command and a machine-level config/locator that points to the exact local Myelin checkout. Public acquisition may later be either manual clone plus install or a curl bootstrap that clones into a stable local target and invokes the same installer.

## User-Facing Behavior

### Installed command

After an explicit machine install, `myelin --help` and normal commands work from the Myelin checkout, a registered external repository, and an unrelated directory.

The installed command is a copied thin launcher, not a symlink to `src/cli.ts` and not a copied or compiled Myelin application. It reads a machine-level locator at a stable path, obtains the authoritative Myelin root, preserves the caller's working directory, and invokes the runtime from the recorded checkout.

From a registered repository, commands that accept an omitted project key continue to use the caller's working directory for project selection. From an unrelated directory, commands that require a project must ask for an explicit project key or fail with an actionable message; they must not silently select the first registered project.

The source form, `bun src/cli.ts <command>`, remains available to contributors inside the checkout, but it is not the normal operator interface.

### Installation lifecycle

Installation remains explicit and preview-first. A repo-root installer entrypoint solves the first-install chicken-and-egg problem by delegating to the same installation service later exposed through installed `myelin install`. Preview reports the executable, root binding, selected provider integrations, ownership record, backups, and PATH implications it would manage. Apply performs only those actions. Repeated apply converges to the same owned state while preserving unrelated hooks and files. The installer entrypoint is machine setup; it is not the per-repository Bootstrap Command.

Uninstall removes only artifacts recorded as Myelin-owned. It never deletes:

- the Myelin checkout;
- `projects/` canonical markdown, sources, runs, or state;
- root `state/memory.db`;
- operator configuration or secrets;
- unrelated provider hooks.

If an installed launcher points to a missing or moved Myelin root, it fails immediately with the recorded path and a repair instruction. It must not fall back to the caller's working directory and create a second empty Myelin root.

Launcher/locator installation and provider-hook setup form one unified machine lifecycle. Capture Provider adapters remain optional contributors to that lifecycle rather than separate installation products.

Install/provider selection is deterministic:

- the repo-root installer and installed `myelin install` preview by default and require `--apply` to write;
- with no provider option, exactly one detected supported Capture Provider is included;
- with none detected, installation is command-only and reports a warning;
- with several detected, installation stops and requires explicit provider selection;
- repeatable `--provider <name>` selects only those providers, with `--provider codex` as the current explicit Codex-only path;
- `--command-only` installs or repairs launcher and locator without adding provider integrations;
- `--command-only` and explicit provider selection preserve already recorded unselected provider integrations; only provider-scoped or full uninstall removes them;
- no separate `--codex` convenience flag is introduced.

Uninstall follows the same preview/apply boundary. Bare `myelin uninstall` previews removal of the whole recorded machine lifecycle and requires `--apply`. `myelin uninstall --provider <name>` previews removal of only the named provider integration and preserves launcher and locator; it also requires `--apply`.

### Operational status

`myelin status [project-key]` remains read-only and is the single coherent project operational-health view. No parallel `myelin health` command or split machine/project status namespace is introduced. The human view is compact and diagnostic; `--json` exposes the same facts as structured fields.

The Step 10 status read model covers:

- resolved project identity and registered repo paths;
- Myelin installation/root binding relevant to the current process;
- Session Memory capture queue, ingest job counts/state, maintenance state, lock state, latest log, and embedding readiness;
- Project Memory inbox/candidate pressure, maintenance state, lock state, latest log, curated state, and retrieval readiness;
- explicit warnings for stale locks, failed jobs, failed embeddings/indexing, unreadable state, or configuration that disables expected automation;
- actionable next commands where the remedy is deterministic.

Step 10 status reports operational truth through sectioned installation, Session Memory, Project Memory, maintenance, and retrieval fields. It does not synthesize Current Briefing, implement multi-layer query routing, or finalize the broader agent-facing facade planned for Step 12. Step 12 must enrich this operational foundation rather than replace it with a competing status contract.

## Technical Design And Boundaries

### Launch context

The runtime must separate two paths that are currently conflated:

- **Myelin root:** the authoritative location of `myelin.config`, `projects/`, root `state/memory.db`, schemas, runtime assets, and logs.
- **Caller working directory:** the directory from which the operator invoked the command, used only for repo/project resolution and subprocess context where explicitly required.

Root resolution occurs once at the executable boundary and is passed through a shared runtime context. Individual command handlers must not independently reinterpret `process.cwd()` as the Myelin root.

An explicit test/runtime override remains possible for hooks, workers, and deterministic tests. Invalid or missing configured roots fail closed with repair guidance. CWD is never a fallback for an installed invocation.

The shared launch contract is:

```ts
type LaunchContext = {
  myelinRoot: string;
  callerCwd: string;
  invocationKind: "installed" | "source" | "hook" | "worker" | "test";
  rootSource: "machine_locator" | "source_entrypoint" | "internal_env" | "test_dependency";
  launcherPath: string | null;
  locatorPath: string | null;
};
```

Resolution is deterministic:

1. Tests may inject the complete context through command dependencies.
2. Hook and worker entrypoints accept an internal absolute `MYELIN_ROOT` propagated by a resolved parent context; installed contexts validate it against `~/.myelin/install.json`.
3. An installed interactive invocation must resolve from `~/.myelin/install.json`.
4. A contributor source invocation derives the checkout root from the absolute CLI entrypoint location, never from cwd.

`callerCwd` is captured from `process.cwd()` before dispatch and never rewritten during root resolution. `MYELIN_ROOT` remains an internal hook/worker compatibility contract, not a public way for an installed interactive command to bypass the machine locator.

### Executable boundary

The installed `myelin` command and all Myelin-owned background entrypoints must converge on the same CLI entrypoint and root-resolution contract. Provider hooks should no longer encode a separate direct source invocation that can drift from the interactive executable.

A shared command-invocation resolver owns background argv. Installed contexts invoke the absolute launcher path recorded in `install.json`; provider hooks write that absolute launcher path into their shim. Source/test contexts may invoke `bun <myelin-root>/src/cli.ts` explicitly. Detached workers use the same resolver while retaining the registered target repository as their cwd. No detached process relies on ambient `PATH` discovery.

The selected distribution model is checkout-backed through an explicit locator:

- installation copies a small launcher to `~/.local/bin/myelin` by default;
- installation writes `~/.myelin/install.json` as the stable machine locator and ownership record containing the exact authoritative Myelin root;
- the launcher reads that locator and invokes the checkout runtime without changing cwd;
- the launcher is not a symlink, and Myelin application code is not duplicated into a separate installation directory;
- moving or replacing the checkout requires rerunning install to update and verify the locator.

`~/.myelin/install.json` is a minimal versioned typed record, not a second `myelin.config`; workload/provider configuration remains rooted in the Myelin checkout. It contains:

- schema version;
- absolute authoritative Myelin root;
- launcher path and ownership hash;
- provider-owned hook, shim, and manifest paths;
- install and update timestamps;
- source revision when available.

The version-1 shape is:

```json
{
  "schema_version": 1,
  "myelin_root": "/absolute/path/to/llm-wiki",
  "launcher": {
    "path": "/Users/name/.local/bin/myelin",
    "sha256": "<owned-launcher-hash>"
  },
  "providers": {
    "codex": {
      "hooks_path": "/Users/name/.codex/hooks.json",
      "shim_path": "/Users/name/.codex/.myelin/shim/codex-hook",
      "manifest_path": "/Users/name/.codex/.myelin/install-manifest.json"
    }
  },
  "installed_at": "<iso-8601>",
  "updated_at": "<iso-8601>",
  "source_revision": "<git-commit-or-null>"
}
```

`~/.myelin` is created with mode `0700`, `install.json` with mode `0600`, and the launcher with mode `0755`. `--bin-dir <path>` may change the launcher directory, but the locator path remains fixed so every launcher has one discovery rule. Tests inject alternate locator and filesystem paths through dependencies rather than public runtime flags.

Reinstalling from a different checkout is an explicit rebind: preview shows the old and new roots, and apply requires `--rebind`. If either the launcher target path or locator path contains an unowned artifact, installation stops for operator action; Step 10 provides no force-overwrite escape hatch.

### Installation ownership

Installation planning and application form a single machine-lifecycle model with typed owned artifacts. The repo-root installer entrypoint and installed `myelin install` delegate to the same underlying service. Provider-specific adapters may contribute actions, but they do not own the global product lifecycle.

The install manifest records enough information to diagnose and safely remove the installation:

- install format/version;
- selected executable model and owned executable or launcher path;
- authoritative Myelin root binding;
- provider integrations and their owned shim/manifest paths;
- installation/update timestamp;
- source revision or build identity when available.

`myelin uninstall` acts from recorded ownership plus conservative verification. It removes the copied launcher, machine locator/ownership record, and Myelin-owned provider hooks and shims. It preserves the checkout, checkout-owned `myelin.config` and `.env`, canonical markdown, source evidence, project state, runs, logs, and root SQLite. An unexpected file at an owned path is reported for review rather than overwritten or deleted blindly.

Apply and uninstall use `~/.myelin/install-journal.json` as a mode-`0600` recoverable transaction record. The journal is written before mutation and records the transaction id, operation, desired manifest, per-action state, ownership hashes, and backup paths. Owned files use temp-file plus atomic rename where supported; `install.json` is promoted last. A successful operation removes the journal after its result is durable.

If a journal survives interruption, the next preview reports the incomplete operation and the next matching `--apply` resumes idempotently. A different operation is blocked until recovery completes. If `install.json` exists but the launcher is missing, repair may recreate the recorded launcher. If the launcher hash differs, repair/uninstall blocks. If the launcher exists without `install.json`, it is unowned and the installer refuses to overwrite or delete it. Because locator and ownership are one record, there is no supported state where one is authoritative without the other.

### Operational-health read model

Status composes existing state through dedicated read-only inspectors. It does not mutate jobs, clear locks, retry indexes, schedule maintenance, or repair files. Any existing read path that refreshes a dead process into a failed state must be called out explicitly or split from the pure health read.

The read model distinguishes:

- **healthy:** configured work is current and no actionable failure is known;
- **attention:** pending work, disabled automation, or a recoverable degraded condition exists;
- **blocked:** failed/stale ownership, unsafe lock state, or unavailable required retrieval/runtime state prevents normal operation;
- **unknown:** the relevant state cannot be read or has never been recorded.

These labels summarize facts; they do not replace the source-specific statuses stored by ingest, maintenance, or retrieval services.

Overall-state aggregation is deterministic:

- `blocked` when a required runtime or ownership condition prevents normal operation;
- otherwise `attention` when pending work, recoverable degradation, disabled expected automation, or a non-blocking unknown needs operator awareness;
- otherwise `healthy`.

Section-level `unknown` remains visible but is classified as `blocked` or `attention` according to whether the missing fact is required for normal operation.

Status observation is strictly pure. It uses read-only SQLite queries, file reads/stats, and process-liveness probes. It does not call mutating ingest refresh paths such as `IngestService.status()`, clear locks, rewrite dead jobs, or update maintenance state. A dead recorded process is reported as observed evidence only; repair remains an explicit command or the existing owning scheduler lifecycle.

Lock state is based on ownership coherence and liveness, not elapsed time:

- no lock plus non-active state is `idle` and healthy;
- a lock is `active` only when `owner.json.run_id` matches state `last_run_id`, state is `scheduled` or `running`, `last_pid` is present, and that PID is alive;
- a lock with malformed ownership, mismatched run ids, missing/dead PID, or non-active state is `stale` and blocked;
- scheduled/running state without its lock is also stale and blocked;
- `created_at` is evidence for operators but does not independently make a live coherent lock stale.

The source-to-severity contract is:

| Source | Healthy | Attention | Blocked |
| --- | --- | --- | --- |
| Machine locator and launcher | Valid locator/root and owned launcher hash; source mode may report `not_installed` separately | Source invocation with no machine install | Source-mode inspection finds invalid/mismatched install ownership; an installed launcher that cannot resolve the locator fails before status construction |
| Project identity | Explicit key or cwd maps to exactly one active project | None | Not represented as a status section: missing/ambiguous identity prevents contract construction and exits nonzero |
| Root SQLite | Existing database opens read-only and required tables are readable | None | Missing, unreadable, or incompatible database for a registered project |
| Session capture queue and ingest jobs | Queue below configured threshold, or threshold work has a live job/maintenance owner | Queue at/above threshold with no live owner; failed job without leased events; running job with no observable PID | Dead/failed job with leased events, or unreadable ingest tables |
| Session auto-maintenance | Disabled with no queued work; enabled but not yet needed; coherent live run; completed run | Disabled with queued work; failed run with recoverable unleased work; malformed optional history | Stale/incoherent lock or state, or failure that strands leased work |
| Session retrieval | No active Session Memory, or all active memories have usable indexed rows | Some usable index plus pending/failed rows | Active memories exist with no usable index, or retrieval storage is unreadable |
| Project inbox and candidates | Pending counts below threshold with no `needs_review` items, or a coherent live maintenance run owns threshold work | Any `needs_review` item; threshold reached without a live owner; disabled automation with pending work | Source/candidate storage unreadable |
| Project auto-maintenance | Disabled with no pending work; enabled but not needed; coherent live run; completed run | Disabled with pending work; recoverable failed run; malformed optional history | Stale/incoherent lock or state, or maintenance cannot read canonical inputs |
| Project Memory curation | Curated state agrees with readable canonical wiki | Project is registered but initial curation has not completed | State claims ready while canonical wiki/state is missing, malformed, or contradictory |
| Project retrieval | No curated memory (`not_applicable`), or curated sections have a usable index | Usable index exists with pending/failed rows | Curated memory exists with no usable index, or retrieval state is unreadable |
| Logs and optional history | Present, or correctly reported as `never_run` | Missing log referenced by active/failed state | Never blocks status by itself |

A recorded running ingest job with a live PID is active. A running row with no recorded PID is `running_unverifiable` and attention. A dead PID is not persisted as failed by status; severity follows whether leased events are stranded.

### Step 10 JSON contract

`myelin status <project-key> --json` replaces the existing shallow `StatusFacadeResponse` with the versioned operational contract. The removed fields are `answer`, `confidence`, `memory_scope`, `citations`, `candidate_ids`, `degraded`, `degraded_reason`, and `source_tools`; they are neither nested nor retained at the new top level.

The contract owns these top-level fields:

```ts
type OperationalState = "healthy" | "attention" | "blocked";

type StatusSectionBase = {
  state: OperationalState;
  lifecycle: string;
  evidence_ids: string[];
};

type InstallationStatusSection = StatusSectionBase & {
  myelin_root: string;
  launcher_path: string | null;
  locator_path: string | null;
  locator_schema_version: number | null;
  providers: Array<{ name: string; lifecycle: string; hooks_path: string | null; shim_path: string | null }>;
};

type SessionMemoryStatusSection = StatusSectionBase & {
  capture: { queued_events: number; unleased_events: number; leased_events: number };
  ingest: { running_jobs: number; failed_jobs: number; terminal_tombstones: number; latest_log_path: string | null };
  maintenance: {
    enabled: boolean;
    lifecycle: string;
    lock: { lifecycle: "absent" | "active" | "stale"; path: string; run_id: string | null; pid: number | null };
    last_run_id: string | null;
    last_log_path: string | null;
  };
  retrieval: { indexed_count: number; pending_count: number; failed_count: number };
};

type ProjectMemoryStatusSection = StatusSectionBase & {
  inbox: { pending_items: number };
  candidates: { pending: number; needs_review: number };
  maintenance: {
    enabled: boolean;
    lifecycle: string;
    lock: { lifecycle: "absent" | "active" | "stale"; path: string; run_id: string | null; pid: number | null };
    last_run_id: string | null;
    last_log_path: string | null;
  };
  curation: { lifecycle: string; canonical_wiki_path: string; latest_run_path: string | null };
  retrieval: { indexed_count: number; pending_count: number; failed_count: number };
};

type StatusWarning = {
  code: string;
  severity: "attention" | "blocked";
  section: "installation" | "session_memory" | "project_memory";
  message: string;
  evidence_ids: string[];
};

type StatusAction = {
  command: string;
  reason: string;
  section: "installation" | "session_memory" | "project_memory";
};

type StatusEvidence = {
  id: string;
  kind: "file" | "sqlite" | "process" | "config";
  path: string;
};

type ProjectOperationalStatusV1 = {
  contract_version: "myelin.status.v1";
  kind: "project_operational_status";
  generated_at: string;
  overall_state: OperationalState;
  project: {
    key: string;
    name: string;
    repo_paths: string[];
    resolved_from: "argument" | "cwd";
  };
  installation: InstallationStatusSection;
  session_memory: SessionMemoryStatusSection;
  project_memory: ProjectMemoryStatusSection;
  warnings: StatusWarning[];
  actions: StatusAction[];
  evidence: StatusEvidence[];
};
```

Each operational section has `state`, a source-specific `lifecycle` value, counts/details owned by that section, and evidence ids. Warnings contain stable `code`, `severity`, `section`, `message`, and `evidence_ids`. Actions contain an exact `command`, `reason`, and `section`. Evidence contains a stable response-local `id`, `kind`, and absolute or Myelin-root-relative `path`; it never includes secret values.

Evidence paths use one convention: machine artifacts such as the launcher and `~/.myelin` records are emitted as absolute paths; checkout-owned artifacts are emitted relative to the authoritative Myelin root.

Healthy example:

```json
{
  "contract_version": "myelin.status.v1",
  "kind": "project_operational_status",
  "generated_at": "2026-07-10T12:00:00.000Z",
  "overall_state": "healthy",
  "project": { "key": "class-kit", "name": "Class Kit", "repo_paths": ["/repos/class-kit"], "resolved_from": "cwd" },
  "installation": {
    "state": "healthy", "lifecycle": "installed", "evidence_ids": ["install"],
    "myelin_root": "/repos/llm-wiki", "launcher_path": "/Users/name/.local/bin/myelin",
    "locator_path": "/Users/name/.myelin/install.json", "locator_schema_version": 1,
    "providers": [{ "name": "codex", "lifecycle": "installed", "hooks_path": "/Users/name/.codex/hooks.json", "shim_path": "/Users/name/.codex/.myelin/shim/codex-hook" }]
  },
  "session_memory": {
    "state": "healthy", "lifecycle": "ready", "evidence_ids": ["db", "session-state"],
    "capture": { "queued_events": 0, "unleased_events": 0, "leased_events": 0 },
    "ingest": { "running_jobs": 0, "failed_jobs": 0, "terminal_tombstones": 12, "latest_log_path": null },
    "maintenance": { "enabled": true, "lifecycle": "idle", "lock": { "lifecycle": "absent", "path": "projects/class-kit/state/.auto-memory-maintenance.lock", "run_id": null, "pid": null }, "last_run_id": "auto_memory_example", "last_log_path": "projects/class-kit/logs/auto_memory_example.log" },
    "retrieval": { "indexed_count": 8, "pending_count": 0, "failed_count": 0 }
  },
  "project_memory": {
    "state": "healthy", "lifecycle": "ready", "evidence_ids": ["db", "project-state"],
    "inbox": { "pending_items": 0 }, "candidates": { "pending": 0, "needs_review": 0 },
    "maintenance": { "enabled": true, "lifecycle": "idle", "lock": { "lifecycle": "absent", "path": "projects/class-kit/state/.auto-project-memory-maintenance.lock", "run_id": null, "pid": null }, "last_run_id": "auto_project_memory_example", "last_log_path": "projects/class-kit/logs/auto_project_memory_example.log" },
    "curation": { "lifecycle": "curated", "canonical_wiki_path": "projects/class-kit/wiki", "latest_run_path": "projects/class-kit/runs/project-learn/example" },
    "retrieval": { "indexed_count": 24, "pending_count": 0, "failed_count": 0 }
  },
  "warnings": [],
  "actions": [],
  "evidence": [
    { "id": "install", "kind": "file", "path": "/Users/name/.myelin/install.json" },
    { "id": "db", "kind": "sqlite", "path": "/repos/llm-wiki/state/memory.db" },
    { "id": "session-state", "kind": "file", "path": "projects/class-kit/state/auto-memory-maintenance.json" },
    { "id": "project-state", "kind": "file", "path": "projects/class-kit/state/project-memory.json" }
  ]
}
```

Blocked example:

```json
{
  "contract_version": "myelin.status.v1",
  "kind": "project_operational_status",
  "generated_at": "2026-07-10T12:00:00.000Z",
  "overall_state": "blocked",
  "project": { "key": "class-kit", "name": "Class Kit", "repo_paths": ["/repos/class-kit"], "resolved_from": "argument" },
  "installation": {
    "state": "healthy", "lifecycle": "installed", "evidence_ids": ["install"],
    "myelin_root": "/repos/llm-wiki", "launcher_path": "/Users/name/.local/bin/myelin",
    "locator_path": "/Users/name/.myelin/install.json", "locator_schema_version": 1,
    "providers": [{ "name": "codex", "lifecycle": "installed", "hooks_path": "/Users/name/.codex/hooks.json", "shim_path": "/Users/name/.codex/.myelin/shim/codex-hook" }]
  },
  "session_memory": {
    "state": "blocked", "lifecycle": "stale_lock", "evidence_ids": ["db", "session-lock", "session-state"],
    "capture": { "queued_events": 18, "unleased_events": 8, "leased_events": 10 },
    "ingest": { "running_jobs": 1, "failed_jobs": 0, "terminal_tombstones": 12, "latest_log_path": "projects/class-kit/logs/ingest-example.log" },
    "maintenance": { "enabled": true, "lifecycle": "stale_lock", "lock": { "lifecycle": "stale", "path": "projects/class-kit/state/.auto-memory-maintenance.lock", "run_id": "auto_memory_dead", "pid": 4321 }, "last_run_id": "auto_memory_dead", "last_log_path": "projects/class-kit/logs/auto_memory_dead.log" },
    "retrieval": { "indexed_count": 8, "pending_count": 0, "failed_count": 0 }
  },
  "project_memory": {
    "state": "attention", "lifecycle": "retrieval_pending", "evidence_ids": ["db", "project-state"],
    "inbox": { "pending_items": 2 }, "candidates": { "pending": 1, "needs_review": 0 },
    "maintenance": { "enabled": true, "lifecycle": "idle", "lock": { "lifecycle": "absent", "path": "projects/class-kit/state/.auto-project-memory-maintenance.lock", "run_id": null, "pid": null }, "last_run_id": "auto_project_memory_example", "last_log_path": "projects/class-kit/logs/auto_project_memory_example.log" },
    "curation": { "lifecycle": "curated", "canonical_wiki_path": "projects/class-kit/wiki", "latest_run_path": "projects/class-kit/runs/project-learn/example" },
    "retrieval": { "indexed_count": 20, "pending_count": 4, "failed_count": 0 }
  },
  "warnings": [{ "code": "SESSION_MAINTENANCE_STALE_LOCK", "severity": "blocked", "section": "session_memory", "message": "Recorded maintenance owner is not alive.", "evidence_ids": ["session-lock"] }],
  "actions": [],
  "evidence": [
    { "id": "install", "kind": "file", "path": "/Users/name/.myelin/install.json" },
    { "id": "db", "kind": "sqlite", "path": "/repos/llm-wiki/state/memory.db" },
    { "id": "session-lock", "kind": "file", "path": "projects/class-kit/state/.auto-memory-maintenance.lock/owner.json" },
    { "id": "session-state", "kind": "file", "path": "projects/class-kit/state/auto-memory-maintenance.json" },
    { "id": "project-state", "kind": "file", "path": "projects/class-kit/state/project-memory.json" }
  ]
}
```

Step 12 may add an optional `briefing` or semantic section without changing these operational fields. Any incompatible reinterpretation requires a new contract version.

## Data And State

Canonical Project Memory and root SQLite ownership do not change in Step 10.

New installation metadata is machine-owned operational state under `~/.myelin`, not Project Memory. `~/.myelin/install.json` includes the authoritative Myelin root and owned launcher path, and is readable without a Capture Provider being installed. It remains distinct in purpose from checkout-owned `myelin.config` while serving as both launcher locator and ownership manifest.

The current Quillmit installer is useful precedent for a repo-backed command, but it currently installs `quill` with a symlink. Myelin intentionally uses a copied launcher plus explicit locator so command discovery and runtime-location binding are separate and diagnosable.

Operational status is computed on demand from existing sources. No second health database or cached health truth is introduced. If a source is missing, status reports `unknown` or an actionable degraded condition according to whether that source is optional or required.

Sensitive configuration values and environment secrets are never printed in status or copied into the install manifest. Paths may be reported because they are required for local diagnosis; JSON consumers must receive the same redacted boundary as human output.

The machine locator is user-owned local machine state and must not be writable by unrelated users. Its format carries a version and an absolute Myelin root. The launcher rejects malformed, incompatible, missing, or non-directory roots before executing checkout code. Public curl-based acquisition remains deferred until integrity and version-selection behavior are designed; Step 10 installs from an already trusted local checkout.

## Integrations

### Capture providers

Codex remains the implemented Capture Provider. Step 10 preserves provider-aware planning and the rule that unrelated hooks survive install/update/uninstall. The design must not pretend Claude capture integration exists merely because Claude is an LLM provider.

### Detached workers

Ingest and auto-maintenance workers inherit the resolved Myelin root explicitly and invoke the stable executable contract. Their working directory remains the registered target repository where provider-backed work requires target-repo inspection.

### Documentation and Make

Operator documentation uses `myelin` consistently. Contributor documentation may show the source invocation. Make remains a checkout-local convenience layer and may call the installed command or the source form, but it is not the public product boundary.

### Future MCP

No MCP code or tool contract is added in Step 10. The structured health read model should be reusable by the later Status Facade, but Step 13 remains a detached wrapper over proven CLI/JSON contracts.

## Failure And Recovery Behavior

- Missing executable target or Myelin root: fail before command dispatch; show the bound path and reinstall/repair command.
- Myelin root moved intentionally: rerunning install from the intended checkout updates the root binding and provider shims after preview.
- Missing or malformed machine locator: the launcher fails with the expected locator path and repo-root installer instruction; it never guesses from cwd.
- Partial install: preserve an install result/journal sufficient to distinguish completed actions from pending cleanup; the next preview explains the incomplete state and can converge safely.
- PATH does not expose the installed executable: apply reports this as an actionable installation warning and must not claim success without naming the required operator action.
- Provider root absent: executable installation can still succeed if provider capture was not explicitly required; provider status remains skipped or attention, not fabricated success.
- Explicit provider absent: `--provider <name>` fails before apply when that provider root is unavailable; it does not silently fall back to command-only or another provider.
- Stale lock: status reports owner metadata, age, path, and blocked/attention classification; status does not delete it.
- Dead or failed detached process: status reports the recorded job, observed liveness, and log path without persisting a status transition. Existing mutating ingest/job-admin commands may retain their owning refresh behavior, but `myelin status` never calls it.
- Unreadable/malformed maintenance state: isolate the affected section, report `unknown` with the file path, and continue rendering other health facts.
- Missing optional history: report `unknown` or `never run`, not a command failure.
- Successfully observed degradation: render the complete contract and exit 0, even when `overall_state` is `attention` or `blocked`.
- Command failure: return nonzero only for invalid invocation, unresolved installation/project identity, or failure before a trustworthy status contract can be constructed. If an inspector successfully reports an unreadable required source as `blocked`, that is valid status output and still exits 0.

## Testing And Acceptance Evidence

Acceptance must demonstrate behavior, not only package metadata:

- invocation from the Myelin checkout, a registered external repo, and an unrelated temp directory;
- identical authoritative root selection across interactive CLI, capture hook, ingest worker, Session maintenance worker, and Project maintenance worker entrypoints;
- CWD-based project inference from a registered external repo without using CWD as Myelin root;
- preview/apply/reapply/uninstall behavior with unrelated hooks and unexpected owned-path contents;
- moved/missing root and missing-PATH diagnostics;
- preservation of canonical markdown, root SQLite, config, secrets, and unrelated provider state;
- human/JSON parity for healthy, pending, blocked, unknown, stale-lock, failed-job, and retrieval-degraded fixtures;
- exact `myelin.status.v1` key/section examples and removal of the shallow legacy fields;
- status observation leaves root SQLite and all inspected state-file contents and mtimes unchanged;
- an unrelated cwd without an explicit key does not select the first registered project;
- uninstall blocks when launcher/locator hashes no longer match recorded ownership;
- current relevant install, command, runtime, status, ingest, maintenance, and retrieval tests;
- full `bun test`, `bun run typecheck`, and documentation command examples after implementation.

The Step 11 gate is a real invocation from Class Kit and Droplet Bot using only the installed command and public outputs. That dogfood is subsequent roadmap work, not Step 10 acceptance itself.

## Implementation Constraints And Seams

- Preserve the central canonical-versus-derived memory boundaries; executable distribution must not create another truth root.
- Resolve runtime root once instead of adding `MYELIN_ROOT ?? repoRoot()` independently to every command.
- Keep capture-provider installation behind the existing provider adapter boundary.
- Keep operational health read-only and compositional; remediation remains explicit commands.
- Preserve human output by default and structured JSON for automation.
- Do not add MCP source to the root package graph.
- Do not redesign Current Briefing, multi-layer query, Practice Memory, or Personal Memory in this step.
- Validate the first installer on the current macOS/Bun operator environment. Keep the launcher/locator contract portable, but defer separate Linux and Windows bootstrap implementations until demanded by distribution work.
- Implementation planning must name the exact repo-root installer filename in its first responsibility map; the filename does not change the approved lifecycle behavior.
- Do not convert the design into implementation chunks until the user approves it.

## Assumptions And Provenance

| Statement | Kind | Source |
| --- | --- | --- |
| Step 10 covers installed namespace, operator docs, and operational health before external dogfood. | Repository-backed requirement | `docs/ROADMAP.md` Step 10 |
| Machine-level capture remains paired with per-repo bootstrap opt-in. | Approved decision | ADR 0055 and `CONTEXT.md` |
| Current CWD-based root resolution prevents a merely linked bin from working correctly outside the checkout. | Repository-backed fact | `src/runtime/fs.ts` and command registrations |
| Root resolution should be centralized in a launch context. | Agent inference | Simplest boundary that prevents command-specific drift |
| Both linked bins and compiled executables are technically viable Bun mechanisms. | Verified external fact | Bun official `bun link` and single-file executable documentation, checked 2026-07-10 |
| Existing root SQLite and project shells must remain in place through Step 10. | Inherited product constraint | ADR 0001, roadmap Step 11 continuity requirement |
| The installed executable is a copied thin launcher plus a locator for the checkout, not a symlink or standalone application. | User decision | Brainstorming Question 1, 2026-07-10 |
| Repo-root installation, installed update/repair, provider integration, and uninstall use one machine lifecycle and preserve checkout-owned data/configuration. | User decision | Brainstorming Question 2, 2026-07-10 |
| Operational health extends `myelin status [project-key]`; no parallel health command or split namespace is added. | User decision | Brainstorming Question 3, 2026-07-10 |
| Status exits 0 for successfully observed healthy, attention, or blocked states; nonzero means status construction failed. | User decision | Brainstorming Question 4, 2026-07-10 |
| The launcher defaults to `~/.local/bin/myelin`; `~/.myelin/install.json` is the single versioned locator and ownership record. | User decision | Brainstorming Question 5, 2026-07-10 |
| Install auto-detects one provider, supports explicit repeatable `--provider`, and gives full versus provider-only preview/apply uninstall modes. | User decision | Brainstorming Question 6, 2026-07-10 |
| Step 10 replaces shallow status JSON with the versioned `myelin.status.v1` operational contract. | User decision | Brainstorming Question 7, 2026-07-10 |

## Open Questions

The authoritative decision boundaries and recommendations are in `agenda.md`:

1. Executable distribution and runtime location — resolved.
2. Machine installation lifecycle ownership — resolved.
3. Operational status command surface — resolved.
4. Health state and exit-code semantics — resolved.
5. Machine installation paths and locator/ownership schema — resolved after external audit.
6. Provider defaults and uninstall modes — resolved after external audit.
7. Step 10 status JSON contract and legacy-field disposition — resolved after external audit.
