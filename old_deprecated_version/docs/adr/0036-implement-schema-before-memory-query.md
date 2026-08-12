# Implement schema before memory query

The TypeScript migration should implement schema functionality before `memory query`. Query behavior should consume schema context for taxonomy, memory scopes, freshness rules, and provenance expectations from the start. The old query planner is reference material only; V2 query should not recreate V1 routing assumptions when the schema context defines a better contract.
