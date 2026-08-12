# Working Skeleton Hardening Implementation Plan Set

**Approved Source:** `docs/design/2026-07-10-working-skeleton-hardening/spec.md`
**Agenda:** `docs/design/2026-07-10-working-skeleton-hardening/agenda.md`
**Pseudocode:** Absent
**Context:** `CONTEXT.md`, `MYELIN.md`
**ADRs:** `docs/adr/0068-use-checkout-backed-launcher-and-machine-locator.md`; inherited ADRs 0001, 0005, 0009, 0011, 0048, 0050, and 0055
**Status:** Ready for Review

## Goal

Implement Roadmap Step 10 as a reliable operator boundary: a copied global `myelin` launcher backed by `~/.myelin/install.json`, a previewable and recoverable machine installation lifecycle, one root-versus-caller launch context across interactive and detached execution, pure operational health through `myelin status`, the versioned `myelin.status.v1` JSON contract, and operator documentation that no longer depends on source-checkout command knowledge.

The complete plan set must leave Myelin ready for Step 11 external-project dogfood without performing the Class Kit or Droplet Bot dogfood itself.

## Source Artifacts And Repository Evidence

Approved and durable sources:

- `docs/design/2026-07-10-working-skeleton-hardening/spec.md` — approved product and technical design.
- `docs/design/2026-07-10-working-skeleton-hardening/agenda.md` — seven resolved decisions and external-audit history.
- `CONTEXT.md` — Install Command, Myelin Machine Locator, Myelin Launch Context, Bootstrap Command, Capture Provider, and Capture Adapter terminology.
- `MYELIN.md` — canonical product design and ADR index.
- `docs/ROADMAP.md` — Step 10/11/12 sequence and acceptance boundary.
- `docs/adr/0068-use-checkout-backed-launcher-and-machine-locator.md` — launcher, locator, lifecycle, and uninstall decision.
- Independent Software Architect design audit through sub-agent `/root/software_architect_audit`: initial `Needs Refinement` (43/70), focused re-audit `Ready for Development` (58/70), no remaining critical issues.

Current implementation evidence:

- `package.json` declares a private package bin that points directly to `src/cli.ts`; the approved installer must become the only global-command path.
- `src/cli.ts` registers commands without a shared launch context.
- `src/runtime/fs.ts` resolves `repoRoot()` from `process.cwd()`.
- `src/runtime/projects.ts` already supports registered-project lookup from caller cwd through `projectForRepoPath(root, cwd)`.
- `src/commands/bootstrap.ts`, `capture.ts`, `ingest.ts`, `install.ts`, `memory.ts`, `project.ts`, `schema.ts`, `session.ts`, and `status.ts` currently resolve root independently.
- `src/install/install-service.ts`, `src/install/types.ts`, and `src/install/codex.ts` currently own only Codex hook installation and direct source invocation.
- `src/ingest/runtime.ts`, `src/maintenance/auto-memory-maintenance.ts`, and `src/maintenance/auto-project-memory-maintenance.ts` spawn checkout source files directly.
- `src/status/status-service.ts` currently returns the shallow legacy facade and falls back to the first discovered project.
- `src/ingest/status.ts`, maintenance state files, ingest job rows, candidates, Project Memory state, and retrieval tables expose the raw facts required by the approved status matrix.
- `src/ingest/runtime.ts` contains both the pure PID-liveness probe and the mutating detached-job refresh path; status must use only the former.

Tests and verification surfaces inspected:

- Command tests under `tests/commands/`, especially `install.test.ts` and `status.test.ts`.
- Install tests under `tests/install/`.
- Runtime tests under `tests/runtime/`.
- Ingest tests under `tests/ingest/`.
- Maintenance tests under `tests/maintenance/`.
- Status tests under `tests/status/`.
- Repository checks: `bun test`, `bun run typecheck`, and `git diff --check`.

Missing artifacts:

- Pseudocode: absent. Impact: none; the approved spec already fixes the public types, schemas, paths, precedence, severity matrix, and examples needed for planning.
- Child specs/agendas: absent. Impact: none; this is one coherent Step 10 design.
- Detailed chunk plans: present under `plans/` after user roadmap approval.

