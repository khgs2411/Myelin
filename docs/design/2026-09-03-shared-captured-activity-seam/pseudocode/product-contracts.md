# Memory Product Contracts

> Pseudocode artifact. Non-executable reference shape.

This boundary carries established product behavior into the current unit.
It does not select the Session entry schema, curator prompt, or publication
algorithm. The root [README](../../../../README.md) supplies the product
contract. [Open Design Issues](../design-issues.md) owns unresolved decisions.

## Captured Evidence To Session Memory

```text
committed evidence_items + existing Session Memory
  -> Session-owned selection of a finite Project evidence frontier
  -> EvidenceIngestionService coordinates the processing operation
      -> Session curator reads and qualifies raw source data
      -> IAgentAdapter executes a bounded workflow-owned task
      -> untrusted proposal
      -> Session-owned validation and reconciliation
          -> canonical Session entries in SQLite
          -> destination-specific candidate leads with original evidence links
          -> successful consumption progress

later evidence beyond that frontier
  -> remains available for another evaluation

failed or replaced work
  -> cannot advance successful progress or overwrite newer memory
```

Source statements enter capture without qualification. The curator defines
what it reads and how source material supports valid Session memory. Plans,
claims, observations, and corrections must retain their evidentiary meaning.
Existing memory does not become independent evidence for itself.

One Session row is one independently reconcilable recent-work node. Its
content concerns decisions, findings, progress, blockers, next actions, and
warnings against repeating work. It is continuity evidence, not repository
truth. Step 3 shapes this behavior. Step 5 proves the complete loop.

## Higher Durable Products

```text
Session candidate lead OR explicit targeted proposal
  -> selected product-owned Inbox
  -> product curator reads original evidence, applicable source state,
     and existing canonical memory
  -> product validates, reconciles, rejects, or publishes
  -> canonical Project, Personal, or Practice Markdown

lower-frequency product catch-up
  -> checks relevant original captured evidence even when Session emitted no lead
```

A lead is a proposition and reason to investigate. It is not authority or a
substitute for original evidence. Each product owns admission, applicability,
lifecycle, maintenance, and query. A shared submission contract does not
require shared lifecycle behavior.

Targeted proposals never enter evidence_items or Session Memory. Their
complete ordered Inbox batch and receipt commit atomically. The caller
selects exactly one durable target. [Targeted insertion](targeted-memory-insertion.md)
and [Inbox replay](durable-memory-inbox.md) preserve the accepted detailed path.

## Canonical Nodes And Retrieval Projections

```text
Session node                     -> canonical SQLite record
Project / Personal / Practice    -> one canonical Markdown document per node
semantic sections / chunks       -> derived retrieval units
FTS / vectors / caches            -> rebuildable indexes
```

Node identity survives title, content revision, and path changes. When content
needs an independent lifecycle, it belongs to an independent memory node.
Chunks do not create another canonical identity or authority model.

Canonical Markdown uses CommonMark, the admitted GFM subset, flat validated
YAML properties, and standard links. It is readable without Obsidian.
Application publication owns canonical writes; corrections enter product
reconciliation. Parsing uses a typed AST. Heading sections retain source
positions and atomic blocks; chunking does not split code blocks or tables.

SQLite and Markdown publication require explicit recovery rather than an
assumed cross-store transaction. Derived indexes may lag. Embedding generations
remain tied to their provider, model revision, dimensions, normalization,
purpose, and chunking contract. Incompatible query and document vectors do
not mix.

## Query Boundary

```text
question + current directory
  -> QueryService resolves applicability
      managed Project: Session, Project, Personal, Practice
      unmanaged directory: Personal, Practice
  -> each applicable product owns retrieval and qualification
  -> grouped typed results with canonical references, scope, provenance,
     lifecycle visibility, and freshness

optional answer aggregation
  -> separate agent task over the core results
  -> grounded response beside the unchanged core result
```

Core query is read-only and non-agentic. It does not register a Project,
curate memory, compare scores across products, or impose one memory payload.
Product-local relevance is not truth confidence. Session owns its returned
projection; higher products return canonical Markdown references.

## Provider And Runtime Boundary

Capture adapters parse native input without I/O. Agent-execution adapters own
provider process interaction and structural parsing. Workflow owners supply
their tasks and validate semantic admission. Provider output cannot write
canonical memory.

The application is a TypeScript modular monolith on Bun. Each invocation owns
one Application and SqliteDatabase lifetime. Processes coordinate durable
state through SQLite transactions and constraints. Runtime and schema code
remain the authority for implemented behavior. Installation, bootstrap, and
provider integration have separate lifecycles.
