# Use managed immutable runtime versions

Myelin machine installation stores immutable runtime snapshots under `~/.local/share/myelin/versions/` and activates one snapshot through the machine locator at `~/.myelin/install.json`. The stable launcher remains at `~/.local/bin/myelin`. This supersedes the executable-binding portion of ADR 0068; the checkout remains Myelin's durable data root and install source, but installed commands no longer execute mutable source files from it.

The V2 locator separates `data_root` from `active_version.path`. Source invocations use the checkout for both roles. Installed, hook, and worker invocations use the durable data root for configuration, projects, state, schema, and memory while loading code and vendored runtime assets from the active immutable version.

An installation computes a deterministic content identity from the runtime allowlist, stages it under a transaction-specific directory, verifies that staged bytes still match the plan, atomically promotes it into `versions/<version-id>`, then atomically switches the locator. The version manifest records product version, source revision, dirty-source state, content hash, lockfile hash, entrypoint, and installed artifacts. Dirty local builds are supported because the content digest, rather than Git revision alone, is authoritative.

Activation is verified through the stable launcher. Verification failure restores the previous locator. Successful upgrades retain one previous version for rollback and remove older manifest-owned versions; `install --prune --apply` removes every inactive owned version. `install --rollback --apply` swaps the active and previous versions through the same verified transaction. Garbage collection and uninstall never delete unknown directories or the durable data root.

Provider shims execute the stable launcher and contain no data-root or runtime-root binding. Provider files are promoted atomically, preserve unrelated hooks, and can recover when a desired shim was written before its ownership manifest. The locator is the sole active-version authority.