## Design Readiness

- Approved source verified: Pass. The spec is marked `Approved — eligible for implementation planning`, and the agenda records explicit user approval on 2026-07-10.
- Artifact paths verified: Pass.
- Pseudocode status: Absent; no planning blocker.
- Approved-artifact consistency: Pass across spec, agenda, `CONTEXT.md`, `MYELIN.md`, ADR 0068, and roadmap sequencing.
- External audit: Pass. The same Software Architect returned `Ready for Development` after the four initial public-contract gaps were resolved.
- Roadmap audit: Initial Senior Project Manager audit returned `Needs Refinement` (50/70). The critical findings were overlapping `02`/`03` command ownership and an oversized machine-lifecycle chunk; this roadmap revision resolves both before re-audit.
- Repository feasibility: Pass. Existing command, install, process, maintenance, status, and test seams support the approved design without a package-boundary or persistence-topology change.
- Current worktree: Dirty. `docs/ROADMAP.md` contains pre-existing user changes; design/context/ADR artifacts are current planning inputs. Executors must preserve unrelated and pre-existing edits.
- Remaining non-blocking risks: install transaction ordering, pure-versus-mutating status-service reuse, lifecycle-string normalization, inactive PATH configuration, and macOS-only installer validation. Each has an owning chunk below.
- Blockers: None.

## Reconciliations And Decision Ownership

| Item | Evidence / Decision Rule | Owning Chunk | Must Resolve Before |
| --- | --- | --- | --- |
| Repo-root installer filename | Resolved in this roadmap as root `install`, matching the established local installer convention and keeping bootstrap distinct from the product Bootstrap Command. Detailed planning records its responsibility map but does not reopen the name. | `03` | Resolved |
| Private package `bin` field | The approved launcher is copied and explicitly not a symlink. Remove the private package bin registration so `bun link` cannot remain an undocumented competing installation path; keep `bun src/cli.ts` as the contributor invocation. | `03` | Installer acceptance |
| Launch-context injection shape across command modules | `01` adds a compile-safe central `registerCommands(cli, context)` bootstrap while leaving current module signatures unchanged; `02` takes that file over sequentially and changes the bootstrap plus module dependency signatures together. No ignored extra arguments, partial dependency merge, or global mutable context. | `01`, `02` | Any installed-command acceptance |
| Provider reconciliation preserves unselected integrations | `--command-only` and explicit provider selection preserve recorded unselected providers; only provider-scoped or full uninstall removes them. | `04` | Install lifecycle tests |
| Status lifecycle normalization | Lifecycle values must be centralized and derived from the approved source-to-severity matrix; chunks must not expose raw storage strings as accidental public vocabulary. | `06` | `07` JSON fixtures |
| PATH warning ownership | Launcher/locator installation computes and reports whether the installed bin directory is active on PATH; final documentation explains the exact remedy and verifies examples. | `03`, `08` | Final Step 10 acceptance |
| Isolated versus live installation verification | Automated acceptance uses injected temporary HOME/bin/locator roots. Writing actual `~/.myelin`, `~/.local/bin`, or provider hooks is not required in Step 10 planning and needs separate operator approval if attempted during execution. | `08` | Final Step 10 acceptance |
| Public curl integrity/versioning and Linux/Windows bootstrap | Explicitly deferred from Step 10. Findings are owned by the Roadmap Step 11 external-dogfood closeout/backlog; no public bootstrap work begins until that evidence creates a promoted roadmap item. | Step 11 backlog | Any public or non-macOS installer work |

## Proposed Or Approved Chunks

