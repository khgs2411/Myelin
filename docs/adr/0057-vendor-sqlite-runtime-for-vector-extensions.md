# Vendor SQLite runtime for vector extensions

Myelin vendors a platform-specific SQLite runtime when needed so `sqlite-vec` can load through Bun without requiring a host SQLite installation. On macOS, Apple's system SQLite disables loadable extensions, so relying on Bun's default SQLite can make vector indexing unavailable even when the `sqlite-vec` package is installed.

**Considered Options**

- Require operators to install Homebrew SQLite and configure Bun to use it.
- Keep Homebrew auto-detection as the primary runtime behavior.
- Vendor a known-good SQLite runtime inside Myelin and use host SQLite only as fallback.
- Replace `sqlite-vec` with a pure TypeScript vector fallback.

**Decision**

Use a Myelin-owned vendored SQLite runtime before host fallbacks. Runtime resolution order is explicit override, vendored SQLite, Homebrew SQLite fallback, then Bun's default SQLite behavior. The first vendored runtime is `vendor/sqlite/darwin-arm64/libsqlite3.dylib`; other platforms must add their own runtime before claiming host-independent support.

**Consequences**

Apple Silicon macOS can run Session Memory vector indexing without installing SQLite separately. Myelin now owns the version and provenance of the SQLite runtime it loads, but must maintain platform-specific binaries, licensing/provenance notes, and tests that prove `sqlite-vec` loads from the vendored path. Host SQLite remains a convenience fallback, not the product contract.
