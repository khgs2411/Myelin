# `src/storage/sqlite/sqlite-database.ts`

> Pseudocode artifact. Non-executable reference shape.

Intended destination: `src/storage/sqlite/sqlite-database.ts`

`SqliteDatabase` owns one process-scoped Sequelize connection lifecycle. It is
created once by `Application.create`, injected into SQLite repositories, and
closed when that application process finishes. It is not a global singleton and
does not inherit from a generic database base class.

```ts
// intentionally illustrative pseudocode

type InitializedSqliteRuntime = Readonly<{
  compatibleSqlite3Module: module compatible with @sequelize/sqlite3
  sqliteVecExtensionPath: absolute packaged binary path
  initializeConnection: async operation that applies required PRAGMAs
    and loads sqliteVecExtensionPath on each opened connection
}>

type SqliteDatabaseConfiguration = Readonly<{
  databasePath: absolute application-state file path
  runtime: InitializedSqliteRuntime
}>

type SqliteTransaction = Sequelize transaction bound to this database instance

class SqliteDatabase {
  private constructor(
    private readonly sequelize: Sequelize
  ) {}

  static async open(
    configuration: SqliteDatabaseConfiguration
  ): Promise<SqliteDatabase> {
    require configuration.runtime was initialized before this call

    sequelize = construct pinned Sequelize v7 alpha with:
      dialect: SqliteDialect from pinned @sequelize/sqlite3
      storage: configuration.databasePath
      sqlite3Module: configuration.runtime.compatibleSqlite3Module
      infrastructure models established by later persistence design
      connection initialization supplied by configuration.runtime

    TRY
      await sequelize.authenticate()
      ensure every opened SQLite connection receives required initialization:
        apply established connection PRAGMAs
        load the packaged sqlite-vec extension
      verify the connected runtime provides:
        expected SQLite build
        foreign-key enforcement
        FTS5
        sqlite-vec

      return new SqliteDatabase(sequelize)
    CATCH failure
      close any partially initialized Sequelize resources
      fail database opening with a safe infrastructure diagnostic
  }

  async writeTransaction<T>(
    operation: (transaction: SqliteTransaction) => Promise<T>
  ): Promise<T> {
    return sequelize managed transaction with:
      SQLite transaction type: IMMEDIATE
      explicit transaction handle passed to operation
      automatic commit when operation succeeds
      automatic rollback when operation fails
  }

  async close(): Promise<void> {
    await sequelize.close()
  }
}
```

## Process-scoped lifetime

Each installed-command invocation is a separate process and constructs one
`Application`. `Application.create` opens one `SqliteDatabase` for that process
and shares it through dependency injection. A static singleton would not share
connections across provider-hook processes and could silently reuse the first
database configuration inside one process.

The application closes the database during process cleanup. Explicit lifetime
ownership supports alternate database paths, isolated temporary databases, and
clean failure recovery without a global instance registry.

## Sequelize boundary

Sequelize v7 alpha is the selected ORM and must be pinned with its compatible
`@sequelize/sqlite3` dialect. Sequelize owns model mapping, ordinary relational
operations, and managed transaction lifecycle. It does not own the packaged
SQLite build, extension compatibility, domain transaction meaning, or schema
migration policy.

SQLite-specific SQL remains allowed where the ORM is not the correct
abstraction. FTS5 virtual tables, sqlite-vec operations, capability checks,
PRAGMAs, and versioned migrations may use parameterized raw SQL through the
same Sequelize connection and transaction.

## Transaction boundary

`writeTransaction` supplies the `IMMEDIATE` SQLite transaction required by
evidence acceptance. Repositories participating in one
`EvidenceAcceptanceService.accept()` operation receive its explicit transaction
handle. They do not open independent or nested transactions.

`EvidenceLogRepository.append` is the first shaped repository operation. The
exact read/query surface and other repository contracts remain `OPEN` until
their domain operations are shaped. `SqliteDatabase` does not become a generic
service locator or expose persistence operations to application workflows
directly.

## Runtime dependency

`SqliteRuntime` initializes and verifies the application-packaged SQLite driver
and matching sqlite-vec binary before `SqliteDatabase.open` constructs
Sequelize. The ORM does not satisfy the zero-host-dependency contract by itself.
Every supported platform package must prove that its selected driver can load
the packaged extension on every connection.

The runtime, package manager, platform matrix, migration owner, model registry,
and remaining repository filenames remain unresolved by this artifact.