| Chunk | Deliverable | Depends On | Enables | Verification Focus | Status |
| --- | --- | --- | --- | --- | --- |
| [`01` Launch Context And Invocation Contract](plans/01-launch-context-and-invocation-contract.md) | Add the approved `LaunchContext`, deterministic root-source precedence, source-entrypoint root resolution, caller-cwd preservation, and shared absolute command-invocation resolver without migrating every consumer yet. | None | `02` | Resolver precedence, invalid locator/internal env rejection, caller-cwd preservation, installed/source/test invocation argv | Ready for Review |
| [`02` Command Root Migration And Project Resolution](plans/02-command-root-migration-and-project-resolution.md) | Route every interactive command module, including the existing install registration, through one resolved context; eliminate command-local `repoRoot()` guessing and status fallback to the first project. | `01` | `03`, `05`, `06`, `07`, `08` | Every command uses authoritative root; registered external cwd resolves correctly; unrelated cwd without key fails | Ready for Review |
| [`03` Launcher, Locator, And Transaction Lifecycle](plans/03-launcher-locator-and-transaction-lifecycle.md) | Add root `install`; implement the copied launcher, package-bin cleanup, `~/.myelin/install.json`, `install-journal.json`, permissions, PATH reporting, preview/apply, command-only convergence, rebind, collision rules, and interruption recovery without expanding provider behavior yet. | `02` | `04`, `06`, `08` | Hashes/modes, plan/apply/reapply/resume, manifest-last promotion, missing/mismatched artifacts, unowned collisions, no checkout-data deletion | Ready for Review |
| [`04` Provider Reconciliation And Conservative Removal](plans/04-provider-reconciliation-and-conservative-removal.md) | Compose existing adapters into the unified lifecycle: detection/selection, unselected-provider preservation, provider-only uninstall, full uninstall, backups, and ownership-safe removal. | `03` | `05`, `06`, `08` | Provider matrices, unrelated-hook preservation, full/provider-only preview/apply, hash mismatch blocking, canonical-state preservation | Ready for Review |
| [`05` Provider Hooks And Detached Invocation](plans/05-provider-hooks-and-detached-invocation.md) | Migrate Codex shims, ingest workers, and both maintenance workers to the shared absolute invocation contract while preserving target-repo cwd and internal environment contracts. | `02`, `04` | `08` | Hook idempotence; absolute argv; no ambient PATH reliance; target cwd and capture-disable/internal env | Ready for Review |
| [`06` Pure Operational Status Model](plans/06-pure-operational-status-model.md) | Build read-only installation, Session Memory, and Project Memory inspectors; normalize lifecycle/severity; implement lock coherence and overall-state aggregation without invoking mutating refresh paths. | `02`, `04` | `07` | Complete source/severity matrix, dead/unverifiable processes, stale locks, thresholds, retrieval/curation states, SQLite/file content/hash immutability | Ready for Review |
| [`07` Status CLI And `myelin.status.v1`](plans/07-status-cli-and-versioned-contract.md) | Replace the shallow status response with approved human rendering and exact versioned JSON; remove legacy fields; preserve exit-code semantics and Step 12 extension seam. | `06` | `08` | Exact key/type fixtures, valid healthy/blocked examples, human/JSON parity, exit 0 for observed blockage and nonzero construction failure | Ready for Review |
| [`08` Operator Docs And Step 10 Acceptance](plans/08-operator-docs-and-step-10-acceptance.md) | Reconcile README/CLI/Make/alignment/roadmap docs and run isolated end-to-end installed-command acceptance from checkout, registered external repo, and unrelated cwd. | `05`, `07` | Roadmap Step 11 | Temp-root install/uninstall smoke, PATH guidance, command examples, full Bun suite/typecheck/diff check, no real-home or Step 11 mutation | Ready for Review |

Boundary rationale:

- `01` is an independently testable runtime contract and prevents later chunks from inventing competing root semantics.
- `02` isolates the broad but mechanical command migration and completes the shared registration seam before install parsing changes.
- `03` isolates the launcher/locator transaction, the highest filesystem-recovery risk, before provider writes are composed into it.
- `04` completes the approved unified public lifecycle while keeping provider preservation/removal reviewable apart from launcher recovery.
- `05` follows provider reconciliation because Codex shim ownership is stable before its invocation changes.
- `06` keeps pure observation and severity policy separate from CLI formatting, preventing reuse of mutating ingest/admin paths.
- `07` owns the public response break and presentation contract as one reviewable change.
- `08` closes operator documentation and cross-cwd acceptance only after both detached invocation and status are complete.

