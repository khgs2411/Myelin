# Use a checkout-backed launcher and machine locator

Myelin machine installation uses a copied thin launcher at `~/.local/bin/myelin` and a single versioned locator plus ownership record at `~/.myelin/install.json`. The launcher resolves the exact authoritative local Myelin checkout from that record while preserving the caller's working directory for project discovery. It is not a symlink, copied application, or standalone compiled executable. Moving to another checkout requires explicit reinstall with `--rebind`.

The repo-root installer entrypoint and installed `myelin install` share one preview/apply lifecycle for the launcher, locator, and selected Capture Provider integrations. Bare `myelin uninstall` owns full machine removal, while provider-scoped uninstall preserves the launcher and locator. All uninstall paths verify recorded ownership and preserve checkout-owned configuration, canonical memory, source evidence, project state, runs, logs, and root SQLite.

This extends ADR 0055. Machine-level capture with per-repository bootstrap opt-in remains unchanged; this decision adds the executable, root-resolution, ownership, repair, and uninstall contracts needed to use Myelin outside its checkout.
