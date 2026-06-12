# Learn Changeset Record

## Outcome

Every applied `project learn` run leaves a reproducible changeset record.

## Why it matters

Auto-applied memory updates need auditability and rollback context.

## Scope

- Run id.
- Schema-context hash.
- Before/after file hashes.
- Source evidence.
- Risk classification.
- Validation results.

## Done means

- A human can inspect exactly what changed and why.
- Failed validation leaves enough state for review.

## Notes

- Related: `MYELIN.md` section 8.
