# Our App — Feature Shape

> Pseudocode artifact. Non-executable reference shape.

This artifact records only the implementation surface justified by the
[product pseudocode](./BRAIN.pseudocode.md) and
[architecture pseudocode](./architecture.pseudocode.md) so far. Expected future
responsibilities do not earn a file or boundary until concrete pseudocode
demonstrates an independently useful owner.

## New files or owners now required

```text
package.json
config.yaml

src/
  cli.ts
  application.ts

  capture/
    evidence-capture.service.ts
    capture-adapter.ts

  workspace/
    workspace-context.service.ts

  query/
    query.service.ts

  evidence/
    evidence-item.dto.ts
    evidence-insertion.service.ts
    evidence-ingestion.service.ts

  memory/
    markdown/
      markdown-memory-document.ts

  storage/
    sqlite/
      sqlite-runtime.ts

  agent/
    agent-adapter.ts

  providers/
    codex/
      codex-capture.adapter.ts
      codex-agent.adapter.ts
```

### `package.json` — package and command publication metadata

Defines the TypeScript package and maps the intentionally unresolved installed
command name to the built CLI entry. It pins `sqlite-vec` to an exact compatible
version and includes the application-owned SQLite runtime assets in supported
packages. It participates in distribution but does not collapse command
publication, machine-state initialization, provider-hook installation, and MCP
registration into one lifecycle owner.

### `config.yaml` — human-facing application defaults

Defines validated operator-editable defaults, including the evidence-count and
elapsed-time maintenance policy. Each application invocation compares the
validated configuration digest with SQLite and creates a new immutable active
`MaintenancePolicy` revision when the effective values change. Per-project
effective policy remains SQLite state so evidence acceptance can evaluate one
stable revision atomically.

### Application installation owner — representation `OPEN`

Owns the machine-level operation that publishes the stable command, initializes
application state, and installs provider-specific capture mechanics once per
machine. It may later make the separate MCP integration available through the
same top-level installation experience. No concrete script, source file, or
package entry has yet been justified as this owner.

### [`src/cli.ts`](./src/cli.ts.md) — process entry boundary

Routes the application's four public process behaviors: project bootstrap,
automatic capture, brain query, and manual evidence insertion. It delegates
each behavior to its application owner and does not implement registration,
capture, retrieval, or memory evolution itself. This file becomes one installed
named command whose name is intentionally unresolved.

### [`src/application.ts`](./src/application.ts.md) — `Application`

Exposes the stable provider-neutral application façade used by the CLI:
`bootstrapProject`, `capture`, `query`, and `insertEvidence`. It delegates to
private application services without exposing the service graph or implementing
workflow logic. Its static `create` factory method owns process-scoped
dependency composition from capability-specific runtime configuration.

### Project registration application owner — filename `OPEN`

Owns provider-neutral durable registration of one exact canonical directory as
an overseen project root with an immutable application-owned identity. Its
necessity is established by bootstrap and workspace resolution, but its source
filename and concrete service boundary have not yet been shaped.

### [`src/capture/evidence-capture.service.ts`](./src/capture/evidence-capture.service.ts.md) — `EvidenceCaptureService`

Exposes one provider-neutral capture operation to the CLI. It normalizes native
activity through its injected `CaptureAdapter`, ignores activity outside every
overseen root, and combines managed activity with its capture origin and
resolved workspace context to construct one capture-originated
`EvidenceCandidateDto`. It then delegates durable acceptance to
`EvidenceIngestionService`. It plays the facade role without placing the
architectural pattern in the class name.

### [`src/capture/capture-adapter.ts`](./src/capture/capture-adapter.ts.md) — `CaptureAdapter`

Defines the capability contract that every capture-capable provider implements.
It validates and converts exact native provider activity into exactly one
provider-neutral observation draft, ignored outcome, or rejected outcome. It
does not construct an evidence candidate or item, own route identity, resolve
workspace context, or store evidence.

### [`src/workspace/workspace-context.service.ts`](./src/workspace/workspace-context.service.ts.md) — `WorkspaceContextService`

