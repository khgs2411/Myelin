# Operator Health Check

## Outcome

Myelin can report whether the local repo, config, schema, provider, and memory state are ready.

## Why it matters

Agents and humans need fast diagnosis before running write workflows.

## Scope

- Config presence.
- Project registration.
- Schema freshness.
- SQLite state accessibility.
- Provider CLI availability.
- Pending/stale queues.

## Done means

- A health command or status section explains what is ready and what needs repair.
- Failures include concrete next commands.

## Notes

- Keep this operational, not a product-design report.
