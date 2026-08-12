> Archived raw brainstorming source.
>
> This file preserves the original project-rooted memory discussion. It is useful for recovering intent, but it is not the canonical product design. Use `../../MYELIN.md` for current product truth and `../README.md` for the current documentation map.

```
• You’re not lost. You just found the actual hierarchy.

  The shape is not five equal scopes. It is:

  Projects are the source of lived truth.
  From projects, the system derives:
  - product memory
  - session memory
  - reusable workflows
  - personal preferences
  - recipes/patterns
  - raw experience

  So I’d revise the model:

  1. Project Memory Is The Root
  Every repo/product remains the anchor. Not because the repo docs are the whole product, but because real work happens inside projects.

  Project memory should capture:

  - product behavior
  - features
  - architecture decisions
  - runbooks
  - testing flows
  - current work state
  - session summaries
  - important source references
  - what code alone does not explain cheaply

  This is the phrase to keep:

  > Project docs capture what code does not cheaply reveal.

  2. Session Memory Lives Under Project Memory
  You’re right: sessions are not free-floating. “What did we work on last session?” almost always means “in this project.”

  So session memory should be project-scoped by default, with optional cross-project visibility later.

  Example:

  projects/wodnix/sessions/latest
  projects/wodnix/sessions/by-card/C4ufaxDz
  projects/wodnix/current-state

  3. Recipe Memory Is Promoted, Not Referenced As Live Truth
  Your correction is important.

  Bad recipe:

  > “Do it like Wodnix/Suitepath.”

  Good recipe:

  > “This is how we run local Supabase stacks. It was derived from Wodnix and Suitepath. Current canonical recipe lives here.”

  References are provenance, not instructions.

  That means recipes need their own lifecycle:

  project experience -> candidate recipe -> canonical recipe -> later improved by newer projects

  If a future project does it better, the recipe updates. Older projects remain evidence, not authority.

  4. Personal Workflow Memory Is Also Derived From Projects
  Your preferences should not only be manually written. The system should observe repeated behavior:

  - you reject over-documentation
  - you prefer simulation testing in certain cases
  - you like local Supabase reset scripts
  - you prefer concise implementation cards
  - you push back on agents auditing their own plans

  Those become candidate preferences, then promoted into durable personal workflow memory.

  5. Raw Experience Feeds Everything
  Hooks and MCP callbacks capture raw activity. Background agents process it. Most gets ignored. Some becomes:

  - project session memory
  - stale markers
  - gap notes
  - recipe candidates
  - preference candidates
  - wiki updates

  So the architecture is more like:

  Raw events
    -> project-local memory
      -> curated project docs
      -> session continuity
      -> promoted recipes
      -> promoted personal preferences

  Now the MCP interface.

  I agree with you: too many named tools can make the product feel scattered. A smaller semantic interface may be better.

  Maybe the public MCP surface should be:

  query
  Ask what is true or known.

  Examples:

  - “What did we work on last session?”
  - “How does class visibility work?”
  - “What is stale in this project?”
  - “What does Liad prefer for testing?”

  how
  Ask for operating guidance.

  Examples:

  - “How do we run local Supabase?”
  - “How do we create a DigitalOcean serverless function?”
  - “How should I test this feature?”
  - “How should I approach this repo?”

  what
  Ask for current state or inventory.

  Examples:

  - “What project am I in?”
  - “What features exist?”
  - “What sessions are recent?”
  - “What recipes do we have?”
  - “What changed since the last compile?”

  Behind the scenes, these are routed into different stores:

  query -> factual retrieval + synthesis
  how   -> recipe/workflow retrieval + project examples
  what  -> structured state/session/project inventory

  That feels cleaner than exposing implementation concepts like find_recipes or record_observation as primary user tools.

  Internal/private tools can still exist:

  record_event
  promote_observation
  flag_gap
  refresh_index
  embed_project
  update_recipe_candidate

  But agents mostly use:

  query
  how
  what

  The north star now sounds like:

  > LLM Wiki becomes a project-rooted memory system for coding agents. It preserves curated product knowledge, captures session continuity, derives reusable workflows from real projects, and serves all of it through a
  > small semantic MCP interface.

  And the implementation order probably becomes:

  1. Keep project docs, but make them less redundant and more behavior-focused.
  2. Add SQLite as the memory/event/session substrate.
  3. Add vector search as the retrieval layer.
  4. Add hooks/MCP callbacks to capture raw experience.
  5. Add background promotion agents.
  6. Add cross-project recipe and personal workflow promotion.

  So yes: A, B, and C are all connected.

  The real sequencing is:

  Option B first
  Option A immediately alongside it
  Option C as the organizing model

  That’s the shape.
  ```

