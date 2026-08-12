# Start the core TypeScript runtime in root src/runtime

The first core TypeScript runtime modules live under root `src/runtime/*`, not in `packages/runtime`. `/mcp` is detached and must not import core source files, so there is no immediate shared-package consumer. Starting with `src/runtime/*` keeps the migration simple while still creating a clear home for project discovery, config, state, path, and JSON helpers. A package split can happen later if the core repo develops multiple real TypeScript consumers.