## Dependency And Parallelism Order

Required and safe order:

1. `01` establishes the shared launch and invocation contracts.
2. `02` migrates command registration and root use before installer parsing changes.
3. `03` establishes command-only launcher/locator transaction behavior.
4. `04` composes provider reconciliation and conservative removal into that lifecycle.
5. `05` and `06` may proceed in parallel after `04`; their ownership is background invocation versus pure status inspection.
6. `07` follows `06`.
7. `08` follows both `05` and `07`.

```text
01 ── 02 ── 03 ── 04
                   ├── 05 ──────┐
                   └── 06 ── 07 ├── 08
```

## Primary File Ownership

| Chunk | Primary ownership | Deliberate sequential handoff |
| --- | --- | --- |
| `01` | New runtime launch-context/invocation modules, central `src/commands/register.ts` bootstrap, `src/cli.ts`, focused runtime tests | `src/commands/register.ts` is a compile-safe bridge and transfers sequentially to `02`; `src/cli.ts` root resolution remains stable |
| `02` | `src/commands/register.ts` context propagation, root-injection edits across `src/commands/*.ts`, command tests | Registration bridge and module signatures change together; `src/commands/install.ts` then transfers to `03`/`04` sequentially |
| `03` | Root `install`, `package.json`, launcher/locator/journal modules, base install command/service/types, install transaction tests | Base command-only lifecycle transfers to provider composition in `04` |
| `04` | Provider lifecycle composition in install command/service/types; `src/install/codex.ts`; provider/install tests | Codex ownership transfers to invocation-only changes in `05` |
| `05` | Codex shim argv, `src/ingest/runtime.ts`, internal maintenance CLI routes, `src/commands/register.ts`, both auto-maintenance spawners, invocation tests | Central registration bootstrap transfers after `02`; maintenance routes preserve its context contract; no `src/cli.ts` or status files |
| `06` | Status contracts, pure inspectors, aggregation/service, status-service fixtures | Public rendering/CLI wiring transfers to `07` |
| `07` | `src/commands/status.ts`, human renderer, exact JSON serialization/fixtures, command-status tests | No installer or worker files |
| `08` | `README.md`, `docs/CLI.md`, `docs/IMPLEMENTATION_ALIGNMENT.md`, `Makefile`, Step 10 roadmap evidence, isolated acceptance harness/artifacts | Named-file edits only; preserve pre-existing roadmap changes |

## Shared Contracts And Integration Points

- `LaunchContext`: authoritative Myelin root, caller cwd, invocation kind, root source, launcher path, and locator path.
- Root precedence: test dependency, validated internal hook/worker environment, machine locator for installed invocation, source-entrypoint path for contributor invocation; never caller cwd.
- Machine locator: `~/.myelin/install.json` schema version 1, modes, launcher hash, providers, timestamps, and source revision.
- Installation journal: `~/.myelin/install-journal.json`, action-state recovery, manifest-last promotion, and conservative ownership verification.
- Installer CLI: preview-first `install`/`uninstall`, `--apply`, `--rebind`, `--bin-dir`, repeatable `--provider`, and `--command-only`.
- Provider ownership: adapters contribute provider actions; the unified lifecycle owns manifest composition and full uninstall.
- Background invocation: absolute installed launcher when available; explicit Bun source argv only for source/test contexts; registered target repo remains cwd.
- Status health vocabulary: `healthy`, `attention`, `blocked`; source-specific normalized lifecycle values; `needs_review > 0` is attention.
- `myelin.status.v1`: exact top-level envelope and installation/Session/Project sections from the approved spec; machine evidence paths absolute and checkout evidence paths Myelin-root-relative.
- Read-only status boundary: SQLite queries, file reads/stats, and PID probes only; no job refresh, lock cleanup, index retry, or state write.

## Approved-Source Coverage

