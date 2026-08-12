# Working Skeleton Hardening Design Agenda

## Status

- Spec: `docs/design/2026-07-10-working-skeleton-hardening/spec.md`
- State: Approved
- Approval: Approved by user on 2026-07-10

## External Audit History

- 2026-07-10: Independent Software Architect audit using `plan-auditor` returned `Needs Refinement` (43/70), not ready for `$pmp-writing-plans`.
- Critical gaps: exact launcher/locator ownership contract; provider and uninstall defaults; versioned status JSON contract; deterministic read-only status source/severity rules.
- Disposition: Questions 5–7 resolved the user-facing/public-contract choices. The revision adds repository-grounded `LaunchContext`, exact locator/manifest schema, journal recovery, absolute background invocation, `myelin.status.v1`, source/severity matrix, lock liveness rules, purity guarantees, and ADR 0068.
- 2026-07-10: Focused re-audit by the same Software Architect returned `Ready for Development` (58/70) with no critical issues. Under this workflow, the design is ready to proceed to `$pmp-writing-plans` after explicit user approval.
- Non-blocking recommendations incorporated: preserve recorded unselected provider integrations; classify any `needs_review` candidate as attention; standardize evidence paths as absolute for machine artifacts and Myelin-root-relative for checkout artifacts.

## Documented Decisions

- Roadmap Step 10 is the design scope: stable installed namespace, executable operator documentation, and operational health.
- The source checkout remains the current owner of canonical Project Memory, project state, configuration, runtime assets, and root `state/memory.db`; Step 10 must not silently relocate or duplicate them.
- `myelin` is the operator-facing binary name; `bun src/cli.ts` is a contributor/development invocation.
- Machine-level capture integrations remain opt-in per provider, while repository capture remains opt-in through bootstrap.
- Installation is explicit, previewable, idempotent, and removes only recorded Myelin-owned artifacts.
- The caller's working directory is project-selection context, not the Myelin root.
- Runtime root resolution must happen once at the CLI boundary and be inherited by commands, hooks, and detached workers.
- Operational status is read-only and derived from existing state; Step 10 does not introduce a second health truth store.
- Human CLI output remains the operator default and JSON remains the machine-readable form.
- Current Briefing, multi-layer query routing, MCP wrapping, Practice Memory, and Personal Memory remain outside Step 10.
- Bun supports both globally linked package executables and compiled standalone executables; the product choice is not constrained by tool capability.
- The Step 10 executable uses a copied thin launcher plus a machine-level locator/config file that records the exact local Myelin checkout path. It does not use a symlink into the checkout.
- A future public bootstrap may clone Myelin into a stable local location before invoking the same installer; that changes acquisition, not the runtime-location contract.
- Myelin has one unified machine installation lifecycle: a repo-root installer entrypoint and installed `myelin install` delegate to the same service for launcher, locator, and optional Capture Provider reconciliation.
- `myelin uninstall` removes only recorded machine-installed artifacts, including the launcher, locator, and Myelin-owned provider hooks/shims. It preserves the checkout, `myelin.config`, `.env`, canonical memory, project state, and root SQLite.
- `myelin status [project-key]` is the single operational-health surface. Step 10 extends it with installation, Session Memory, Project Memory, queue, job, maintenance, lock, log, and retrieval facts; Step 12 later enriches the same foundation with Current Briefing and semantic facade behavior.
- A successfully computed `myelin status` returns exit 0 even when `overall_state` is `attention` or `blocked`. Nonzero means invocation/root/project resolution failed or the command could not construct a trustworthy status response.
- The default launcher path is `~/.local/bin/myelin`; the single versioned machine locator and ownership record is `~/.myelin/install.json`. Myelin owns the `~/.myelin` machine-state root.
- Install and uninstall are preview-first and require `--apply`. Bare install auto-detects supported Capture Providers; `--provider codex` explicitly selects only Codex. Bare uninstall targets the full lifecycle, while provider-scoped uninstall preserves the launcher and locator.
- Step 10 replaces the shallow status facade JSON with the versioned `myelin.status.v1` operational contract. Legacy answer-oriented fields are removed rather than nested or mixed into the new top level.

## Questions

### Question 1: Executable distribution and runtime location

