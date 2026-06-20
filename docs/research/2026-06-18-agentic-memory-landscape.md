# Agentic Memory Landscape Research Intake

Status: research intake. Use as design input, not as an implementation plan.

Source material:

- Karpathy's LLM Wiki gist, provided by the user as the origin pattern for Myelin: <https://gist.github.com/karpathy/442a6bf555914893e9891c11519de94f>
- User-provided ChatGPT Pro Deep Research export in the current design session.
- Spot-verified primary sources listed below.

## Executive Synthesis

The strongest research-backed correction is:

```text
local evidence ledger
  -> typed candidate claims
  -> autonomous assurance
  -> canonical markdown claims/views
  -> rebuildable hybrid indexes
  -> applicability-aware retrieval
```

Myelin should preserve the user-facing memory layers:

- Experience Log
- Session Memory
- Project Memory
- Practice Memory
- Personal Memory

But those layers should not become independent memory architectures. They should be scopes and policies over a common governed substrate: evidence, candidates, claims, applicability, provenance, lifecycle, taint, assurance, and retrieval telemetry.

The major design risk is not whether vector retrieval works. It is whether Myelin can prevent unsupported, stale, branch-wrong, tainted, or overgeneralized memory from becoming trusted agent context.

## Origin Pattern Intake

Karpathy's LLM Wiki pattern is the product origin, not just an adjacent inspiration. Its core correction to ordinary RAG is that knowledge should compile into a persistent, maintained markdown wiki instead of being rediscovered from raw chunks on every query.

The origin pattern has three important layers:

- immutable raw sources
- an LLM-maintained markdown wiki
- a schema or instruction layer that teaches the agent how to maintain the wiki

Its operating loop is:

- ingest sources into existing wiki pages
- query the wiki and optionally file useful answers back into the wiki
- lint the wiki for contradictions, stale claims, orphans, missing links, and gaps
- maintain `index.md` as content navigation and `log.md` as chronological evolution

Myelin should preserve that essence:

- the wiki compounds knowledge over time
- sources remain separate from synthesis
- agents perform the bookkeeping
- query output can become durable memory when it has future value
- maintenance is a first-class operation, not an afterthought

Myelin deliberately hardens the pattern for a narrower and riskier product: autonomous coding agents working across branches, worktrees, repos, and time. That means the markdown wiki cannot be only free-form prose. It needs claim identity, evidence, applicability, lifecycle, taint, and assurance metadata so agents can know when a memory applies and when not to trust it.

The public gist thread also adds useful engineering pressure, though it should not be treated as Karpathy's canonical position. Commenters highlight that git branch-and-merge solves textual conflicts, not semantic duplicate facts; writes should be idempotent and as order-independent as possible; and deduplication should key on stable claim/source identity rather than page position or prose similarity. This reinforces Myelin's claim-centric design.

## Verified External Anchors

The following sources were spot-verified during intake:

- MemGPT frames long-context agents around hierarchical memory and virtual context management, supporting Myelin's tiered-memory direction: <https://arxiv.org/abs/2310.08560>
- LangGraph distinguishes short-term and long-term memory, semantic/episodic/procedural memory, profile vs collection tradeoffs, and hot-path vs background writes: <https://docs.langchain.com/oss/python/concepts/memory>
- Generative Agents is the standard recency/relevance/importance retrieval baseline: <https://arxiv.org/abs/2304.03442>
- CoALA gives useful cognitive-memory vocabulary, but not a production storage design: <https://arxiv.org/abs/2309.02427>
- Reflexion stores verbal reflections from feedback in episodic memory, supporting first-class failure/lesson memory: <https://arxiv.org/abs/2303.11366>
- Voyager stores executable skills and uses execution feedback/self-verification, relevant to future Practice Memory: <https://arxiv.org/abs/2305.16291>
- Graphiti/Zep documents a temporal knowledge-graph direction that reinforces valid-time and invalidation semantics: <https://help.getzep.com/graphiti/getting-started/welcome>
- Mem0 documents pragmatic long-term memory extraction and retrieval evolution: <https://docs.mem0.ai/migration/oss-v2-to-v3>
- LongMemEval decomposes long-term-memory quality into indexing, retrieval, and reading, and evaluates information extraction, multi-session reasoning, temporal reasoning, knowledge updates, and abstention: <https://arxiv.org/abs/2410.10813>
- LongMemEval-V2 focuses on long-running agent experience, workflows, gotchas, dynamic state, and premise awareness: <https://arxiv.org/abs/2605.12493>
- STALE focuses on detecting memories that are no longer valid and premise resistance when a query assumes stale state: <https://arxiv.org/abs/2605.06527>
- MemoryGraft argues persistent memory can become a durable attack surface through poisoned experience retrieval: <https://arxiv.org/abs/2512.16962>

