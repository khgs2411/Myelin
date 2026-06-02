# Quarantine V1 and rewrite the core clean

Phase 0 migrates the core runtime by moving the V1 Python/Bash implementation (`agents/`, `scripts/`, root `tests/`, `Makefile`, `pyproject.toml`) into a git-tracked `legacy/` reference folder and rewriting `src/` fresh in Bun/TypeScript, rather than porting V1 in place for behavior parity.

Physical separation prevents accidental parity-chasing, makes the break explicit instead of a long half-Python/half-TypeScript straddle, and reduces retirement to deleting one folder. `/mcp` and project data stay in place. No V1 behavior is an acceptance target; useful project knowledge, raw sources, and provenance are preserved through the new layout. The product is barely used today, so breaking weak V1 runtime behavior is acceptable. This extends the complete-migration-first and V2-over-compatibility decisions (0013, 0015) with a concrete rewrite strategy.