- Status: Answered
- Why it matters: This decision defines whether Step 10 is a development-link hardening slice or a true application installation boundary. It controls updates, portability, root discovery, provider shims, and what happens if the source checkout moves.
- Scenario: The operator is in `/Users/liadgoren/Repositories/class-kit` and runs `myelin status` and `myelin project learn class-kit`. The command must use the llm-wiki checkout's canonical `projects/`, `myelin.config`, runtime assets, and root SQLite while retaining Class Kit as the caller cwd. Later, the llm-wiki checkout is updated or moved.
- Options:
  - A. Checkout-backed launcher — install a stable global launcher bound to the current llm-wiki checkout; code updates arrive with the checkout, canonical data stays where it is, and moving the checkout requires rerunning install. This is the smallest coherent boundary for Step 11 but still makes the checkout part of the installed product.
  - B. Managed application copy — install Myelin code and runtime assets into a dedicated machine application directory while binding canonical project data to an explicit existing root. This separates source development from operation, but introduces copy/update/version/migration lifecycle before external dogfood.
  - C. Compiled standalone executable — compile `src/cli.ts` and dependencies into a machine binary while binding canonical project data/assets explicitly. This gives the strongest executable isolation, but bundled assets, native SQLite/vector behavior, version upgrades, and development iteration need a larger release contract.
- Recommendation: A. Use a checkout-backed launcher for Step 10, but make the root binding explicit and centrally resolved. It removes CWD dependence, preserves accumulated continuity, and proves the operator boundary without prematurely designing releases or moving canonical state. Treat B or C as a later distribution upgrade only if external dogfood shows checkout coupling is the next real constraint.
- Answer: Modified A. The user confirmed the repo-backed installation model but explicitly rejected a symlink as the launcher mechanism. Installation should create a real global command plus a stable machine-level config/locator that points to the exact Myelin checkout on the local machine. For public distribution, users may clone and run the installer, or a future curl bootstrap may clone Myelin into a local target and run the same installer.
- Resulting decision: Install a copied thin global launcher, not a symlink and not a copied/compiled Myelin application. The launcher reads a stable machine locator containing the authoritative local Myelin root, preserves caller cwd, and invokes the checkout-backed runtime. Moving the checkout requires rerunning installation to update the locator. Acquisition by manual clone or future curl bootstrap converges on this same runtime contract.
- Spec changes: Clarified installed-command behavior, executable boundary, installation state, failure behavior, and future acquisition boundary.

### Question 2: Machine installation lifecycle ownership

- Status: Answered
- Why it matters: The current `myelin install` name owns only provider hooks, while Step 10 also needs to make the executable available. Leaving these as unrelated mechanisms creates a confusing partial-install state and gives `myelin uninstall` ambiguous ownership.
- Scenario: From a fresh checkout, the operator runs the repo-root installer entrypoint because the global command does not exist yet. Installation copies the thin launcher, writes the machine locator for this checkout, and may configure Codex hooks. Later the operator changes the checkout path, updates provider integration, or uninstalls Myelin. The lifecycle must say whether launcher/locator and provider integration are one reconciled install or two independent products.
- Options:
  - A. One Myelin machine lifecycle with a repo-root installer entrypoint — the installer delegates to the same preview/apply service exposed later by installed `myelin install`; that service reconciles the copied launcher, machine locator, and selected Capture Provider integrations. `myelin uninstall` removes all recorded Myelin-owned machine artifacts while preserving canonical data. Provider adapters remain modular inside the lifecycle.
  - B. Separate product and capture subcommands — introduce a distinct executable-install surface and move provider hooks under an explicit capture/provider namespace. This is conceptually precise, but expands and renames the public CLI before dogfood.
  - C. Two-phase installation — the repo-root installer owns only the launcher and locator, while installed `myelin install`/`uninstall` remain provider-only. This keeps existing provider vocabulary but leaves two manifests and two repair/uninstall stories.
