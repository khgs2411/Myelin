# `src/cli.ts`

> Pseudocode artifact. Non-executable reference shape.
>
> Supersession notice: The
> [Ingestion Boundaries design unit](../../../2026-09-02-ingestion-boundaries/feature-shape.md)
> controls the public project key and targeted-memory insertion contracts. The
> [Local Ingestion Prototype Foundation](../../../2026-09-02-ingestion-implementation-foundation/pseudocode/src/cli.ts.md)
> controls the repository-local manual command syntax. The development capture
> fixture uses a separate internal development command family.

Intended destination: `src/cli.ts`

`src/cli.ts` is the shared process entry surface for the application's four
public behaviors: project bootstrap, automatic capture, brain query, and
targeted durable-memory proposals. It routes these behaviors but does not implement
their product logic.

It is published as one named command installed on the user's machine. The
command name is intentionally unresolved. Humans and provider hooks invoke this
command directly. Once the application is proven, a future MCP server reaches
our app through a formal client abstraction whose initial implementation wraps
this command's versioned machine protocol.

```ts
// intentionally illustrative pseudocode

ENTRYPOINT cli

DISTRIBUTION
  one installed machine command
  command name is unresolved

MACHINE_PROTOCOL
  expose the command operations through a versioned request and result envelope
  keep machine results independent from human-oriented console presentation
  preserve structured outcomes, safe diagnostics, and cancellation semantics

CALLERS
  human shell
  provider hook
  future CLI-backed app client used by the MCP server

INPUT
  process arguments and command payload are untrusted
  current working directory and admitted environment metadata are observations

ON invocation
  parse the application-level command

  MATCH command
    "bootstrap"
      require exactly one existing directory path
      application = await Application.create(runtime configuration)

      result = await application.bootstrapProject({
        directoryPath: supplied directory path
      })

      return the immutable project identity, canonical oversight root,
      and canonical Git repository root when one exists
      success means the project registration is durable
      bootstrap does not install, select, or configure a provider integration

    "capture"
      require one registered provider and channel route
      // first installed route: --provider codex --channel hook
      invocationContext = {
        route: {
          provider: { key: declared provider },
          channel: { key: declared channel }
        }
      }

      resolve the complete runtime configuration for this process
      set its captureProvider configuration to {
        invocationContext,
        settings: provider-specific settings
      }
      application = await Application.create(runtime configuration)

      read standard input as exact serialized content without parsing it
      nativeActivity = {
        mediaType: media type established by the capture route,
        content: exact standard-input content
      }
      result = await application.capture({
        native activity
      })

      return a safe process outcome
      distinguish accepted evidence and ignored input
      accepted means required evidence was durably stored
      success does not mean maintenance completed

      IF capture parsing, validation, or acceptance fails
        record or emit a safe machine diagnostic without native content
        return provider-compatible process success so the hook fails open

    "query"
      require a question
      application = await Application.create(runtime configuration)
      collect the caller's current working directory

      result = await application.query({
        question,
        workingDirectory: caller's current working directory
      })

      return the core typed QueryResult:
        qualified Session Memory records or parsed text
        grouped Project, Personal, and Practice Markdown references
        product-local relevance, freshness, and product outcomes

      do not invoke an agent or curate one answer inside the query command

      IF the result scope is unmanaged-directory
        explain that Personal and Practice Memory were queried
        explain that project bootstrap is available as a separate explicit
          operation requiring the intended exact oversight root

    "memory propose <project | personal | practice>"
      require one explicit durable memory target from the command route
      require one public key for a bootstrapped project context
      require one or more ordered content items
      application = await Application.create(runtime configuration)

      insertionSource = establish from the command route:
        "our-app.cli" for direct CLI use
        "our-app.mcp" for the future CLI-backed MCP client

      accept clientReference as:
        optional for direct CLI use
        required for the future MCP client

      result = await application.proposeMemory({
        invocationContext: {
          source: { key: insertionSource }
        },
        request: {
          projectKey: supplied public project key,
          target: selected durable memory target,
          items: supplied content items in their original order,
          clientReference: supplied reference when present
        }
      })

      return a safe Inbox-acceptance result
      accepted or replayed means the selected product Inbox and receipt are durable
      state explicitly that product curation has not run
      never report that canonical memory changed

    otherwise
      return invalid invocation

ON failure
  return an unsuccessful process outcome with a safe diagnostic
  never echo captured evidence or proposed content

ON process cleanup after application construction
  await application.close()
```

## Ownership boundary

`src/cli.ts` owns process input, command routing, capture-route construction,
command-specific presentation, and the versioned machine representation of
stable application outcomes.
It awaits one composed application instance from `Application.create` and
closes that instance during process cleanup. For a capture invocation, it
requires the provider and channel route before composition so runtime
configuration can select exactly one capture capability. The installed Codex
hook fixes these values as `codex` and `hook`; neither value is read from the
native JSON payload.

The CLI preserves the exact serialized capture input. It does not parse and
reserialize provider JSON before normalization. A selected capture route is
deterministic routing and provenance metadata, not external caller
authentication or correction authority.

The bootstrap command passes one explicit directory to the provider-neutral
project-registration use case. It does not infer a broader project root, write
markers into the project, or install machine-wide hooks. Application
installation owns provider capture mechanics separately.

The proposal command requires one public key for a bootstrapped project context
rather than inferring a project from the CLI process directory. It keeps the
client reference optional for ordinary CLI use. The future agent-only MCP
client must supply one for replay-safe resubmission. An agent may still use the
CLI without one, but then safe retry behavior is caller responsibility.

It does not:

- interpret any provider's native activity;
- construct a concrete capture adapter;
- access the application's internal service graph;
- retrieve, rank, or curate query results itself;
- write evidence or canonical memory directly;
- persist project registration directly;
- install, repair, or remove provider hooks;
- decide whether proposed content changes memory or documentation;
- curate memory or documentation itself;
- select a memory product beyond the caller's explicit command route.

The proposal command returns after atomic acceptance by one selected product
Inbox. Product-local lifecycle, curation, rejection, and canonical publication
belong to Project, Personal, or Practice Memory. Session Memory and Session
maintenance do not participate in this operation.

The future MCP server may expose methods that do not mirror command names, but
its CLI-backed client maps each business operation to one machine-protocol
request. It does not compose several mutating commands into one apparent MCP
transaction.