| Requirement / Acceptance Criterion | Covered By | Notes |
| --- | --- | --- |
| Invoke `myelin` from any cwd without `bun src/cli.ts` | `01`, `02`, `03`, `08` | Launcher plus root/cwd separation and end-to-end smoke |
| Resolve authoritative Myelin root once | `01`, `02` | Includes source, installed, hook, worker, and test contexts |
| Preserve caller cwd for registered-project discovery | `01`, `02`, `08` | Includes unrelated-cwd failure instead of first-project fallback |
| Copied launcher, not symlink or duplicated app | `03` | Includes removal of competing private-package bin path |
| Fixed `~/.myelin` locator/ownership contract | `03` | Schema, permissions, hashing, rebind, collision, journal recovery |
| Unified previewable install/provider/uninstall lifecycle | `03`, `04` | Command-only transaction first, then auto-detection, explicit Codex, and full/provider-only uninstall |
| Preserve checkout config, memory, state, and unrelated hooks | `03`, `04`, `05` | Covered by transaction ownership, provider regressions, and shim migration |
| Hooks/workers use stable absolute invocation | `05` | No PATH reliance; target cwd and internal env preserved |
| Operator docs use installed command | `08` | Source form retained only for contributors |
| Operational health without internal inspection | `06`, `07` | Installation, Session, Project, queues, jobs, locks, logs, retrieval |
| Status is strictly read-only | `06`, `08` | Includes SQLite/file content/hash and mtime evidence |
| Deterministic source-to-severity and lock rules | `06` | Exact approved matrix and liveness rules |
| Human/JSON parity | `07` | Shared normalized result model |
| Replace shallow JSON with `myelin.status.v1` | `07` | Legacy fields removed; Step 12 seam retained |
| Exit 0 for successfully observed blocked state | `07` | Nonzero only when trustworthy contract cannot be built |
| Step 10 is sufficient for external dogfood | `08` | Isolated cross-cwd proof; real Class Kit/Droplet Bot runs remain Step 11 |
| Keep MCP, Current Briefing, Practice, Personal, and public curl acquisition out of scope | All | Explicit non-goals in every detailed chunk |

## Verification Strategy

- Use test-first sequencing for each changed contract where the repository already has Bun tests.
- `01`/`02`: focused runtime and command tests for launch precedence, context injection, project inference, and unrelated cwd.
- `03`: launcher/locator transaction tests with temporary HOME, bin, locator, and journal roots; assert modes, hashes, recovery ordering, collisions, PATH warning, and preserved files.
- `04`: provider/install tests assert detection/selection, unselected preservation, full/provider-only uninstall, unrelated hooks, and canonical-state preservation.
- `05`: existing Codex, ingest-runtime, and maintenance scheduler tests assert absolute argv and target cwd/environment.
- `06`: pure inspector and status-service fixtures cover every source-to-severity row; compare authoritative content/hashes before and after observation, with mtimes as secondary evidence only.
- `07`: exact JSON fixture tests, human-rendering assertions, and CLI exit-code cases.
- `08`: an isolated end-to-end temp-root smoke invokes the copied launcher from the Myelin checkout, a registered external fixture repo, and an unrelated cwd; actual user-home installation remains separately authorized.
- Every chunk runs its focused `bun test <paths>` checks and `bun run typecheck` where its contract compiles across modules.
- Final plan-set verification runs `bun test`, `bun run typecheck`, and `git diff --check`.

## Risks And Sequencing

