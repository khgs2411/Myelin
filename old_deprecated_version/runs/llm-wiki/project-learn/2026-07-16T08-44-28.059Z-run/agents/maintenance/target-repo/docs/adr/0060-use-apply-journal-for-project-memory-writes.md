# Use an apply journal for Project Memory writes

Project Memory apply should target all-or-nothing canonical writes by staging rendered outputs, recording an apply journal with the expected write set, promoting canonical files only after the staged set is ready, and updating project-memory state last. If a run is interrupted during promotion, the journal gives Myelin enough evidence to detect partial canonical writes and complete or repair the intended write set rather than treating best-effort partial memory updates as a normal terminal state.

## Considered Options

- All-or-nothing staged writes without explicit recovery state.
- Best-effort writes with changeset evidence.
- Journal-backed staged writes with recovery.

## Consequences

The apply layer needs progress tracking and recovery logic, but future agents do not have to reason about partially applied Project Memory as an expected steady state.
