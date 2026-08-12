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

src/
  cli.ts
  application.ts

  capture/
    capture.service.ts
    capture-adapter.ts

  workspace/
    workspace-context.service.ts

  query/
    query.service.ts

  evidence/
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
packages. Build output, installation, upgrades, backups, and provider-hook
registration remain separate unresolved concerns.

### [`src/cli.ts`](./src/cli.ts.md) — process entry boundary

Routes the application's three public process behaviors: automatic capture,
brain query, and manual evidence insertion. It delegates each behavior to its
application owner and does not implement capture, retrieval, or memory
evolution itself. This file becomes one installed named command whose name is
intentionally unresolved.

### [`src/application.ts`](./src/application.ts.md) — `Application`

Exposes the stable provider-neutral application façade used by the CLI:
`capture`, `query`, and `insertEvidence`. It delegates to private application
services without exposing the service graph or implementing workflow logic.
Its static `create` factory method owns process-scoped dependency composition
from capability-specific runtime configuration.

### [`src/capture/capture.service.ts`](./src/capture/capture.service.ts.md) — `CaptureService`

Exposes one provider-neutral capture operation to the CLI. It normalizes native
activity through its injected `CaptureAdapter`. It combines the immutable
capture route, normalized observation, capture time, and one resolved workspace
context into provider-neutral evidence. It then delegates durable acceptance to
`EvidenceIngestionService`. It plays the facade role without placing the
architectural pattern in the class name.

### [`src/capture/capture-adapter.ts`](./src/capture/capture-adapter.ts.md) — `CaptureAdapter`

Defines the capability contract that every capture-capable provider implements.
It validates and converts exact native provider activity into exactly one
evidence, ignored, or rejected outcome. It does not own route identity,
workspace resolution, or durable evidence storage.

### [`src/workspace/workspace-context.service.ts`](./src/workspace/workspace-context.service.ts.md) — `WorkspaceContextService`

Resolves the deterministic project, repository, location, checkout, worktree,
and branch coordinates for the active workspace. It returns `WorkspaceContext`
and does not own provider-session identity, source inspection for curation, or
semantic workstream analysis.

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

### `src/evidence/evidence-insertion.service.ts` — `EvidenceInsertionService`

Owns the manual insertion workflow for attributable evidence supplied directly
by a human or agent. It establishes trusted principal and origin, constructs
provider-neutral evidence, validates correction authority, delegates durable
acceptance to `EvidenceIngestionService`, and may wait for the resulting
maintenance outcome. It performs no curation itself.

### `src/evidence/evidence-ingestion.service.ts` — `EvidenceIngestionService`

Owns the common deterministic acceptance boundary after evidence becomes
provider-neutral: idempotent durable append plus durable recording of the
appropriate maintenance intent. It may apply an already-authorized correction
fence, but does not determine authority, curate memory, or publish documents.

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
  -> publishes the built cli.ts entry as the installed named command

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
                 directly into CaptureService
              -> construct configured agent-execution capability
                  codex agent configuration -> CodexAgentAdapter
              -> construct application services
              -> return Application instance

          -> route capture command
              -> Application.capture(exact native activity, context)
                  -> CaptureService
                      -> injected CodexCaptureAdapter through CaptureAdapter
                      -> WorkspaceContextService
                          -> WorkspaceContext
                      -> EvidenceIngestionService
                          -> durable evidence + count/time maintenance obligation

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
                      -> EvidenceIngestionService
                          -> durable evidence + priority maintenance intent

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
