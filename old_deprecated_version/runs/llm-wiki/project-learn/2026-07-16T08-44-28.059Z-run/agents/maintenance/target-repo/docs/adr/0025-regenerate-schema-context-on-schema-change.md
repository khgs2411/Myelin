# Regenerate schema context on schema changes

`schema-context.json` is generated state derived from global `schema/` and project-local `projects/<key>/schema/` inputs. It should regenerate when those authored schema inputs change, and `project learn` should verify freshness before learning. If inputs are unchanged, the generator should avoid rewriting the compiled context so state churn stays low and diffs remain meaningful.
