# `cli.ts`

> Pseudocode artifact. Non-executable reference shape.

Intended destination: `cli.ts`

This file is the repository-local Bun command interface for manual ingestion.
It separates deliberate proposals to durable memory from controlled Session
capture fixtures. It runs only from this checkout with one fixed project
context. It does not bootstrap or discover projects, inspect Git, create a
package `bin`, modify the host, expose production capture, or promise a stable
machine protocol.

The command tree includes the complete accepted manual-ingestion surface.
The roadmap controls when each route becomes executable.

```ts
// intentionally illustrative pseudocode

const FIXED_VALIDATED_LOCAL_SESSION_POLICY =
  validated effective policy selected for the local prototype

const LOCAL_PROTOTYPE = {
  databasePath:
    "/Users/liadgoren/Repositories/llm-wiki/.llm-wiki-dev/state.sqlite",
  project: {
    key: "llm-wiki-local",
    rootPath: "/Users/liadgoren/Repositories/llm-wiki",
    repositoryRootPath: "/Users/liadgoren/Repositories/llm-wiki",
    branch: "master"
  },
  maintenance: {
    session: FIXED_VALIDATED_LOCAL_SESSION_POLICY
  }
} as const

type DurableMemoryTarget = "project" | "personal" | "practice"

type ProposalContentSource =
  | Readonly<{ kind: "text"; content: string }>
  | Readonly<{ kind: "file"; filePath: string }>
  | Readonly<{ kind: "stdin" }>

type MemoryProposalCliRequest = Readonly<{
  target: DurableMemoryTarget
  contentSources: ReadonlyArray<ProposalContentSource>
  requestReference?: string
}>

type CaptureFixtureCliRequest = Readonly<{
  providerSessionReference: string
  fixtureReference: string
  transcriptFilePath: string
}>

COMMAND_TREE
  memory propose <project | personal | practice>
  dev capture-fixture

HELP
  running the root without a command shows both command families
  every command level accepts --help
  help states what durable acceptance proves and what remains asynchronous

INVOCATION
  bun run cli.ts memory propose project \
    --text "The application uses Sequelize for SQLite."

  bun run cli.ts memory propose personal \
    --file ./notes/preference.md \
    --request-ref preference-2026-09-02

  bun run cli.ts memory propose practice \
    --text "First item" \
    --file ./notes/second-item.md \
    --stdin

  bun run cli.ts dev capture-fixture \
    --session <provider-session-reference> \
    --fixture <fixture-reference> \
    --file <transcript-file-path>

ENTRYPOINT cli.ts
  require execution through Bun from this repository checkout
  treat process arguments, named files, and standard input as untrusted input
  do not accept a project selector; use LOCAL_PROTOTYPE.project

  IF no command is supplied
    write root help
    stop command dispatch without constructing Application

  MATCH command path
    any valid command path with --help
      write that command's help
      stop command dispatch without constructing Application

    "memory propose <target>"
      parse target as exactly project, personal, or practice
      collect content sources in their command-line occurrence order:
        each --text <content> is one item containing the exact received value
        each --file <path> is one item containing the exact file text
        --stdin is one item containing exact standard-input text

      require one or more content sources
      allow --text and --file more than once
      allow --stdin at most once and only when explicitly supplied
      reject missing, empty, or whitespace-only content
      preserve all accepted content without trimming or rewriting it

      accept optional --request-ref <reference>
      require a non-empty reference when the flag is present

      execute with one Application instance:
        result = await application.proposeMemory({
          invocationContext: {
            source: { key: "our-app.cli" }
          },
          target,
          items: content items in command-line occurrence order,
          clientReference: requestReference when present
        })

      write a concise human result containing:
        selected memory product
        fixed local project context
        accepted or replayed disposition
        durable Inbox receipt and candidate count
        explicit statement that product curation has not run

    "dev capture-fixture"
      parse named flags into request:
        providerSessionReference = value of --session
        fixtureReference = value of --fixture
        transcriptFilePath = value of --file

      require every value to be a non-empty string
      require an existing transcript text file
      content = read request.transcriptFilePath as one exact string with Bun file APIs
      require content to be non-empty

      execute with one Application instance:
        result = await application.captureFixture({
          providerSessionReference: request.providerSessionReference,
          fixtureReference: request.fixtureReference,
          content
        })

      write a concise human result containing:
        captured-evidence acceptance disposition
        durable acceptance receipt
        Session maintenance disposition from the receipt
        explicit statement that maintenance completion was not awaited

    otherwise
      write command help with a safe invalid-invocation diagnostic
      return an unsuccessful process status

APPLICATION_LIFECYCLE for each valid command
  application = absent

  TRY
    application = await Application.create({
      sqlite: {
        databasePath: LOCAL_PROTOTYPE.databasePath
      },
      localProject: LOCAL_PROTOTYPE.project,
      maintenance: LOCAL_PROTOTYPE.maintenance
    })

    execute the selected application operation
    return a successful process status for accepted or replayed results

  CATCH failure
    write a concise diagnostic that states the corrective action when known
    never echo transcript content, proposal content, or stored evidence
    return an unsuccessful process status

  FINALLY
    IF application exists
      await application.close()
```

## Interface boundary

`memory propose <target>` selects one durable memory product explicitly. The
CLI maps `--request-ref` to the application `clientReference`. Without that
flag, each invocation is a new intentional proposal. Success proves durable
Inbox acceptance only. Project, Personal, or Practice Memory owns later
curation and canonical publication. Session Memory is not a valid target or an
intermediate destination.

Mixed `--text`, `--file`, and `--stdin` inputs form one ordered atomic request.
Their command-line occurrence order is the item order. The CLI reads standard
input only when `--stdin` is present, so an interactive invocation cannot wait
for input unexpectedly.

`dev capture-fixture` is the development-only path into captured evidence and
Session maintenance. Both references remain required because they define the
logical Session fixture and its replay identity. The CLI does not derive either
reference from a file path or content digest.

## Ownership boundary

`cli.ts` owns the fixed prototype facts, local argument parsing, ordered
content acquisition, command routing, human presentation, process status, and
application cleanup. It establishes the direct CLI insertion source from the
command route. Caller content cannot select or impersonate its source.

The CLI does not register or resolve projects, create persistence records,
accept evidence directly, schedule maintenance, curate memory, or write
canonical memory. It does not claim that Inbox acceptance completed curation or
that captured-evidence acceptance completed Session maintenance.

The local prototype does not expose `--project`. Later project generalization
can add a public project selector without changing the two command families.
Production installation does not publish the `dev` family.
