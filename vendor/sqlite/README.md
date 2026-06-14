# Vendored SQLite Runtime

Myelin uses Bun's `Database.setCustomSQLite()` so `sqlite-vec` can load on macOS without depending on Apple's system SQLite, which disables loadable extensions.

Current vendored runtime:

- `darwin-arm64/libsqlite3.dylib`
- SQLite version: `3.53.2`
- Source package used for this prototype: Homebrew `sqlite` on Apple Silicon
- Required by: `src/memory/sqlite-runtime.ts`

Explicit overrides still win:

- `MYELIN_SQLITE_DYLIB_PATH`
- `SQLITE_DYLIB_PATH`

If another platform is needed, add a platform-specific runtime under `vendor/sqlite/<platform>-<arch>/` and extend `vendoredSQLitePath()`.
