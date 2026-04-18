Sample is a minimal Python fixture whose runtime flow logs in a user, writes user-scoped data to an in-memory store, and prints the stored record.

## Start here

- [entry-point](wiki/systems/entry-point.md) - start here to see the only executable path and how modules connect
- [authentication](wiki/systems/authentication.md) - follow the session lifecycle and in-memory identity lookup
- [data-store](wiki/systems/data-store.md) - inspect where the sample payload is stored and retrieved

## Routing

### Systems

- [entry-point](wiki/systems/entry-point.md) - wiring of login, identity lookup, store write, and print
- [authentication](wiki/systems/authentication.md) - session creation, lookup, and invalidation
- [data-store](wiki/systems/data-store.md) - in-memory key-value storage helpers

## Gaps and deferred

- No runbook page yet because the repo only exposes a single documented invocation in `README.md:11-14`
- No additional ranked domains were deferred; the current snapshot only surfaced these three runtime entry paths

## Status

- Last update: 2026-04-19T07:19:34.466453+00:00
- Freshness: see `state/latest/validation-report.md`
- Measurement: see `state/latest/measurement-report.md`
