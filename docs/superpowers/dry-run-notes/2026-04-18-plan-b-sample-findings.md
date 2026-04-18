# Plan B Dry-Run Findings — Sample Project

**Date:** 2026-04-18
**Backend(s):** codex
**Bundle(s):** `docs/superpowers/dry-run-notes/artifacts/20260418-211215-dry-run/`

## Outcome

- Pipeline exit code: 0
- Total wall-clock time (seconds): 288.71
- Last stage reached: `apply_commit`
- Wiki pages produced (count): 3
- Wiki pages expected (count, from the ranking or manual estimate): 3
- Pipeline outcome in one sentence (factual, not impressionistic): The codex-backed dry run completed `sense -> impact -> propose -> apply -> apply_commit`, wrote three wiki pages plus a new `index.md`, and advanced `last_seen_commit` for the sample project copy.

## Per-stage results

### Sense
- Stage reached: yes
- Exit status: 0
- `sense-report.json` written? yes
- inbox_sources count / expected: 0 / 0
- changed_paths count: 6
- mode (`first-run | incremental | no-git`): `first-run`
- Issues observed: None observed.

### Impact — Ranking sub-task
- Stage reached: yes
- `ranking-snapshot.json` written? yes
- ranked_domains count / cutoff: 3 / 20
- Top 5 domain names: authentication, data-store, entry-point
- Quote one `signal_c_reasoning` entry verbatim: "README.md:7-7 and src/main.py:7-8 show authentication owns session lifecycle and is directly exercised by the entry flow."
- Signals distribution (how many A-only, A+B, A+B+C): 0 / 0 / 3
- Issues: None observed.

### Impact — Delta sub-task
- Stage reached: yes
- `impact-report.json` written? yes
- affected_pages count: 0
- new_domains count: 3
- stale_pages count: 0
- Issues: None observed.

### Propose
- Stage reached: yes
- `proposal.json` written? yes
- Units by action (create N, update M, delete K, rename J): create 3, update 0, delete 0, rename 0
- Pre-flight pass/fail (if fail, which rule): pass
- Any units with missing/invalid fields (how many, which fields): 0, none observed
- new_pages_count vs max_new_pages: 3 vs 25
- deferred_domains count: 0
- Quote one `justification` entry verbatim: "Signal A documents authentication as a top-level repo structure item and architecture layer, Signal B shows a dedicated implementation in `src/auth.py` plus direct use from `main()`, and Signal C explains that it owns the session lifecycle exercised by the entry flow."

### Apply
- Stage reached: yes
- Units applied (count): 3
- Units deferred to pending-approvals (count): 0
- `index.md` regenerated? yes
- Do wiki pages exist on disk? Name them: `wiki/systems/authentication.md`, `wiki/systems/data-store.md`, `wiki/runtime/entry-point.md`

### apply_commit
- Stage reached: yes
- Exit status: 0
- `last_seen_commit` advanced? From what to what (short shas): `null` -> `34e9a2b`
- Changelog entry appended? yes

## Wiki quality (eyeball check)

- `wiki/systems/authentication.md` matches `src/auth.py` and `src/main.py` accurately, and its repo pointers for `SESSIONS`, `login`, `logout`, and `whoami` line ranges are correct.
- `wiki/systems/data-store.md` matches `src/db.py` accurately, and the `main()` integration note correctly points at the write/read flow in `src/main.py:6-9`.
- `wiki/runtime/entry-point.md` accurately summarizes the only executable path in `src/main.py`, and its links back to the two system pages resolve correctly.

## JSON-contract issues

- `ranking-snapshot.json`, `impact-report.json`, and `proposal.json` were valid JSON and apply pre-flight accepted all proposal units without missing-field or line-range errors.
- **Unprescribed shelf invented.** The propose agent placed `entry-point` under `wiki/runtime/entry-point.md`. `runtime/` is not one of the nine prescribed category shelves in the wiki contract (`architecture`, `systems`, `modules`, `integrations`, `decisions`, `runbooks`, `sessions`, `glossary`, `open-questions`). Evidence: `project-copy/sample/state/pages.json` recorded `"type": "runtime"` as if it were a legitimate shelf. The apply pre-flight did not reject this, so the wiki now contains a page in an undocumented location.

## Validator needs for Plan C

- Verify that every citation in generated wiki content resolves to an existing file and line span in the target repo copy.
- Verify that every ranked domain inside the cutoff is either materialized as a page or explicitly listed in `deferred_domains`.
- Verify that `proposal.json` action counts match the on-disk apply result, including `new_pages_count` and the set of written wiki paths.
- Verify that `index.md` links and `Related` links resolve to files that exist after apply.
- **shelf-allowlist check (deterministic, no LLM needed).** Reject any `proposal.json.units[i].page_path` whose first directory under `wiki/` is not one of: `architecture`, `systems`, `modules`, `integrations`, `decisions`, `runbooks`, `sessions`, `glossary`, `open-questions`. Apply this at propose-stage schema validation and at apply-stage pre-flight. The same rule must also guard `rename_from`. Real-run evidence: this dry run produced `wiki/runtime/entry-point.md`, which slipped through every current check.

## Reconcile needs for Plan C

- Reconcile should be able to regenerate `index.md`, restore missing wiki pages from an already-approved proposal, and repair broken relative links when the intended targets are unambiguous.
- Reconcile should be able to create pages for ranked domains that were omitted accidentally when the proposal already contains enough evidence to do so safely.
- Reconcile should punt to the operator when the failure is semantic rather than structural, such as a page claiming behavior the cited source does not support or a domain split that is conceptually ambiguous.

## Measurement needs for Plan C

The sample took 288.71 seconds end-to-end, but this run does not yet provide a usable cost baseline because the real path only records approximate `input_chars` and does not emit normalized output token data. The 30% reduction goal is not credible to measure on this evidence alone; Plan C needs per-stage timing plus normalized token accounting across stub and real backends before re-baselining.

## Non-goals / out of scope

- No claude cross-backend run was executed in this phase.
- No retry, backoff, or cost-optimization work is being added from this sample run.
- No validator or reconcile stage is being implemented inside Phase 1.
- No `rpg_game` rebootstrap work is in scope here.

## Recommendations for Plan C scope

- Add a validator stage that checks citation resolvability, link integrity, ranked-domain coverage, and proposal-vs-apply consistency.
- Add a reconcile stage that can autonomously repair structural drift such as missing pages, broken links, or stale `index.md` output, while escalating semantic mismatches.
- Add a measurement stage that records real per-stage timing and normalized backend cost fields so runtime and token-reduction goals can be evaluated from evidence.
- Include the shelf-allowlist validator as a first-class, deterministic Plan C deliverable. This run produced concrete evidence (`wiki/runtime/`) that the LLM will invent shelves if unchecked; the rule costs nothing to enforce and removes an entire class of contract violations.
