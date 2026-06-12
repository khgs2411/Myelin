# Trigger Modes

## Outcome

Memory-producing paths consistently support `off`, `queue`, and `auto` modes.

## Why it matters

Automation needs explicit bounds so capture can be useful without silently launching broad agent work.

## Scope

- `off`: raw capture only.
- `queue`: create candidates, no agentic work.
- `auto`: eligible for bounded processing.

## Done means

- Mode behavior is documented and validated.
- Auto mode cannot launch unbounded workers.

## Notes

- Related: ADR 0004.
