# Stubbed Model Runs

## Outcome

Model-backed workflows can run deterministically in tests.

## Why it matters

Memory behavior needs test coverage without depending on network or vendor CLIs.

## Scope

- Stub response lookup.
- Deterministic outputs.
- Clear failure when a stub is missing.

## Done means

- Pipeline/query tests can exercise model paths without calling a real model.

## Notes

- Existing stub support should be preserved as workflows expand.