```
  What LLM Wiki Manages

  LLM Wiki should manage four durable things and one noisy thing.

  1. Project Brain
  This is still the core.

  It manages:

  - product behavior
  - feature maps
  - architecture decisions
  - runbooks
  - local setup
  - testing workflows
  - current state
  - session summaries
  - source provenance

  Rule:

  > Project Brain captures what code does not cheaply reveal.

  It should not try to summarize every module or mirror repo structure unless that summary explains behavior, intent, or operational practice.

  2. Personal Brain
  This is your working style, but not as random notes.

  It manages:

  - agent behavior preferences
  - testing philosophy
  - planning/review habits
  - preferred tools
  - disliked patterns
  - recurring architectural instincts
  - cross-repo conventions

  Important: this should be derived from project work when possible, not only hand-authored.

  Example:

  > “Prefer simulation/manual flow testing for role-based product behavior; use unit tests for deterministic utilities.”

  That can be derived from Wodnix, Suitepath, Eden, etc.

  3. Recipe Brain
  This is canonical “how we do X.”

  Not:

  > “Do it like Wodnix.”

  Instead:

  > “This is the local Supabase workflow. Evidence came from Wodnix and Suitepath. Current recipe version is canonical.”

  It manages:

  - local Supabase workflow
  - serverless function deploy workflow
  - GitHub Pages OAuth workaround
  - Trello/Symphony card patterns
  - MCP server patterns
  - QA session patterns

  Recipes are agnostic, versioned, and improvable.

  4. Session Brain
  Project-scoped continuity.

  It manages:

  - last session summary
  - current task state
  - branch/commit/PR/Trello state
  - next actions
  - blockers
  - manual test plan
  - “do not redo this” notes

  I agree with your correction: this belongs under project memory by default.

  5. Experience Log
  Noisy raw substrate.

  It manages:

  - hook events
  - MCP calls
  - queries
  - selected pages
  - failed searches
  - opened files
  - user corrections
  - tool outputs
  - agent stop summaries

  This is not truth. It is evidence.

  The promotion path is:

  experience log
    -> project session memory
    -> project brain update
    -> recipe candidate
    -> personal preference candidate
    -> canonical recipe / preference

  Agent-Facing Tools

  I like your instinct: keep the interface abstract.

  The public MCP tools should probably be:

  query
  Use when the agent wants to know something.

  Examples:

  - “What did we work on last session?”
  - “How does class visibility work?”
  - “What does Liad prefer for tests?”
  - “What is known about Supabase in this repo?”

  This is the main interface.

  how
  Use when the agent wants operating guidance.

  Examples:

  - “How do we run local Supabase?”
  - “How should I test this feature?”
  - “How do we create a DigitalOcean function?”
  - “How should I approach this repo?”

  This routes more heavily toward recipes, workflows, and personal preferences.

  what
  Use when the agent wants state/inventory.

  Examples:

  - “What project am I in?”
  - “What changed since last session?”
  - “What sessions exist?”
  - “What memory scopes are available?”
  - “What is stale?”

  This should be mostly structured and cheap.

  I would keep lower-level tools, but not as the primary interface:

  - read_page
  - plan_query
  - record_observation
  - flag_wrong
  - enrich_gap
  - list_projects
  - refresh_index

  Those are supporting tools. Most agents should start with query/how/what.

  Agents The Product Runs

  This is the important part.

  I’d define background agents by responsibility, not by model/provider.

  1. Event Collector
  When: always, via hooks and MCP callbacks.
  Why: capture raw experience cheaply.

  It does not reason much. It writes structured events:

  event_type
  project
  session_id
  tool
  input summary
  output summary
  files touched
  confidence signals
  timestamp

  2. Session Curator
  When: at stop/end of session, or periodically during long sessions.
  Why: maintain “what did we work on last session?”

  It writes project-scoped session memory:

  - what changed
  - what was verified
  - what remains
  - what card/branch/task this relates to
  - next suggested action

  This is the agent that would have prevented your Wodnix example from requiring manual reconstruction.

  3. Gap Curator
  When: after low-confidence query, bad answer flag, failed route, or user correction.
  Why: turn missing knowledge into project inbox work.

  This is close to what the current query_wiki -> gap-note -> auto-update already does.

  4. Project Brain Curator
  When: after meaningful sessions, commits, or explicit update.
  Why: update project docs so they stay behavior-focused.

  This is the evolved make update.

  It should ask:

  - Did product behavior change?
  - Did setup/runbook knowledge change?
  - Did current state change?
  - Did this merely change code that agents can inspect directly?

  5. Recipe Promoter
  When: after repeated similar project patterns or explicit user note.
  Why: derive canonical cross-project “how we do X.”

  Example trigger:

  > local Supabase reset pattern appears in Suitepath and Wodnix, user keeps asking about it.

  Output:

  > canonical recipe: “Local Supabase workflow.”

  6. Preference Promoter
  When: after repeated user corrections/preferences.
  Why: grow your personal brain.

  Example trigger:

  > user repeatedly rejects “unit tests first” for manual product behavior QA.

  Output:

  > personal preference candidate: “For role/workflow features, prefer simulation/manual flow validation before isolated unit tests.”

  7. Indexer
  When: after file/wiki/session/recipe changes.
  Why: embed and update SQLite/vector search.

  This one is deterministic as much as possible:

  - chunk
  - hash
  - skip unchanged
  - embed changed chunks
  - write vector rows

  How It Actually Works

  A normal interaction should look like:

  Agent asks: "What did we do last session?"

  MCP query:
    route intent = session/project continuity
    read SQLite structured session state
    maybe vector search recent session summaries
    return concise answer with provenance

  Hook/event:
    record that this continuity query happened

  If answer was weak:
    emit gap note or session-memory repair task

  A “how do I work with Supabase?” interaction:

  Agent asks: "How do we run local Supabase?"

  MCP how:
    route intent = recipe/workflow
    search canonical recipes
    search project examples as evidence
    include current project-specific overrides
    return canonical guidance + source projects

  If useful project evidence is newer than recipe:
    create recipe-review candidate

  A long coding session:

  Hooks collect events
  Session curator summarizes periodically
  Project brain curator updates project docs when durable behavior changes
  Recipe/preference promoters watch for reusable patterns
  Indexer keeps SQLite/vector current

  The clean boundary:

  - MCP tools serve agents in the moment.
  - Hooks collect what happened.
  - Background agents decide what matters.
  - Project wiki/personal/recipe memory hold curated truth.
  - SQLite/vector makes all of it fast and searchable.

```