Matches normalized activity against durable overseen-project registrations.
It uses the provider-observed working directory to return a managed
`WorkspaceContext`, an unmanaged outcome, or a safe workspace failure. Managed
context reuses registered project and repository identity and adds the active
Git branch when available. It does not discover or register projects, own
provider-session identity, inspect source for curation, or perform semantic
workstream analysis.

### [`src/providers/codex/codex-capture.adapter.ts`](./src/providers/codex/codex-capture.adapter.ts.md) — `CodexCaptureAdapter`

Implements `CaptureAdapter` for Codex. It validates exact JSON from the
registered `UserPromptSubmit` and `Stop` hooks, preserves the raw input, and
normalizes user and assistant messages. It does not register or normalize
`SessionStart`; count/time maintenance checks occur when evidence is accepted.

### `src/query/query.service.ts` — `QueryService`

Owns the provider-neutral query workflow: resolving applicable memory,
running lexical and semantic retrieval per memory product, fusing each
product's ranks in TypeScript, federating the typed result sets, constructing a
query agent task, validating the untrusted agent result, and returning an
evidence-backed answer. The lower-level SQLite retrieval owner remains
unshaped.

### [`src/evidence/evidence-item.dto.ts`](./src/evidence/evidence-item.dto.ts.md) — evidence DTO contracts

Defines the immutable provider-neutral `EvidenceCandidateDto` constructed by
capture and manual insertion and the accepted `EvidenceItemDto` created by
ingestion. Candidate fields own capture-or-insertion origin, workspace context,
source time, normalized string content, and exact source material. Ingestion
adds durable application evidence identity and acceptance time. Neither DTO is
the SQLite row shape or owns replay suppression. Both remain plain immutable
data without a shared DTO base class or DTO-owned behavior. Runtime validation
is an explicit ingestion-boundary contract whose concrete library and owner
remain unshaped.

### `src/evidence/evidence-insertion.service.ts` — `EvidenceInsertionService`

Owns the manual insertion workflow for attributable evidence supplied directly
by a human or agent. It establishes trusted origin and attribution, constructs
provider-neutral `EvidenceCandidateDto` values, and delegates them with immediate
maintenance intent to `EvidenceIngestionService`. It does not pass manual input
through `EvidenceCaptureService`, directly mutate or fence memory, wait for
agentic maintenance, or perform curation itself.

### [`src/evidence/evidence-ingestion.service.ts`](./src/evidence/evidence-ingestion.service.ts.md) — `EvidenceIngestionService`

Owns the common deterministic acceptance boundary after evidence becomes
provider-neutral. One project-bound atomic operation validates DTOs, resolves
operation and source replay, assigns contiguous project-local evidence
identities, acceptance times, and sequences, appends new evidence, evaluates
the active revisioned maintenance policy, creates or coalesces a finite pending
request, and stores the acceptance receipt. Its accepted operation contract
requires one immutable, project-owned SQLite operation record containing the
versioned command fingerprint and complete versioned receipt for the owning
project's lifetime. It owns neither the remaining Evidence Log table shape nor
source normalization, caller authority, correction interpretation, maintenance
execution, memory curation, or publication.

### [`src/memory/markdown/markdown-memory-document.ts`](./src/memory/markdown/markdown-memory-document.ts.md) — canonical Markdown document shape

Defines and validates the portable Markdown representation shared by Project,
Personal, and Practice Memory. It owns the flat YAML property profile,
immutable memory-node identity, standard Markdown relationship links, AST
parsing, and semantic-section extraction used by publication, indexing, and
query hydration. It does not own filesystem publication, SQLite indexing,
retrieval ranking, or memory admission.

### `src/storage/sqlite/sqlite-runtime.ts` — packaged SQLite runtime

Selects and initializes the application-owned SQLite runtime before any
connection is opened. Supported application packages include a compatible
SQLite library with FTS5 enabled and the pinned `sqlite-vec` extension, so
ordinary use does not depend on Apple SQLite, Homebrew, or another host SQLite
installation. Platform packaging, binary provenance, and the unsupported-host
failure contract still require deeper design.