- Command migration is broad. `02` must stay mechanical and avoid changing command behavior beyond approved root/cwd and project-resolution semantics. It precedes all install parser changes.
- Installation is the highest mutation risk. `03` must prove journal/ownership recovery before `04` adds provider and full-uninstall writes.
- `src/commands/install.ts` transfers sequentially from context wiring in `02` to transaction parsing in `03` and provider composition in `04`; these chunks are not parallel.
- `src/commands/register.ts` transfers from the compiling boundary bridge in `01` to per-command context propagation in `02`; Chunk 01 never needs unsupported registration arguments.
- `src/install/codex.ts` transfers sequentially from lifecycle behavior in `04` to invocation-only changes in `05`.
- `src/commands/register.ts` transfers again to `05` only to add internal maintenance routes through the established context bootstrap; `src/cli.ts` remains unchanged.
- `05` must preserve `isProcessAlive(pid: number): boolean` in `src/ingest/runtime.ts` because parallel Chunk `06` may consume that pure export; `08` runs the two branches' focused suites together at the join.
- Status must not call existing mutating ingest refresh behavior. `06` should introduce dedicated pure readers even where a current service appears reusable.
- Lifecycle strings can drift across sections. `06` owns centralized normalization before `07` freezes JSON fixtures.
- A copied launcher can be outside active PATH. `03` reports that condition honestly, and `08` verifies the docs match the warning.
- The design is intentionally macOS/Bun-first. Cross-platform installers and public curl integrity/version selection remain future distribution work.
- The current worktree contains pre-existing `docs/ROADMAP.md` changes. Planning and execution must preserve them and avoid treating the dirty tree as disposable.

## Execution Handoff

This plan set is ready for user review but is not approved for implementation. Executors must not begin until the user explicitly approves the complete plan set for execution.

Each detailed chunk plan and its executor must load:

- this `plan.md`;
- the approved `spec.md` and `agenda.md`;
- `CONTEXT.md` and `MYELIN.md`;
- ADR 0068;
- the current code/tests named in Source Artifacts And Repository Evidence.

Valid execution order must follow the dependency graph above. Execution must stop on a product-contract conflict, unexpected ownership collision, inability to preserve existing user changes, missing test isolation for machine paths, or any proposal to mutate real user-home installation state without explicit approval.

## Roadmap Audit

- Auditor: Senior Project Manager sub-agent `/root/senior_pm_roadmap_audit`, using `plan-auditor` in roadmap-audit mode.
- Initial verdict: `Needs Refinement` (50/70).
- Initial critical issues: unsafe parallel ownership between command migration and installer work; oversized combined machine-lifecycle chunk.
- Refinement: made `01 → 02 → 03 → 04` sequential, split launcher/locator transaction from provider reconciliation/removal, added primary file ownership and sequential handoffs, and updated coverage, verification, risks, and deferrals.
- Focused re-audit verdict: `Ready for Development` (65/70), interpreted as ready for user roadmap approval and chunk-plan generation; no critical issues remain.
- Recommendations carried into detailed plans:
  - `03` must state that command-only infrastructure is an intermediate milestone; `04` completes the unified public lifecycle before final acceptance.
  - Plans `02`–`05` must preserve the roadmap's explicit sequential file handoffs.
  - `03` must include failure injection before launcher promotion, before locator promotion, and after launcher promotion but before manifest completion.
  - `04` must include the full provider-preservation matrix across install, repair, provider-only uninstall, and full uninstall.
  - `08` must review the existing `docs/ROADMAP.md` diff before and after its named edit.

## Full Plan-Set Audit

- Auditor: Software Architect sub-agent `/root/software_architect_audit`, using `plan-auditor` in full plan-set executor-readiness mode.
- Initial verdict: `Needs Refinement` (49/70).
- Initial critical issue: Chunk `01` could not both pass context from `src/cli.ts` and typecheck independently while Chunk `02` owned all receiving registration signatures.
- Refinement: added the compile-safe `src/commands/register.ts` bridge in `01`, transferred it sequentially to `02` for atomic command-signature migration, froze the `05`/`06` liveness export, grounded `06` in exact read surfaces, and added executable/join verification.
- Focused re-audit verdict: `Ready for Development` (64/70), interpreted as ready for `$pmp-executing-plans` after explicit user execution approval; no critical issues remain.
- Final cleanup from non-blocking recommendations: Chunk `05` registers maintenance routes through the central bootstrap, and Chunk `06` asserts status creates no SQLite sidecar files.
- Final focused confirmation: `Ready for Development` (65/70); no regression, stale path, ownership conflict, or critical issue remains. The final plan set is ready for `$pmp-executing-plans` after explicit user approval.

## User Approval

- Roadmap approved by: User on 2026-07-10
- Plan set approved for execution by: Pending
