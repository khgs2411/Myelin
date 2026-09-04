# Durable Evidence Acceptance — Open Design Issues

Established design context: [Feature Shape](feature-shape.md).

## Issue Index

| Issue | Status | Provisional candidates |
| --- | --- | --- |
| [Session obligation persistence contract](#session-obligation-persistence-contract) | `OPEN` | one monotonic per-project frontier |
| [Evidence candidate runtime validation](#evidence-candidate-runtime-validation) | `OPEN` | none |
| [Deterministic fingerprint contract](#deterministic-fingerprint-contract) | `OPEN` | none |
| [Acceptance failure contract](#acceptance-failure-contract) | `OPEN` | none |

## Session Boundary

### Session obligation persistence contract

**Evidence:** accepted design, user requirement, and roadmap sequence

**Exposed by:** Newly accepted evidence and the fact that it requires later
Session evaluation must commit atomically, while Session maintenance execution
belongs to the next roadmap step.

**Established:**

- Only newly appended evidence can create or advance an obligation.
- A replay-only operation does not change Session work.
- The obligation commits in the acceptance transaction.
- The obligation identifies the accepted project evidence frontier.
- It does not execute maintenance, invoke an agent, or mutate Session Memory.

**Unresolved:** Which exact persistence owner, data shape, and write operation
record this minimal obligation and let the later Session lifecycle consume it
without replacing the acceptance contract?

**Candidates:**

- `PROVISIONAL` — Use one Session-owned obligation row per Project. Store only
  the highest accepted project evidence sequence that requires Session
  evaluation. Evidence acceptance inserts or monotonically advances that
  frontier through its existing transaction. The persistence boundary returns
  the recorded frontier and owns no policy, request, attempt, execution, or
  Session Memory state.

**Time to address:** Before durable acceptance can be implemented completely.

## Contract Integrity

### Evidence candidate runtime validation

**Evidence:** accepted design

**Exposed by:** `EvidenceAcceptanceService` must reject the complete command
before durable mutation unless every candidate and source-material integrity
claim is valid.

**Established:**

- Validation occurs at the acceptance boundary.
- It covers the complete provider-neutral candidate and current
  `WorkspaceContext` shape.
- It verifies the source-material SHA-256 digest before fingerprinting.
- Validation does not normalize, trim, or interpret evidence content.

**Unresolved:** Which exact source owner and runtime validation contract define
valid evidence without adding DTO behavior or a shared DTO framework?

**Time to address:** Before the service contract can control implementation.

### Deterministic fingerprint contract

**Evidence:** accepted design

**Exposed by:** Operation retry comparison and source-replay comparison require
stable fingerprints across processes and later application versions.

**Established:**

- Operation and source-replay fingerprints have different input boundaries.
- Both preserve ordered content, explicit optional absence, and byte-exact
  evidence and source-material strings.
- Each stored fingerprint includes its scheme and version.
- A digest is comparison evidence, not an application identity.

**Unresolved:** Which canonical encoding, fingerprint versions, and stored-version
compatibility rules make both comparisons deterministic and recoverable?

**Time to address:** Before operation or replay idempotency can be implemented.

### Acceptance failure contract

**Evidence:** accepted design and user requirement

**Exposed by:** Invalid commands, mixed projects, conflicting operation reuse,
conflicting source replay, and incompatible stored receipts must fail without
partial durable mutation.

**Established:**

- Expected acceptance refusals are distinct from infrastructure failures.
- A failed command returns no successful receipt.
- Diagnostics must not expose raw source material unnecessarily.
- Every failure before commit leaves evidence, project sequence, obligation,
  and operation state unchanged.

**Unresolved:** Which exact application result or error vocabulary represents
each expected refusal and preserves a safe diagnostic for later CLI use?

**Time to address:** Before `EvidenceAcceptanceService.accept` becomes an
executable application contract.