Unverified or partially verified items from the generated report should remain research leads until checked directly:

- PROJECTMEM
- Hindsight
- MemMachine
- SAGE
- A-MEM
- ByteRover details beyond its arXiv existence
- MemConflict details beyond arXiv existence

## Design Implications For Myelin

### 1. Layers Are Product Scopes, Not Storage Engines

The current layer split is valuable to users and agents, but the implementation should avoid separate lifecycle semantics per layer.

Each durable memory item should have shared fields:

- stable ID
- scope
- cognitive type: episodic, semantic, procedural, policy
- epistemic role: evidence, signal, claim, inference, instruction
- authority
- source taint
- evidence references
- applicability: project, branch, worktree, commit range, version range
- lifecycle status
- valid-time and transaction-time
- verification state
- retrieval and usage telemetry

Layer policy then decides what may be promoted, how it is verified, and where it is rendered canonically.

### 2. Project Memory Should Be Claim-Centric

The existing `wiki/` markdown home is still correct, but the unit of truth should be closer to a typed claim than a free-form page paragraph.

A Project Memory claim needs:

- title and claim body
- claim kind
- applicability
- evidence refs
- verification refs
- source authority
- taint
- lifecycle state
- supersedes / contradicts / depends-on relations
- timestamps
- last verified commit

Human-readable wiki pages can remain canonical artifacts, but they should be structured enough for deterministic validation and indexing. Large free-form agent-edited pages are likely to produce merge churn, duplicate sections, and unsupported paragraphs.

### 3. Applicability Gates Must Precede Ranking

A semantically relevant memory from the wrong branch, worktree, project, version, or lifecycle state is not a good retrieval result.

Project Memory retrieval should first apply hard gates:

- project
- access/scope
- lifecycle status
- branch
- commit or version applicability
- worktree
- claim kind
- taint policy

Only after those gates should Myelin rank candidates by exact match, FTS/BM25, vector similarity, relation expansion, recency, trust, staleness, and query-mode fit.

### 4. Hybrid Retrieval Beats Vector-Only Retrieval

Vector search should stay a retrieval aid, not the retrieval product.

Candidate generation should have independent channels:

- exact ID/path/symbol/error/test/commit lookup
- FTS5 or BM25
- vector similarity
- relation expansion
- recent Session Memory when the query mode asks for current work

Fuse rankings with a stable method such as reciprocal rank fusion instead of comparing raw vector and BM25 scores directly.

### 5. Query Modes Should Be Explicit

The same text question can require different memory behavior. Add explicit internal modes rather than relying only on natural-language inference:

- current_state
- why
- how_to
- what_failed
- verification
- still_true
- pre_action
- historical

For example, `current_state` should strongly exclude superseded/stale memory, while `why` may need historical and superseded claims.

### 6. Lifecycle Needs More Than Active/Superseded

Use explicit lifecycle states:

- candidate
- active
- stale_pending
- disputed
- superseded
- retracted
- quarantined
- rejected

Important distinctions:

- Superseded means once valid but replaced.
- Retracted means should not have been trusted.
- Stale-pending means dependencies changed and revalidation is needed.
- Disputed means credible conflict exists.
- Quarantined means unsafe, malformed, tainted, or high-risk unresolved content.

### 7. Autonomous Assurance Replaces Human Review

The research reinforces the correction already made in the Project Memory Curator spec: routine memory maintenance must not become a human approval inbox.

A stronger autonomous assurance pipeline should use:

- typed mutation plans
- deterministic validation
- source reference resolution
- branch/worktree/commit checks
- schema checks
- protected metadata enforcement
- secret and sensitive-data scans
- contradiction lookup
- independent semantic verification for risky changes
- reconciliation when validator and curator disagree
- quarantine or degraded state when assurance fails

### 8. Project Memory Curator Should Produce Mutation Plans

The curator should not directly rewrite arbitrary markdown as its primary output.

Allowed operations should be typed:

- CREATE
- PATCH
- SPLIT
- MERGE
- ATTACH_EVIDENCE
- REVALIDATE
- SUPERSEDE
- RETRACT
- MARK_STALE
- MARK_DISPUTED
- QUARANTINE
- NOOP

Trusted runtime code should stamp authority, source identity, branch, commit, hashes, validation result, and publication state. The model should not self-assign those fields.

### 9. Session Memory Needs Structured State Too

SQLite plus embeddings is reasonable, but Session Memory should not be vector-centric.

Most session continuity queries are structurally predictable:

- objective
- branch/worktree/commit
- changed files
- active blockers
- recent decisions
- attempts and outcomes
- pending verification
- next actions
- handoff candidates

Use deterministic session state for recent continuity and vector search for older episodes, rationale, and semantically similar failures.

### 10. Practice And Personal Need Stricter Promotion Rules

Practice Memory should behave more like a verified procedure or skill library:

