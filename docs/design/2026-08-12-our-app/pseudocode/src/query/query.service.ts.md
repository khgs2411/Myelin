# `src/query/query.service.ts`

> Pseudocode artifact. Non-executable reference shape.

Intended destination: `src/query/query.service.ts`

`QueryService` owns one provider-neutral, read-only federation workflow across
Session, Project, Personal, and Practice Memory. It sends the question and
applicable context to each memory product, preserves each product's qualified
results, and returns those typed core results without agentic curation.

```ts
// intentionally illustrative pseudocode

type QueryInput = Readonly<{
  question: string
  workingDirectory: string
}>

type QueryMemoryProduct =
  | "session"
  | "project"
  | "personal"
  | "practice"

type QueryScope =
  | Readonly<{
      kind: "managed-project"
      workspace: WorkspaceContext
      applicableProducts: readonly [
        "session",
        "project",
        "personal",
        "practice"
      ]
    }>
  | Readonly<{
      kind: "unmanaged-directory"
      applicableProducts: readonly ["personal", "practice"]
    }>

type QueryProductOutcome = Readonly<{
  product: QueryMemoryProduct
  status:
    | "queried"
    | "not-applicable"
    | "unavailable"
    | "degraded"
    | "failed"
  safeDiagnostic?: string
}>

type ProductLocalRelevance = Readonly<{
  rank: positive integer within this product's qualified result set
  score: number meaningful only within this product and this query
  qualificationThreshold: threshold selected by this memory product
}>

RULES ProductLocalRelevance
  each memory product owns its scoring method and qualification threshold
  a result qualifies only under that product's retrieval policy
  scores and thresholds from different memory products are not comparable
  score describes retrieval relevance, not truth or answer confidence
  score, rank, and threshold are query metadata, not stable memory properties

type QueryReferenceFreshness = Readonly<{
  canonicalStatus: "current" | "stale" | "unknown"
  assessedAt: IsoDateTime
}>

type QueryProductFreshness = Readonly<{
  product: QueryMemoryProduct
  maintenance: "current" | "lagging" | "unknown" | "not-applicable"
  index: "current" | "stale" | "unavailable" | "not-applicable"
}>

type SessionMemoryQueryResult = Readonly<{
  memoryNodeId: durable identity of one canonical Session Memory record
  canonicalVersion: exact record version or content digest returned by this query
  content: product-owned Session Memory record or parsed text
  relevance: ProductLocalRelevance
  freshness: QueryReferenceFreshness
}>

// OPEN: Session Memory design selects the exact record-versus-parsed-text
// result shape and canonicalVersion representation.

type DocumentationMemoryReference = Readonly<{
  memoryNodeId: MemoryNodeIdentity
  memoryRevision: MemoryRevision
  contentHash: ContentHash
  canonicalPath: RelativeMarkdownPath
  headingPath: string[]
  sourceRange: SourceRange
  relevance: ProductLocalRelevance
  freshness: QueryReferenceFreshness
}>

RULES DocumentationMemoryReference
  the reference is a qualified query output, not a query input
  canonicalPath and headingPath locate the qualified documentation for a reader
  memoryNodeId plus revision or contentHash identify the result durably
  a path is never durable memory identity
  Project paths usually locate documentation inside the managed project
  Personal and Practice paths locate their canonical documentation stores

type DocumentationQueryResults = Readonly<{
  project: ReadonlyArray<DocumentationMemoryReference>
  personal: ReadonlyArray<DocumentationMemoryReference>
  practice: ReadonlyArray<DocumentationMemoryReference>
}>

type QueryFreshness = Readonly<{
  assessedAt: IsoDateTime
  products: ReadonlyArray<QueryProductFreshness>
}>

type QueryResult = Readonly<{
  scope: QueryScope
  productOutcomes: ReadonlyArray<QueryProductOutcome>
  sessionMemories: ReadonlyArray<SessionMemoryQueryResult>
  documentation: DocumentationQueryResults
  freshness: QueryFreshness
}>

class QueryService {
  async query(input: QueryInput): Promise<QueryResult> {
    validate input.question

    workspaceResolution = await workspaceContextService.resolve({
      workingDirectory: input.workingDirectory
    })

    IF workspaceResolution is failed
      fail the query with its safe workspace diagnostic

    IF workspaceResolution is managed
      scope = managed-project with all four products applicable
    ELSE
      scope = unmanaged-directory with Personal and Practice applicable
      mark Session and Project outcomes not-applicable

    resolve the applicable user and technologies

    FOR EACH applicable memory product independently
      pass the same question and that product's applicable scope

      let the product own:
        its lexical, semantic, vector, or other retrieval method
        its index and canonical source access
        its product-local ranking and score
        its qualification threshold
        its lifecycle, freshness, and applicability filters
        its product-specific result representation

      collect only results qualified by that product
      record the product outcome

    preserve qualified Session results as Session records or parsed text
    preserve qualified Project, Personal, and Practice results as grouped
      canonical Markdown references

    do not compare scores across products
    do not synthesize, curate, or discard results through an agent

    return the typed core QueryResult
  }
}
```

## Optional result aggregation

An optional later layer may consume `QueryResult` and use an agentic flow to
curate one response. That layer is not part of `QueryService.query` and does not
change the core result contract.

```text
QueryResult
  -> optional Query result aggregator — representation OPEN
      -> may use AgentAdapter
      -> may produce a curated response and claim-to-reference grounding
      -> returns or retains the unchanged core QueryResult beside that response
```

A human, an agent, the CLI, an MCP client, or another application consumer may
also use the core results directly and perform its own curation. The exact
aggregator owner and result vocabulary remain `OPEN`; they do not block the
core query operation.

## Ownership boundary

An unmanaged directory is a valid query scope. It makes Session and Project
Memory not applicable while Personal and Practice Memory remain available. An
invalid, missing, or inaccessible working directory fails before retrieval.

`QueryService` never registers a project. Its unmanaged scope lets the caller
explain that project management is available, but bootstrap remains a separate
explicit write operation. The caller must supply the exact oversight root;
neither `QueryService` nor the CLI assumes that the queried descendant working
directory is that root.

Each memory product owns its retrieval method, scoring, qualification
threshold, filters, and result representation. `QueryService` owns context
resolution, applicability, independent product invocation, typed result
collection, and per-product outcome reporting. It does not own product-local
retrieval, ranking, canonical memory storage, index generation, agent
execution, answer synthesis, or project bootstrap.

The exact product query-capability representations, product-local score and
threshold policies, product-degradation policy, freshness vocabulary, and
Session Memory result shape remain open.
