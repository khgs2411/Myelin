# `src/cli.ts`

> Pseudocode artifact. Non-executable reference shape.

Intended destination: `src/cli.ts`

`src/cli.ts` is the shared process entry surface for the application's four
public behaviors: project bootstrap, automatic capture, brain query, and
manual evidence insertion. It routes these behaviors but does not implement
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
      application = Application.create(runtime configuration)

      result = await application.bootstrapProject({
        directoryPath: supplied directory path
      })

      return the immutable project identity, canonical oversight root,
      and repository reference when one exists
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
      application = Application.create(runtime configuration)

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
      application = Application.create(runtime configuration)
      collect the caller's current context

      result = await application.query({
        question,
        current context
      })

      return the answer, supporting memory references, and freshness

    "insert"
      require caller-supplied evidence and applicable context
      application = Application.create(runtime configuration)
      establish principal and insertion-source identity from trusted invocation context
      accept an optional client reference for replay-safe resubmission
      accept claimed attribution as evidence metadata only

      result = await application.insertEvidence({
        evidence,
        principal,
        insertion source identity,
        client reference?,
        claimed attribution?,
        context
      })

      return a safe evidence acceptance receipt
      receipt success means evidence and its immediate maintenance eligibility
      are durable; it does not mean maintenance completed

    otherwise
      return invalid invocation

ON failure
  return an unsuccessful process outcome with a safe diagnostic
  never echo captured or manually inserted evidence
```

## Ownership boundary

`src/cli.ts` owns process input, command routing, capture-route construction,
command-specific presentation, and the versioned machine representation of
stable application outcomes.
It obtains one composed application instance from `Application.create`. For a
capture invocation, it requires the provider and channel route before
composition so runtime configuration can select exactly one capture capability.
The installed Codex hook fixes these values as `codex` and `hook`; neither value
is read from the native JSON payload.

The CLI preserves the exact serialized capture input. It does not parse and
reserialize provider JSON before normalization. A selected capture route is
deterministic routing and provenance metadata, not external caller
authentication or correction authority.

The bootstrap command passes one explicit directory to the provider-neutral
project-registration use case. It does not infer a broader project root, write
markers into the project, or install machine-wide hooks. Application
installation owns provider capture mechanics separately.

It does not:

- interpret any provider's native activity;
- construct a concrete capture adapter;
- access the application's internal service graph;
- retrieve, rank, or synthesize memory answers;
- write evidence or canonical memory directly;
- persist project registration directly;
- install, repair, or remove provider hooks;
- decide how inserted evidence changes memory or documentation;
- curate memory or documentation itself;
- decide whether claimed attribution has memory authority.

The insertion command returns after atomic evidence acceptance and durable
maintenance eligibility. Scheduling, coalescing, frontier selection, and
maintenance execution belong to the evidence ingestion and maintenance owners.

The future MCP server may expose methods that do not mirror command names, but
its CLI-backed client maps each business operation to one machine-protocol
request. It does not compose several mutating commands into one apparent MCP
transaction.
