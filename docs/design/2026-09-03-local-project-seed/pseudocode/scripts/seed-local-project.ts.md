# `scripts/seed-local-project.ts`

> Pseudocode artifact. Non-executable reference shape.

Intended destination: `scripts/seed-local-project.ts`

This retained development-only script establishes the fixed `llm-wiki`
Project row. It is a reproducible local seed operation, not a general project
registration command. It accepts no caller-selected key, path, or database.

```ts
// intentionally illustrative pseudocode

#!/usr/bin/env bun

const LOCAL_DATABASE_PATH =
  "/Users/liadgoren/Repositories/llm-wiki/.llm-wiki-dev/state.sqlite"

const LOCAL_PROJECT_SEED = {
  key: "llm-wiki",
  rootPath: "/Users/liadgoren/Repositories/llm-wiki",
  repositoryRootPath: "/Users/liadgoren/Repositories/llm-wiki"
} as const

type LocalProjectSeedResult =
  | Readonly<{
      disposition: "seeded"
      projectIdentity: SQLite-assigned Project identity
      projectKey: "llm-wiki"
    }>
  | Readonly<{
      disposition: "already-seeded"
      projectIdentity: existing Project identity
      projectKey: "llm-wiki"
    }>

async function seedLocalProject(
  database: SqliteDatabase
): Promise<LocalProjectSeedResult> {
  return database.writeTransaction(async transaction => {
    matches = await Project.findAll where:
      key equals LOCAL_PROJECT_SEED.key
      OR rootPath equals LOCAL_PROJECT_SEED.rootPath
      using transaction

    IF matches is empty:
      project = await Project.create with:
        LOCAL_PROJECT_SEED
        lastAllocatedEvidenceSequence: 0
        using transaction

      return {
        disposition: "seeded",
        projectIdentity: project.id,
        projectKey: project.key
      }

    IF matches contains exactly one Project AND
       its key equals LOCAL_PROJECT_SEED.key AND
       its rootPath equals LOCAL_PROJECT_SEED.rootPath AND
       its repositoryRootPath equals LOCAL_PROJECT_SEED.repositoryRootPath:
      return {
        disposition: "already-seeded",
        projectIdentity: existing Project id,
        projectKey: existing Project key
      }

    fail with a safe local-seed conflict diagnostic
    make no database changes
  })
}

async function main(args: readonly string[]): Promise<process status> {
  require args is empty

  runtime = await SqliteRuntime.initialize()
  database = absent

  TRY:
    database = await SqliteDatabase.open({
      databasePath: LOCAL_DATABASE_PATH,
      runtime
    })
    // Opening establishes the current schema and registers Project.

    result = await seedLocalProject(database)

    write one concise human result for:
      "seeded" OR "already-seeded"
      include the public Project key

    return successful process status

  CATCH failure:
    write one safe diagnostic without a stack trace
    return unsuccessful process status

  FINALLY:
    IF database exists:
      await database.close()
}

IF this file is the Bun entrypoint:
  process.exitCode = await main(Bun.argv after the script path)
```

## Replay and conflict boundary

An exact existing identity-and-path match is a successful no-op. The script
does not require `lastAllocatedEvidenceSequence` to remain zero and never
resets it. This keeps the seed safe after the Project receives evidence.

Any key collision, root collision, or repository-root mismatch fails the
transaction. The script does not update, relocate, delete, or repair an
existing Project.

## Application boundary

The script opens `SqliteDatabase` and uses the registered `Project` model
directly. It does not call `Application.create()`, because normal application
composition consumes existing Project registration state rather than creating
that prerequisite.

The script is not routed through `cli.ts`, declared as a package `bin`, or
included in production installation. It does not create Session state, accept
evidence, inspect Git, canonicalize paths, or support another Project.
