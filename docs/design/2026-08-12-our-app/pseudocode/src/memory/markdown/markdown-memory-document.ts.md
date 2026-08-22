# `src/memory/markdown/markdown-memory-document.ts`

> Pseudocode artifact. Non-executable reference shape.

This owner defines the canonical, portable Markdown document shared by
Project, Personal, and Practice Memory. Obsidian is a compatible viewer, not a
runtime dependency or source of truth.

## Document contract

```ts
type MarkdownMemoryProduct = "project" | "personal" | "practice"

type MemoryNodeIdentity = opaque application-generated identity
type MemoryRevision = immutable revision of one memory node
type ContentHash = hash of the exact canonical document bytes

type MarkdownMemoryProperties = Readonly<{
  // Flat YAML properties. Nested objects are not admitted.
  id: MemoryNodeIdentity
  memory: MarkdownMemoryProduct
  title: string
  aliases: string[]
  tags: string[]
  status: "active" | "stale" | "superseded" | "retracted"
  created: IsoDateTime
  updated: IsoDateTime

  // Product-specific applicability is represented through additional
  // validated scalar or list properties, never unvalidated nested YAML.
}>

type ParsedMarkdownMemoryDocument = Readonly<{
  properties: MarkdownMemoryProperties
  canonicalPath: RelativeMarkdownPath
  revision: MemoryRevision
  contentHash: ContentHash
  syntaxTree: MarkdownAst
  outgoingRelations: MarkdownMemoryLink[]
}>
```

The node identity is immutable. Title, aliases, tags, content, and path can
evolve without changing that identity. A readable filename may include a
stable identity suffix, for example:

```text
vue-composition-patterns--019abc.md
```

The path locates a node. It does not identify the node. Publication that moves
a document must update canonical relationship links and derived path indexes.

## Portable Obsidian-compatible profile

```text
WRITE
  CommonMark plus the admitted GitHub-Flavored Markdown subset
  flat YAML frontmatter
  standard Markdown links for relationships
  YAML tags, aliases, dates, scalar values, and lists

SUPPORT IN OBSIDIAN
  Properties view
  tags and nested tags
  aliases
  backlinks and graph relationships
  file and heading navigation
  normal Markdown embeds when product content requires them

DO NOT REQUIRE
  an Obsidian installation
  Wikilinks
  Obsidian block identifiers as canonical identity
  community plugins
  nested properties
  rendered Markdown inside properties
```

Semantic relationships belong in the Markdown body as standard links. SQLite
may index those relations, but a SQLite-only link is a retrieval hint rather
than canonical memory meaning.

Our app is initially the only canonical Markdown writer. A user correction
enters through evidence insertion and autonomous reconciliation rather than a
direct file edit.

## Parsing and validation

```ts
function parseMarkdownMemory(input: {
  path: RelativeMarkdownPath
  bytes: Uint8Array
}): ParsedMarkdownMemoryDocument {
  parse the document with a Markdown AST parser
  parse and validate flat YAML frontmatter
  reject missing, duplicate, malformed, or product-incompatible properties
  preserve source positions for headings and block nodes
  extract standard Markdown relationship links
  calculate the exact content hash
  resolve the published memory revision from canonical publication metadata
  return the validated document
}
```

Parsing uses a real Markdown syntax tree. It never infers sections with regular
expressions or arbitrary character windows.

The established syntax support is CommonMark, the admitted GFM structures, and
YAML frontmatter. The exact parser package remains an implementation choice;
the parser must expose typed AST nodes and source positions.

## Semantic-section extraction

```ts
type SemanticSection = Readonly<{
  memoryNodeId: MemoryNodeIdentity
  memoryRevision: MemoryRevision
  product: MarkdownMemoryProduct
  title: string
  headingPath: string[]
  sourceRange: SourceRange
  blocks: MarkdownAstBlock[]
  canonicalReference: MarkdownMemoryReference
}>

function extractSemanticSections(
  document: ParsedMarkdownMemoryDocument
): SemanticSection[] {
  document introduction before the first heading becomes one section

  FOR EACH heading
    section starts at that heading
    section ends before the next heading of equal or higher depth
    section retains the complete heading ancestry
    lists, tables, block quotes, and code blocks remain atomic

  return sections in canonical document order
}
```

If a section exceeds the active chunking contract, the indexer may split it
only between complete AST blocks. It never splits a code block, table, list
item, or other atomic node in the middle.

```ts
type SemanticChunk = Readonly<{
  id: DerivedChunkIdentity
  memoryNodeId: MemoryNodeIdentity
  memoryRevision: MemoryRevision
  product: MarkdownMemoryProduct
  headingPath: string[]
  chunkOrdinal: number
  chunkingContractVersion: ChunkingContractVersion
  searchableText: string
  sourceRange: SourceRange
  canonicalReference: MarkdownMemoryReference
}>

DerivedChunkIdentity = derive from:
  memory node identity
  memory revision
  heading path
  chunk ordinal
  chunking-contract version
```

Searchable text includes the document title, aliases, tags, applicable scope,
heading path, and complete block text. It excludes YAML syntax and other
formatting noise that does not add memory meaning.

Chunk identities are derived and disposable. When a new canonical revision is
published, old chunks become stale and can be rebuilt. If a subsection needs
an independent durable lifecycle or stable relationships, it becomes its own
memory node instead of receiving a second permanent identity system.

## Ownership boundary

```text
OWNS
  canonical Markdown property vocabulary
  memory-node identity validation
  portable Obsidian-compatible document syntax
  Markdown AST parsing
  semantic-section and chunk derivation
  canonical references and source ranges

DOES NOT OWN
  product-specific memory admission
  filesystem publication or crash recovery
  SQLite schema or writes
  FTS5 tokenization
  embeddings or sqlite-vec
  lexical/vector rank fusion
  four-product query federation
```

Publication, indexing, and query-result reference construction must use this
owner so they cannot silently disagree about the meaning or boundaries of a
canonical document.
