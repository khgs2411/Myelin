# MaintenanceSectionTargetingFlow

Pseudocode artifact. Non-executable reference shape for planning.

## Intended Destination

Likely touches:

- `src/project/project-memory-curator-contracts.ts`
- `src/project/project-memory-packet.ts`
- `src/project/project-memory-curator-validator.ts`
- `src/project/project-memory-markdown-sections.ts`
- `src/project/project-memory-markdown-applier.ts`
- `src/project/project-memory-curator-service.ts`

## Owns

- Maintenance-mode section-first targeting.
- Candidate disposition during maintenance.
- Bounded deterministic update shape for existing Project Memory documentation.
- Missing-coverage diagnostics when no grounded write is possible.

## Does Not Own

- Creation-mode page-role publication.
- Runtime inbox file persistence.
- Retrieval vector indexing.
- Free-form markdown rewrite generation.

## Inputs

- Maintain-mode `ProjectMemoryPacket`.
- Trusted existing Project Memory state.
- Current wiki page and section manifest.
- Pending project candidates and project handoffs.
- Selected Session Memory as context/evidence leads.
- Lookup results with canonical refs and quality metadata.

## Target Shape

Maintenance proposal should target documentation ownership before write mechanics.

Conceptual item shape:

```text
maintenance_item:
  id
  operation: PATCH_SECTION | CREATE_SECTION | CREATE_PAGE | ATTACH_EVIDENCE | MARK_STALE | MARK_DISPUTED | NOOP
  source_packet_refs
  candidate_priority: normal | high
  target:
    wiki_path
    section_id?
    heading_path?
    ownership_reason
    target_kind: existing_section | new_section_in_existing_page | new_page
  content_intent
  apply_payload:
    section_or_entry_draft
  evidence_refs
  repo_citations
  candidate_disposition
  missing_coverage_diagnostic?
```

Planning may map this to current `entries` temporarily, but the design shape is section-first.

## Flow

1. Confirm Project Memory state is curated/trusted.
2. Build packet with current wiki structure and lookup results.
3. Curator reads candidate/handoff/session leads.
4. For each lead:
   - classify durability and layer ownership;
   - inspect bounded repo evidence in target repo cwd;
   - search current Project Memory sections;
   - pick smallest owning section when one exists;
   - create a new section under an existing page when page ownership exists but no section owns the concept;
   - create a new page only when no existing page owns the concept.
5. Curator emits item with candidate disposition:
   - applied_update;
   - already_trusted;
   - not_durable;
   - belongs_to_other_layer;
   - insufficient_evidence;
   - missing_coverage_no_grounded_write.
6. Validator checks:
   - target page/section exists when operation expects it;
   - new section/page is justified by ownership rules;
   - repo citations or inference labels support claims;
   - candidate text is not copied without repo evidence;
   - fallback lookup dependencies force review where required;
   - item preserves/improves Documentation Contract.
7. Content-quality decision:
   - trusted preservation/improvement => apply eligible;
   - missing coverage without grounded content => no write plus diagnostic;
   - shallow or broad rewrite => needs_review.
8. Applier performs bounded deterministic write:
   - patch existing section;
   - insert new section in owned page;
   - create new page only when validator accepted missing ownership;
   - update lifecycle marker for stale/disputed/retracted content.
9. Source consumption records mark project candidates/handoffs terminal only when applied or explicitly no-op accounted.

## Terminal States

- Eligible mutation: trusted content-quality preservation and deterministic write target.
- Explicit no-op: no write, but source/candidate checked against canonical evidence.
- Needs review: target selection, dedupe, broad rewrite, or evidence is insufficient.
- Failed: trusted state missing, target files missing during apply, or apply journal recovery failure.

## Idempotency

- Applying the same candidate twice should be prevented by source-consumption reconciliation or explicit no-op against existing canonical section.
- Section target IDs must remain stable enough that a rerun can recognize existing coverage.
- If a section heading changes, structural metadata should expose stale/orphaned refs and force review instead of writing into the wrong location.

## Failure Posture

- Missing existing section for a patch is review/failure before canonical write.
- Broad page rewrite without explicit ownership justification is not eligible.
- High-risk or degraded-context items remain quarantined/review-only.

## Review Points

- Planning must choose the concrete section identifier strategy: heading-derived IDs, explicit markers, generated anchors, or hybrid.
- Planning must decide whether current entry-block rendering is retired, adapted as a section marker, or kept only as a compatibility path.
- Exact operation enum names can change, but the section-first ownership rule should remain.