- problem class
- applicability predicates
- version ranges
- required tools
- steps
- verification
- known failures
- counterexamples
- source projects
- successful and negative usage history

Personal Memory should separate:

- explicit preferences
- inferred tendencies
- agent behavior constraints

Repository content and external web content must not directly create Personal Memory.

### 11. Security Is A First-Class Memory Concern

Persistent memory creates a durable attack surface. A bad memory only has to be written once to affect future agents.

Required controls:

- source isolation
- taint propagation
- control-data separation
- procedure gating
- provenance-visible retrieval
- cross-scope write restrictions
- no untrusted procedural activation
- no repository-authored Personal Memory

## Scoring Directions

Do not build one universal memory score. Separate:

- retrieval score
- trust score
- staleness score
- promotion score
- assurance risk score

### Retrieval

Use hard gates first:

```text
G = project * access * lifecycle * branch * commit * worktree * kind * taint_policy
```

Then rank:

```text
retrieve =
  rrf
  + exact_scope
  + query_mode_fit
  + trust
  + freshness
  + verified_usage
  - conflict
  - redundancy
  - token_cost
```

Action-oriented retrieval should multiply by trust and freshness so a relevant but weakly supported instruction cannot outrank a verified procedure.

### Trust

Trust should include:

- source authority
- provenance completeness
- deterministic verification
- independent corroboration
- verified usage outcomes
- inference depth penalty
- contradiction penalty
- taint penalty
- branch ambiguity penalty

Usage should be counted only from independently verified outcomes, not from "the agent used this memory and said it helped."

### Staleness

For project memory, repository changes dominate wall-clock age:

- dependency/source-path change
- missing symbol/path
- branch divergence
- invalidated source
- contradiction
- time since verification by claim kind
- recent verification

### Promotion

Promotion should estimate future decision value, not interestingness:

- future utility
- recurrence
- evidence strength
- verification
- persistence
- compression value
- novelty
- uncertainty penalty
- contradiction penalty
- transience penalty
- privacy/security penalty
- negative-transfer penalty

### Assurance Risk

Risk should include:

- blast radius
- actionability
- scope breadth
- source taint
- contradiction
- novelty
- confidence gap
- branch ambiguity
- irreversibility

Hard overrides:

- secret or sensitive data -> quarantine
- untrusted source creates Personal/policy memory -> reject
- unresolved branch applicability -> do not publish
- action-oriented contradiction -> disputed or quarantined
- missing evidence -> invalid proposal
- model tries to self-stamp trust/verification -> invalid proposal

## Evaluation Recommendations

Build a repo-specific benchmark rather than relying only on conversational memory benchmarks.

Initial fixture cases:

- superseded decision
- retraction
- branch divergence
- worktree isolation
- revert
- rename/move
- dependency upgrade
- failed approach followed by successful fix
- duplicate Session handoffs
- contradictory sources
- planned vs implemented
- malicious repo instruction
- well-provenanced false claim
- cross-project negative transfer
- explicit vs inferred preference
- secret or sensitive value
- premise-awareness query

Stage-specific metrics:

- unsupported active-claim rate
- stale-active rate
- branch/worktree leakage rate
- inappropriate cross-layer promotion rate
- provenance completeness
- evidence-reference validity
- conflict-detection F1
- retrieval Recall@k / MRR / nDCG
- current-state temporal accuracy
- contradiction visibility
- abstention accuracy
- memory-induced error rate
- taint escape rate
- unauthorized cross-scope promotion

The launch metric should be unsupported active-claim rate, not total memories created.

## Recommended Spec Changes

Update the Project Memory Curator design to:

- rename the core model from "curated wiki updates" to "governed claim compilation"
- define typed Project Memory claims
- define lifecycle states including disputed, retracted, stale_pending, and quarantined
- add applicability fields: branch, worktree, commit range, version range
- require mutation plans as curator output
- require deterministic validation before publication
- add independent semantic assurance for high-risk changes
- add taint/source authority policy
- add hybrid retrieval and explicit query modes
- add MyelinBench as a planning boundary before broad autonomous curation

## Priority Reading

Read in this order:

1. LongMemEval-V2
2. STALE and MemConflict
3. MemoryGraft
4. Graphiti/Zep facts and temporal model
5. LangGraph memory overview
6. MemGPT / Letta
7. Generative Agents and CoALA
8. Reflexion and Voyager
9. Mem0 architecture docs

## Design Verdict

The Project Memory layer should not be an autonomous wiki gardener.

It should be a governed claim compiler:

```text
evidence -> candidates -> claims -> assurance -> markdown -> indexes -> retrieval
```

The wiki remains central, but the product differentiation is not "agents write markdown." It is that agents can know what a memory means, where it applies, what supports it, when it stopped being valid, and when not to trust it.
