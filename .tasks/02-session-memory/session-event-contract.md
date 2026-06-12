# Session Event Contract

## Outcome

Myelin has a clear contract for high-signal session events.

## Why it matters

Session memory becomes noisy if it mirrors every tool call. It needs a small, meaningful event vocabulary.

## Scope

- `session.note`
- `session.stop`
- `memory.candidate`
- `answer.correction`
- Required routing fields for project, source, mode, and candidate scope.

## Done means

- Events can be validated before storage.
- Invalid candidate scopes fail loudly.
- The contract is documented where future agents will find it.

## Notes

- Related: `MYELIN.md` section 9.4.
