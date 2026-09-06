# LLM Wiki Project Context

This document records settled project language and ownership boundaries.
It complements the product overview in [README.md](README.md) and the detailed
[design index](docs/design/README.md).

## Authority

The Session decisions below come from explicit user direction on 2026-09-05
during Step 3 design. The user also accepted the publication condition for
promotion. These are intended product boundaries, not claims of implemented
behavior.

For these boundaries, this record supersedes older descriptions of editable
Session entries or one agent performing both curation and memory review.
On 2026-09-06, the user selected separate entry and lifecycle tables and direct
use of concrete Sequelize models by application services. Detailed storage and
execution mechanisms remain to be designed. The subsequent relationship
revision uses an explicit Session-to-Evidence linking table and Sequelize
associations instead of an evidenceIds array column.

## Language

**Session Memory entry**:
One immutable memory containing one coherent fact about recent work that a
later agent needs to continue correctly. Its canonical form is in SQLite.
Supporting context can explain the fact. Supersession replaces its active
role without rewriting its content.

**Active Session Memory**:
The small, short-lived set of Session entries relevant to continuing work.
Fewer than 100 active entries is a desired operating range, not a hard limit.
This target does not impose a limit on retained historical records.

**Evidence curator**:
An agent whose responsibility is to review evidence and curate new Session
entries from candidates. It does not decide the lifecycle of existing memories
or promote them to durable products.

**Memory reviewer**:
A separate agent whose responsibility is to review new memories against
retrieved existing memories. It re-qualifies their relevance, retires or
supersedes Session memories, and proposes promotion to durable memory.
These decisions do not authorize the agent to write canonical storage directly.

**Retirement**:
Removal of an entry from active Session Memory. Reasons include supersession,
loss of relevance to the current subject, and completed promotion. Retirement
does not mean rewriting the entry or deciding a historical deletion policy.

**Supersession**:
A newer memory replaces an older memory about the same subject for active
continuity. The older entry remains immutable.

**Promotion**:
The path from a Session memory to a candidate for Project, Personal, or Practice
Memory, followed by destination-owned review and canonical publication.
Candidate creation alone is not completed promotion.

**Durable memory**:
Project, Personal, or Practice Memory represented by canonical Markdown
documents. These products can revise their documents. Each owns candidate
curation and review against existing memories.

## Relationships

- The **Evidence curator** creates new entries. The **Memory reviewer** owns
  the separate comparison and lifecycle responsibility.
- New entries supply queries against existing memory. Cheap, non-agentic
  semantic/vector retrieval supplies comparison material. The **Memory
  reviewer** re-qualifies all retrieved results and makes the decisions;
  retrieval itself does not decide retirement, supersession, or promotion.
- The agentic tasks use a configurable, low-cost agent/model choice. A specific
  provider or model is not selected by this decision.
- Background maintenance can run during work sessions. **Active Session
  Memory** can lose relevance as the current subject changes, even without a
  replacement entry.
- When **Promotion** is the reason for retirement, the destination product
  must first accept and publish the durable memory. A pending, rejected, or
  failed candidate does not justify retirement on that basis. This prevents
  a continuity gap.
- Durable products retain their own admission authority and original evidence
  links. A Session promotion candidate does not bypass their curation.

## Flagged ambiguities

- Independent lifecycle does not mean editable Session content. Re-qualification,
  retirement, and supersession preserve entry immutability. A separate mutable
  lifecycle table has one row per entry. Application services use both concrete
  Sequelize models directly, without separate interfaces or read-mapping DTOs.
  This does not grant agents direct database access.
- The two agent responsibilities are separate. This does not require concurrent
  execution; review depends on new memories being available for comparison.
- An immutable Session entry and a revisable durable Markdown document have
  different content lifecycles. Generic memory revision language must not imply
  that Session content is edited in place.
