# `src/storage/sqlite/sqlite-schema.ts`

> Pseudocode artifact. Non-executable reference shape.

Intended destination: `src/storage/sqlite/sqlite-schema.ts`

`SqliteSchema` owns the application schema supported by this application
version. It registers Sequelize models and applies ordered explicit migrations.
`SqliteDatabase` continues to own the connection and cannot return an opened
database until this owner establishes a compatible schema.

```ts
// intentionally illustrative pseudocode

type SchemaVersion = positive integer

type SqliteMigration = Readonly<{
  version: SchemaVersion
  name: stable migration name
  apply: operation using the supplied Sequelize connection and transaction
}>

const APPLICATION_MODELS = [
  Project
]

const ORDERED_MIGRATIONS: readonly SqliteMigration[] = [
  {
    version: 1,
    name: "create-projects",
    apply(connection, transaction) {
      create the projects table defined by the Project model contract
      create the projects_key_immutable trigger
    }
  }
]

class SqliteSchema {
  static models(): readonly Sequelize model classes {
    return APPLICATION_MODELS
  }

  static async ensureCurrent(
    connection: Sequelize SQLite connection
  ): Promise<void> {
    await one IMMEDIATE transaction:
      create schema_migrations metadata table when absent:
        version INTEGER PRIMARY KEY
        name TEXT NOT NULL
        applied_at TEXT NOT NULL as a UTC RFC 3339 timestamp

      applied = read schema_migrations ordered by version
      require applied migrations are an exact prefix of ORDERED_MIGRATIONS
      reject unknown, reordered, renamed, missing, or newer migrations

      for each pending migration in ascending version order:
        run migration.apply(connection, transaction)
        insert its version, name, and application time into schema_migrations

      require final applied version equals this application's current version

    if any check or migration fails:
      roll back the complete schema transaction
      fail database opening with a safe schema diagnostic
  }
}

NARROW SqliteDatabase.open CHANGE:
  construct Sequelize with:
    existing SQLite dialect and packaged runtime
    models: SqliteSchema.models()

  authenticate
  verify required SQLite runtime capabilities
  await SqliteSchema.ensureCurrent(sequelize)

  only then return the opened SqliteDatabase
```

## Lifecycle boundary

Every invocation checks the schema before repositories or application
operations can use the database. With no pending migrations, the check is
read-only except for first creation of the migration metadata table. With
pending migrations, their schema changes and metadata records commit together.

An application version never downgrades a database and never uses
`sequelize.sync()` as schema authority. A database with migration history that
is not a known prefix fails before Project access.

## Ownership boundary

`SqliteSchema` owns:

- the complete Sequelize model registry;
- the ordered immutable migration registry;
- migration-history validation; and
- application-schema establishment.

`SqliteDatabase` owns:

- the SQLite connection and packaged runtime;
- connection capability checks;
- the transaction mechanism; and
- cleanup after schema failure.

Neither owner seeds the local Project row. The separate manual development
action can run only after database opening has established schema version 1.