- Recommendation: A. The repo-root installer entrypoint solves the initial chicken-and-egg problem without creating a second installation model. One underlying service and manifest should explain, repair, update, and remove every Myelin-owned machine artifact while provider adapters remain optional components.
- Answer: A, explicitly including the uninstall command.
- Resulting decision: Use one unified lifecycle. A repo-root installer entrypoint invokes the same installation service exposed by installed `myelin install`. That service previews and reconciles the copied launcher, machine locator/ownership record, and selected Capture Provider integrations. `myelin uninstall` removes only those recorded machine artifacts and leaves all checkout-owned configuration, secrets, canonical memory, project state, source evidence, runs, and SQLite untouched. This installer entrypoint is machine setup and is distinct from the established per-project Bootstrap Command.
- Spec changes: Finalized installation entrypoints, ownership, update/repair convergence, uninstall scope, and preserved-state guarantees.
- Follow-ups: Question 1 resolved the executable as a copied thin launcher backed by a machine locator.

### Question 3: Operational status command surface

- Status: Answered
- Why it matters: Step 10 needs operational health now, while Step 12 later owns the richer agent-facing Status Facade and Current Briefing. The command shape should expose real operator truth without creating a parallel concept that later has to be retired.
- Scenario: From Droplet Bot, the operator needs to see that Session capture has 28 queued events, an ingest job failed, Project maintenance is cooldown-blocked with three pending candidates, Project retrieval is ready, and the latest relevant logs are at known paths. They should not need separate SQLite or filesystem inspection commands.
- Options:
  - A. Extend `myelin status [project-key]` — make the existing project status command the coherent operational view, including installation/root binding and Session/Project health sections. Step 12 later composes Current Briefing and semantic state onto the same core contract.
  - B. Add `myelin health [project-key]` — keep current `status` shallow/semantic and put operational diagnostics in a dedicated command. This separates audiences but creates overlapping current-state surfaces.
  - C. Split machine and project status — use `myelin status` for installation/global runtime and a nested project health command for queues, locks, and retrieval. This is explicit but makes the common "is this project healthy?" path more complex.
- Recommendation: A. Extend the existing status command. Operational truth is foundational status, not a competing health product. Preserve sectioned internal contracts so Step 12 can add Current Briefing without flattening or breaking the operational fields.
- Answer: A.
- Resulting decision: Extend `myelin status [project-key]` into the coherent project operational-health view. Do not add a parallel `health` command or split routine machine/project diagnosis across namespaces. Keep the read model sectioned so Step 12 can compose Current Briefing and agent-facing status semantics without replacing or flattening the Step 10 operational contract.
- Spec changes: Finalized the public command surface, Step 10 versus Step 12 boundary, and sectioned health-read-model requirement.

### Question 4: Health state and exit-code semantics

- Status: Answered
- Why it matters: Operators need honest diagnostics, and scripts need predictable behavior. If every pending queue makes the command fail, normal asynchronous work becomes indistinguishable from a broken runtime; if every result exits zero without structured severity, automation cannot detect real blockage.
- Scenario: Compare three runs: one has pending work below the auto-maintenance threshold, one has a stale lock and failed ingest job, and one cannot open `state/memory.db`. Human and JSON output should classify all three consistently, and shell callers need a stable exit contract.
- Options:
  - A. Diagnostic success with explicit severity — return exit 0 whenever status was successfully computed, including `attention` or `blocked`; expose `overall_state` and source-specific states in output. Return nonzero only for usage errors or when no trustworthy status can be computed.
  - B. Nonzero on blocked — return 0 for healthy/attention and nonzero when `overall_state` is blocked or unreadable. This is convenient for CI, but conflates a successfully observed unhealthy project with command execution failure.
  - C. Always exit zero for known projects — encode every condition only in output. This is simple but gives shell automation no distinction between status computation failure and observed health.
- Recommendation: A. Status is an observation command. A successfully observed blocked state is valid output, not command failure. Machine consumers should branch on the structured state; nonzero should mean the observation itself could not be performed reliably.
- Answer: A.
- Resulting decision: Exit 0 whenever the command successfully constructs the status contract, including observed `attention` and `blocked` states. Human and JSON output expose `overall_state` plus section-specific evidence. Return nonzero only for invalid invocation, unresolved installation/project identity, or a failure that prevents construction of a trustworthy status response. An inspector that successfully reports an unreadable required source as `blocked` still produced valid status and exits 0.
- Spec changes: Finalized status severity, aggregation, machine-consumer behavior, and the distinction between observed failure and command failure.

