# Source Classification Schema

Every ingested source should produce these fields:

- `source_kind`
- `ownership`
- `destination`
- `update_targets`
- `action`

Allowed `source_kind` values:

- `spec`
- `design`
- `plan`
- `implementation-note`
- `api-doc`
- `reference`
- `session-note`
- `decision-candidate`
- `troubleshooting`
- `unknown`

Allowed `ownership` values:

- `project:<project-key>`
- `concept:<concept-key>`
- `review-required`
- `reject`

Allowed `action` values:

- `update-existing-pages`
- `create-new-page-and-update-index`
- `log-only`
- `reject`
- `needs-review`
