# Scope the Phase-0 pipeline to the happy path

Phase 0 ports the pipeline orchestration plus the minimum stages needed to produce a coherent, validated wiki update end-to-end, and defers the convergence/quality stages. The design redesigns pipeline internals later (Project Memory Refinement), so Phase 0 does not gold-plate them.

In Phase 0:

- `project learn`: sense → impact → propose → apply → validate (structural rules).
- `project ingest`: ingest → apply → validate (structural rules, INGEST_MODE relaxations).
- On validate failure, Phase 0 surfaces findings and stops; it does not auto-reconcile.

Deferred past Phase 0: acceptance-question generation, the bounded reconcile loop, the ingest self-correct pass, and `measure`. These are quality/convergence enhancements, not prerequisites for a working migrated pipeline.

Stages run the existing instruction markdown/JSON as data through the provider abstraction (ADR 0051). All internal stage semantics are provisional pending the later pipeline redesign. The structural validators carried into Phase 0 are the ones that still make sense for the V2 layout; rules that assume the V1 ranked-domain taxonomy are revisited with the layout change (Task 5), not preserved by default. This scope is refinable once the stages are read during implementation.