### Question 5: Machine installation paths and locator ownership contract

- Status: Answered
- Why it matters: The copied launcher must know one deterministic locator path, and install/repair/uninstall need one ownership authority. Leaving paths or schema split unresolved would force implementation planning to invent public machine-state behavior.
- Scenario: On the current macOS machine, an operator runs the repo-root installer from `/Users/liadgoren/Repositories/llm-wiki`. Later they invoke `myelin` from Class Kit, move the Myelin checkout, reinstall from the new location, or discover that an unrelated file already occupies the launcher/config path.
- Options:
  - A. One versioned per-user installation record — copy the launcher to `~/.local/bin/myelin` and store one locator plus ownership manifest at `~/.config/myelin/install.json`. The JSON owns the absolute Myelin root, launcher path/hash, provider-owned paths, schema version, timestamps, and source revision. `~/.config/myelin` is mode `0700`, the record is `0600`, and the launcher is `0755`. `--bin-dir` may override the launcher directory; locator-path and filesystem dependencies are injected only in tests. Rebinding to a different checkout requires an explicit `--rebind`; unowned collisions fail without a force-overwrite escape hatch.
  - B. Split locator and ownership state — keep the root pointer under `~/.config/myelin/` and install fingerprints/provider ownership under `~/.local/state/myelin/`. This follows configuration/state separation, but creates partial-state recovery and ordering complexity for a small local installation.
  - C. Keep installation metadata adjacent to the launcher — put both command and locator/manifest under one `~/.local/` installation tree. This is self-contained, but makes config discovery less conventional and custom PATH locations harder to reconcile.
- Recommendation: A. One small versioned record is the simplest sufficient authority for launching, repair, status, and conservative uninstall. Fixed locator discovery prevents launcher drift; `--bin-dir` covers the only useful operator path customization without turning installation into a configurable subsystem.
- Answer: Modified A. Keep the launcher at `~/.local/bin/myelin`, but use a root-level Myelin-owned directory at `~/.myelin/` instead of `~/.config/myelin/`.
- Resulting decision: Copy the launcher to `~/.local/bin/myelin` by default and store the single versioned locator plus ownership manifest at `~/.myelin/install.json`. The record contains the absolute Myelin root, launcher path and ownership hash, provider-owned paths, schema version, install/update timestamps, and source revision. `~/.myelin` is mode `0700`, `install.json` is `0600`, and the launcher is `0755`. `--bin-dir` is the only public location override; tests inject locator/filesystem paths through dependencies. Rebinding a valid installation to another checkout requires `--rebind`. Unowned launcher or locator collisions fail without a force-overwrite path.
- Spec changes: Finalized machine-state root, launcher and locator paths, record ownership/schema, permissions, override boundary, rebinding, and collision behavior.

### Question 6: Provider defaults and uninstall modes

- Status: Answered
- Why it matters: A unified lifecycle still needs predictable behavior when no Capture Provider is named. The choice affects whether installation unexpectedly edits hooks, how command-only setup works, and whether operators can remove capture without deleting the global command.
- Scenario: A fresh machine has Codex installed; another has no supported provider; a future machine has several. An operator may want the command without capture, may want to remove only Codex hooks, or may want to remove all Myelin machine artifacts.
- Options:
  - A. Previewed auto-detection with explicit escape hatches — repo-root installer and `myelin install` preview by default and require `--apply`. With no provider flag, exactly one detected supported provider is included; none yields command-only installation with a warning; several require explicit repeatable `--provider <name>`. `--command-only` suppresses new provider setup. Bare `myelin uninstall` previews full lifecycle removal and requires `--apply`; `myelin uninstall --provider <name>` previews/removes only that provider integration while preserving launcher and locator.
  - B. Command-only by default — install never touches provider hooks unless `--provider` is supplied. This is maximally explicit but makes the normal Codex setup a second required command and weakens the unified lifecycle experience.
  - C. Codex by default — omission means Codex on every install, with `--command-only` to opt out. This is simple today but hardcodes a Capture Provider default into the product lifecycle and behaves poorly when Codex is absent.
