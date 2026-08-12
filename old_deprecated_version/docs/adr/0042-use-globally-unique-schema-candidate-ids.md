# Use globally unique schema candidate ids

Schema candidate IDs are globally unique, and each candidate stores `project_key` for ownership. This keeps `schema apply <candidate-id>` unambiguous while preserving project scope. Candidate storage may remain project-local generated state JSON in this migration slice, but IDs should still be globally unique to avoid ambiguity across projects and future storage backends.
