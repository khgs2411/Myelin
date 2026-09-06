# Current application tests

The suites protect the approved Step 2 capture contracts. They do not cover
future Session Memory, installed commands, or Codex hook capture.

## Commands

```sh
bun run test              # Current unit and isolated integration suites
bun run test:unit         # Pure contracts and controlled collaborators
bun run test:integration  # Temporary filesystem, Git, SQLite, and processes
bun run typecheck        # Includes compile-only error contract checks
```

Use these scripts instead of an unqualified `bun test`. Explicit `./tests/...`
paths keep the deprecated product out of test discovery. Bun treats bare path
arguments as substring filters: see [Bun test discovery](https://bun.com/docs/test/discovery).

`bun run test:sanity` remains an explicit development-environment check. It opens
the seeded `.llm-wiki-dev/state.sqlite` and can apply migrations. It is excluded
from the default command and was not run as part of this test work.

## Approved contracts and owners

| Suite | Guarantees |
| --- | --- |
| [Native source](unit/native-source-material.test.ts) | Lossless supported values; stable recursive key ordering; meaningful differences; unsupported values and structures; cycle detection; no mutation or getter execution |
| [Fixture adapter](unit/development-capture.adapter.test.ts) | Fact mapping; complete source; valid empty content; field and time validation; replay identity independent of content; distinct coordinates; fixed v1 hash vector |
| [Adapter factory](unit/capture-adapter.factory.test.ts) | Usable fixture adapter; unsupported routes never fall back |
| [Capture service](unit/evidence-capture.service.test.ts) | Ordered DTOs; one managed Project; complete resolution before persistence; failure prevents writes; receipt and error propagation |
| [Application errors](unit/application-error.test.ts) | Stable identity and safe messages; optional causes retained internally |
| [Error type checks](types/application-error.typecheck.ts) | Unknown codes and invalid arguments fail compilation; domain-specific types remain distinct |
| [Workspace resolution](integration/workspace-resolution.integration.test.ts) | Registered roots and descendants; most-specific ownership; path boundary checks; invalid directories |
| [Git context](integration/workspace-context.integration.test.ts) | Canonical paths; managed/unmanaged outcomes; optional Git; normal, detached, and unborn HEAD; configured upstream mapping; missing commits; unavailable observations; local-only reads; independent snapshots |
| [Repository and application](integration/capture.integration.test.ts) | Exact storage; Project-local sequences; atomic rollback; replay identity and original snapshots; SQL integrity; restart; concurrent writers; Application composition; trusted routing; CLI receipts, safe failures, output and cleanup outcomes |

## Isolation and verification boundaries

- SQLite assertions use a separate SQL connection and inspect rows and counters,
  independently of the returned receipts. The real runtime applies migrations.
- Every capture test owns a temporary registered Project. Evidence is never
  deleted to reset a test; cleanup removes the complete temporary database only
  after its connections and child processes close.
- Application and CLI integration use fresh Bun processes. The test entry calls
  the existing `runCli` with a temporary database. This covers command behavior,
  not host installation or the fixed development path in the executable.
- Output, cleanup, and unexpected repository failures are injected only in the
  child-process test entry. Successful persistence and rollback use real SQLite.
- Concurrent writers wait at an explicit gate after startup. The assertions
  accept a SQLite lock failure but require atomic outcomes, unique evidence,
  and valid sequences. They do not promise automatic retry or writer order.
- Git repositories, commits, configuration, and local remotes are temporary.
  Tests ignore global/system Git configuration and do not contact external
  remotes. The no-fetch case advances a local remote while retaining an older
  tracking commit in the observed repository.
- Filesystem/Git suites are integration tests. Existing directory-resolution
  coverage moved from `unit` accordingly.
- Tests run sequentially by default. Do not add `--concurrent`: individual
  integration cases temporarily control process environment or shared schema
  failure triggers. The writer test creates its own explicit concurrency.

No production behavior or runtime dependency was changed to enable these tests.
