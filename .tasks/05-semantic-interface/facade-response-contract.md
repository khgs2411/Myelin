# Facade Response Contract

## Outcome

The semantic facades share a stable response envelope.

## Why it matters

Agents need predictable machine-readable outputs whether the answer comes from Project Memory, Session Memory, Practice Memory, Personal Memory, or degraded state.

## Scope

- Answer or structured status payload.
- Confidence.
- Memory scope.
- Citations.
- Candidate ids.
- Degraded flag and reason.
- Source tools or retrieval path.

## Done means

- Core CLI and MCP facade outputs match the same contract.
- Missing memory scopes are explicit.
- Consumers can handle degraded answers deterministically.

## Notes

- Related: `README.md` Query And MCP Boundary.
- Related: archived V2 facade response contract.
