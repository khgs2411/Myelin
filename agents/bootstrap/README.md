# Bootstrap Agents

Each bootstrap stage is its own agent folder.

Every stage folder owns:

- `instructions.md`: the only stage-specific prompt/contract file to edit
- `agent.json`: stage metadata consumed by the generic runner
- `run.sh`: stage-local entrypoint

The root `scripts/` directory should stay generic. Stage-specific execution intent lives here.
