# Use flexible candidate payloads in the V2 memory slice

Memory Candidates require structured routing fields such as `candidate_type`, `title`, `summary`, `project_key`, `source`, `mode`, and `status`, but keep `payload_json` free-form. The deterministic system routes candidates by `candidate_type`, not by payload shape. Scope-specific payload schemas are deliberately deferred until real Project Memory, Session Memory, Practice Memory, and Personal Memory candidate examples show which fields are useful.