- Recommendation: A. Preview-first auto-detection gives the normal one-provider machine a coherent install without silent writes, remains command-only when nothing is detected, and scales to multiple adapters without making Codex the product boundary. Full and provider-only uninstall remain conservative and explicit.
- Answer: A, with explicit support for installing only a selected provider through `--provider codex`; on the current Codex-only machine, bare auto-detection naturally defaults to Codex.
- Resulting decision: The repo-root installer and installed `myelin install` preview by default and require `--apply` to mutate. With no provider flag, one detected supported provider is included, none produces command-only installation with a warning, and multiple detected providers require explicit selection. `--provider <name>` is repeatable and constrains setup to the named providers; `--provider codex` is the current explicit Codex-only path. `--command-only` installs or repairs only launcher/locator and does not add provider integrations. Bare `myelin uninstall` previews full lifecycle removal; `myelin uninstall --provider <name>` previews provider-only removal while preserving launcher/locator; both require `--apply`. No separate `--codex` alias is introduced.
- Spec changes: Finalized provider auto-detection, explicit selection, command-only behavior, full/provider-only uninstall, preview/apply symmetry, and current Codex default behavior.

### Question 7: Step 10 status JSON contract

- Status: Answered
- Why it matters: The existing `StatusFacadeResponse` is a shallow public shape, while Step 10 needs structured operational sections and Step 12 later owns richer semantic status. Planning cannot safely choose whether to replace, extend, or nest the current fields.
- Scenario: A script invokes `myelin status class-kit --json` and needs stable installation, Session Memory, Project Memory, warning, action, and evidence fields. Later Step 12 adds Current Briefing without breaking or ambiguously repurposing Step 10 fields.
- Options:
  - A. Replace the shallow contract with versioned operational status — return `contract_version`, `kind`, `generated_at`, `overall_state`, `project`, `installation`, `session_memory`, `project_memory`, `warnings`, `actions`, and `evidence`. Remove the current `answer`, `confidence`, `memory_scope`, `citations`, `candidate_ids`, `degraded`, `degraded_reason`, and `source_tools` fields rather than freezing them accidentally. Step 12 may add a new optional `briefing`/semantic section or intentionally version the contract, but must preserve the operational sections.
  - B. Nest the existing facade under `legacy_facade` — add the new operational contract while retaining every old field in a nested compatibility object. This is safer for unknown consumers but preserves a response that has not yet proved useful and complicates Step 12.
  - C. Extend the existing top level — retain all current fields and add operational sections beside them. This minimizes immediate test changes but mixes answer-oriented and operational vocabularies without a clear ownership boundary.
- Recommendation: A. Replace the pre-dogfood shallow response with an explicit `myelin.status.v1` operational contract now. There is no proven external consumer worth freezing, and Step 12 gets a clean extension seam instead of inheriting accidental compatibility debt.
- Answer: A.
- Resulting decision: Replace the current shallow `StatusFacadeResponse` with `myelin.status.v1`. The top level contains `contract_version`, `kind`, `generated_at`, `overall_state`, `project`, `installation`, `session_memory`, `project_memory`, `warnings`, `actions`, and `evidence`. Remove the existing `answer`, `confidence`, `memory_scope`, `citations`, `candidate_ids`, `degraded`, `degraded_reason`, and `source_tools` fields. Step 12 may add an optional briefing/semantic section or deliberately version the contract, but it must preserve the Step 10 operational sections within the same version.
- Spec changes: Finalized the versioned JSON envelope, operational section ownership, legacy-field removal, and Step 12 extension seam.

## Pressure-Test Result

- Status: Complete
- Categories checked: lifecycle and partial installation; root and state ownership; locator tampering and secret redaction; provider/worker handoff; uninstall recovery; status read failures and stale locks; human/JSON acceptance evidence; Step 10/11/12 scope seams.
- New questions added: Questions 5–7 after the independent Software Architect audit found public-contract gaps; all are answered and incorporated.
- Remaining non-blocking risks: Step 10 is validated first on the current macOS/Bun environment; cross-platform bootstrap scripts are deferred. A copied launcher can drift from a newer locator format, so the locator needs a version and actionable incompatibility failure. Public curl acquisition requires a separate integrity/versioning decision before it is offered, but does not change the local installation contract.