### `src/agent/agent-adapter.ts` — `AgentAdapter`

Defines the provider-neutral capability for executing a bounded agent task.
Query and maintenance workflows depend on this capability rather than on
provider- and workflow-specific adapters.

### `src/providers/codex/codex-agent.adapter.ts` — `CodexAgentAdapter`

Implements `AgentAdapter` through the Codex CLI. Codex command construction,
process interaction, and provider-result parsing stop at this owner; query and
curation semantics remain in their application workflows.

## Current relationship

```text
package.json
  -> declares the built cli.ts entry for command publication

application installation owner (representation OPEN)
  -> publishes the stable named command
  -> initializes application-owned machine state
  -> installs Codex capture hooks once per machine
  -> later makes the separate MCP integration available when it exists

human shell | provider hooks
  -> installed named command
      -> cli.ts
          -> capture command fixes provider and channel identity
          -> create immutable CaptureInvocationContext
          -> preserve exact provider-native input
          -> resolve runtime configuration for that capture route
          -> Application.create(runtime configuration)
              -> construct selected capture capability
                  codex capture configuration -> CodexCaptureAdapter
              -> inject CaptureInvocationContext and CodexCaptureAdapter
                 directly into EvidenceCaptureService
              -> construct configured agent-execution capability
                  codex agent configuration -> CodexAgentAdapter
              -> construct application services
              -> return Application instance

          -> route bootstrap command
              -> Application.bootstrapProject(exact directory path)
                  -> project registration application owner (filename OPEN)
                      -> immutable ProjectIdentity
                      -> replaceable canonical oversight root
                      -> optional RepositoryIdentity

          -> route capture command
              -> Application.capture(exact native activity)
                  -> EvidenceCaptureService
                      -> injected CodexCaptureAdapter through CaptureAdapter
                      -> WorkspaceContextService
                          -> failed workspace context
                              -> safe capture failure
                          -> unmanaged
                              -> ignored without persistence
                          -> managed WorkspaceContext
                              -> construct capture-originated EvidenceCandidateDto
                              -> EvidenceIngestionService
                                  -> atomic Evidence Log acceptance
                                  -> policy-based maintenance eligibility
                                  -> stored acceptance receipt

          -> route query command
              -> Application.query(question, context)
                  -> QueryService
                      -> SQLite FTS5 lexical retrieval per memory product
                      -> pinned sqlite-vec retrieval per embedding contract
                      -> TypeScript rank fusion and four-product federation
                      -> configured AgentAdapter
                          -> CodexAgentAdapter

          -> route insert command
              -> Application.insertEvidence(evidence, context)
                  -> EvidenceInsertionService
                      -> construct manually supplied EvidenceCandidateDto
                      -> EvidenceIngestionService
                          -> atomic Evidence Log acceptance
                          -> immediate maintenance eligibility
                          -> stored acceptance receipt

canonical Markdown publication | derived indexing | query hydration
  -> canonical Markdown document shape
      -> flat Obsidian-compatible YAML properties
      -> immutable memory-node identity
      -> standard Markdown links
      -> AST-derived semantic sections

Application.create
  -> initialize packaged SQLite runtime before opening SQLite
      -> application-owned SQLite library with FTS5
      -> pinned packaged sqlite-vec extension

maintenance owner not yet shaped
  -> injected AgentAdapter
      -> CodexAgentAdapter
  -> publication owners not yet shaped
```

The future MCP server will reach our app through a formal client abstraction
whose initial implementation invokes the installed command's versioned machine
protocol. The client and MCP owners do not enter the predicted source tree
until their concrete contracts are designed.

## Admission rule

A file enters this feature shape only when an established product behavior or
technical boundary requires an owner that cannot coherently remain in a file
already listed here. Plausible future abstractions remain absent until they
meet that standard.

When a listed owner gains an independently useful source-shaped pseudocode
artifact, its heading links to that artifact. Owners without such an artifact
remain unlinked rather than pointing to an empty placeholder.
