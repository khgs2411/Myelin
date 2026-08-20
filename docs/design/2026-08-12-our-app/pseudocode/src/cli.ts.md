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
      collect the caller's current context

      result = await application.query({
        question,
        current context
      })

      return the answer, supporting memory references, and freshness

    "insert"
      require the exact root of one bootstrapped overseen project
      require one or more ordered evidence-content items
      application = await Application.create(runtime configuration)

      insertionSource = establish from the command route:
        "our-app.cli" for direct CLI use
        "our-app.mcp" for the future CLI-backed MCP client

      accept clientReference as:
        optional for direct CLI use
        required for the future MCP client

      result = await application.insertEvidence({
        invocationContext: {
          source: { key: insertionSource }
        },
        request: {
          projectRoot: supplied exact project root,
          items: supplied content items in their original order,
          clientReference: supplied reference when present
        }
      })

      return a safe evidence acceptance receipt
      receipt success means evidence and its immediate maintenance eligibility
      are durable; it does not mean maintenance completed

    otherwise
      return invalid invocation

ON failure
  return an unsuccessful process outcome with a safe diagnostic
  never echo captured or manually inserted evidence

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

The insertion command requires an exact bootstrapped project root rather than
inferring a project from the CLI process directory. It keeps the client
reference optional for ordinary CLI use. The future agent-only MCP client must
supply one for replay-safe resubmission. An agent may still use the CLI without
one, but then safe retry behavior is caller responsibility.

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
- classify inserted evidence into a memory product.

The insertion command returns after atomic evidence acceptance and durable
maintenance eligibility. Scheduling, coalescing, frontier selection, and
maintenance execution belong to the evidence acceptance and maintenance owners.

The future MCP server may expose methods that do not mirror command names, but
its CLI-backed client maps each business operation to one machine-protocol
request. It does not compose several mutating commands into one apparent MCP
transaction.