```
• This is the right constraint. V2 should not become “summon an agent for every event”; the strong design is to make most hooks cheap and deterministic, then use agents only at promotion boundaries where judgment is
  required.

• The rule should be:

  > Capture everything cheaply. Reason over almost nothing immediately. Promote with agents only when there is a clear value trigger.

  I’d split the system like this.

  Deterministic / Scripted
  These should be code, not agents.

  - Capture hook events.
  - Normalize events into SQLite.
  - Detect current project/session from cwd/git.
  - Hash chunks and skip unchanged content.
  - Chunk markdown/code/session summaries.
  - Maintain SQLite tables.
  - Maintain vector index.
  - Run lexical search / metadata filtering.
  - Route obvious what queries to structured state.
  - Enforce budgets, locks, debounce windows, and queues.
  - Move inbox items between pending/processed/needs-review after pipeline result.
  - Track stale timestamps and source commit pointers.

  These are boring, repeatable, and should not spend tokens.

  Automated But Not Agentic
  These can run in the background frequently.

  - Hook event ingestion.
  - Periodic event compaction.
  - Embedding changed chunks.
  - Updating latest_session pointer.
  - Building project inventory.
  - Refreshing search indexes.
  - Creating cheap candidate records like:
      - “possible gap”
      - “possible recipe evidence”
      - “possible preference evidence”
      - “session has unsummarized events”

  This layer prepares work. It does not decide durable truth.

  Agentic
  Agents should run only when judgment is needed.

  - Summarizing a meaningful session.
  - Deciding whether raw events contain durable project knowledge.
  - Updating project brain pages.
  - Turning repeated project evidence into a recipe candidate.
  - Promoting a recipe candidate into canonical recipe memory.
  - Promoting repeated user behavior into personal workflow memory.
  - Reconciling contradictions.
  - Answer synthesis when deterministic retrieval is insufficient.
  - Validating whether a stale/missing answer should become an inbox item.

  This is where language judgment matters.

  Manual / Operator-Controlled
  These should require your command or an explicit flag.

  - Full project compile.
  - Cross-project recipe promotion.
  - Personal workflow memory promotion.
  - Superseding a canonical recipe.
  - Changing decision records.
  - Processing large pending queues.
  - Running expensive embedding/index rebuilds.
  - Background learning during unstable feature work.

  This matters because a feature in progress is not necessarily knowledge yet.

  Trigger Model

  I’d keep the current auto_update idea and generalize it.

  Every write-ish memory action should have a mode:

  mode = off | queue | auto

  Meaning:

  - off: capture raw events only.
  - queue: create candidate/inbox items, do not run agents.
  - auto: create candidate/inbox items and spawn bounded background processing.

  Default by source:

  Hook event                 -> queue/compact only
  MCP low-confidence query   -> queue, maybe auto if enabled
  User correction            -> auto by default
  Explicit enrich_gap        -> auto by default, current behavior
  Session stop               -> queue summary candidate, not full brain update
  Manual "remember this"     -> auto by default
  Commit/PR complete         -> auto project-brain update candidate
  Cross-project pattern      -> queue only
  Preference promotion       -> queue only
  Recipe promotion           -> queue only

  Important Distinction

  There are two different background jobs:

  Cheap background jobs
  Run often.

  - ingest events
  - update indexes
  - embed changed chunks
  - maintain session pointers

  Expensive background jobs
  Run only by trigger/flag.

  - summarize
  - curate
  - update wiki
  - promote recipes
  - promote preferences

  Do not let hooks directly start expensive jobs.

  Hooks should write events like:

  Codex PostToolUse -> event_log
  Codex Stop -> session_end_marker
  MCP query miss -> gap_candidate
  User correction -> correction_candidate

  Then a scheduler/queue decides what to do.

  Practical V2 Policy

  I’d write this into the spec:

  1. Hooks are never allowed to call LLMs directly.
  2. Hooks never mutate curated memory.
  3. Hooks only append raw events and enqueue candidates.
  4. Deterministic workers may run continuously.
  5. Agentic workers require an explicit trigger, debounce, budget, and lock.
  6. Project-brain updates can default to auto.
  7. Recipe and personal-brain promotions default to queue.
  8. Manual commands can process any queue.

  Commands / Controls

  You probably want commands like:

  make memory-index PROJECT=wodnix
  make memory-session PROJECT=wodnix AUTO=1
  make memory-update PROJECT=wodnix AUTO=1
  make memory-promote-recipes
  make memory-promote-preferences
  make memory-drain PROJECT=wodnix

  And MCP flags like:

  auto_update=true   -> run bounded project update
  auto_update=false  -> queue only
  learning=off       -> raw capture only
  learning=queue     -> candidates only
  learning=auto      -> bounded background curation

  My Strong Recommendation

  For V2, make only these agentic at first:

  1. enrich_gap / correction-driven project update, preserving today’s model.
  2. End-of-session summarizer, project-scoped.
  3. Explicit manual project memory update.

  Everything else should be deterministic or queued.

  Do not start with automatic recipe/personal-memory promotion. That is powerful but dangerous. Start by collecting evidence for it, then promote manually until the shape is proven.

```
