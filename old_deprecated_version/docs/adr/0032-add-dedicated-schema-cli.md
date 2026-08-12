# Add a dedicated schema CLI surface

V2 should expose schema maintenance through dedicated commands instead of hiding it inside `project learn`. The initial schema CLI surface is `schema check <project>`, `schema build <project>`, `schema candidates <project>`, and `schema apply <candidate-id>`. `project learn` may discover schema candidates, but explicit schema commands make validation, context generation, review, and application clear to operators and agents.
