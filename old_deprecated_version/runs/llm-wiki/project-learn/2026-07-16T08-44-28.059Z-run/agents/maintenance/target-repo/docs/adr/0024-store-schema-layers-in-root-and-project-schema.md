# Store schema layers in root and project schema directories

Global authored schema instructions live under root `schema/`. Project-local authored schema instructions live under `projects/<key>/schema/`. The agent-facing schema context is generated state, for example `projects/<key>/state/schema-context.json`, and must not be hand-edited. This keeps schema instructions readable and versionable while giving agents a deterministic compiled contract to consume.
