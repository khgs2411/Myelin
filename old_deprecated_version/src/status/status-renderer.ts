import type { ProjectOperationalStatusV1 } from "./status-v1.ts";

export function renderStatusHuman(status: ProjectOperationalStatusV1): string {
  const lines = [
    `Myelin status: ${status.overall_state}`,
    `Project: ${status.project.key} (${status.project.name}) [${status.project.resolved_from}]`,
  ];
  if (status.briefing) renderSessionContinuity(lines, status.briefing.session_continuity);
  lines.push(
    `Installation: ${status.installation.state} (${status.installation.lifecycle})`,
    `Session Memory: ${status.session_memory.state} (${status.session_memory.lifecycle})`,
    `  capture: ${status.session_memory.capture.queued_events} queued, ${status.session_memory.capture.unleased_events} unleased, ${status.session_memory.capture.leased_events} leased`,
    `  ingest: ${status.session_memory.ingest.running_jobs} running, ${status.session_memory.ingest.failed_jobs} failed, ${status.session_memory.ingest.terminal_tombstones} terminal`,
    `  embedding: ${renderContract(status.session_memory.retrieval.active_contract)}`,
    `  retrieval: ${status.session_memory.retrieval.indexed_count} indexed, ${status.session_memory.retrieval.pending_count} pending, ${status.session_memory.retrieval.failed_count} failed`,
  );
  if (status.session_memory.smc) {
    const anchor = status.session_memory.smc.current_anchor;
    const projectFence = status.session_memory.smc.project_fence;
    const globalFence = status.session_memory.smc.global_embedding_fence;
    lines.push(
      `  SMC: freshness ${status.session_memory.smc.freshness.state}; audit ${status.session_memory.smc.audit_coverage.covered_revision_count}/${status.session_memory.smc.audit_coverage.active_revision_count} covered (${status.session_memory.smc.audit_coverage.due_revision_count} due); indexing ${status.session_memory.smc.indexing.state}`,
      `    queued: ${status.session_memory.smc.queued_content.count}; oldest age: ${status.session_memory.smc.queued_content.oldest_age_ms ?? "none"}ms`,
      `    anchor: ${anchor ? `${anchor.job_id} ${anchor.phase}@${anchor.owner_epoch}; reason ${anchor.reason_code ?? "none"}; liveness ${anchor.process.liveness} (${anchor.process.authority})` : "none"}`,
      `    project fence: ${projectFence ? `${projectFence.owner_kind}:${projectFence.owner_id}@${projectFence.owner_epoch}` : "none"}`,
      `    global embedding fence: ${globalFence ? `${globalFence.operation_kind}:${globalFence.operation_id}@${globalFence.owner_epoch}` : "none"}`,
      `    provider: ${status.session_memory.smc.indexing.provider_state}; permanent legacy denies: ${status.session_memory.smc.legacy.permanently_denied_job_count}`,
      `    reasons: ${status.session_memory.smc.reason_codes.length > 0 ? status.session_memory.smc.reason_codes.join(", ") : "none"}`,
    );
  }
  lines.push(
    `Project Memory: ${status.project_memory.state} (${status.project_memory.lifecycle})`,
    `  inbox: ${status.project_memory.inbox.pending_items} pending`,
    `  candidates: ${status.project_memory.candidates.pending} pending, ${status.project_memory.candidates.needs_review} needs review`,
    `  curation: ${status.project_memory.curation.lifecycle}`,
    `  embedding: ${renderContract(status.project_memory.retrieval.active_contract)}`,
    `  retrieval: ${status.project_memory.retrieval.indexed_count} indexed, ${status.project_memory.retrieval.pending_count} pending, ${status.project_memory.retrieval.failed_count} failed`,
  );
  if (status.warnings.length > 0) {
    lines.push("Warnings:");
    for (const item of status.warnings) lines.push(`  [${item.severity}] ${item.code}: ${item.message}`);
  }
  if (status.actions.length > 0) {
    lines.push("Actions:");
    for (const item of status.actions) lines.push(`  ${item.command} — ${item.reason}`);
  }
  const paths = status.evidence.map((item) => item.path);
  if (paths.length > 0) {
    lines.push("Evidence:");
    for (const path of paths) lines.push(`  ${path}`);
  }
  return lines.join("\n");
}

function renderSessionContinuity(
  lines: string[],
  continuity: NonNullable<ProjectOperationalStatusV1["briefing"]>["session_continuity"],
): void {
  lines.push(
    `Session continuity: ${continuity.state} (integrity ${continuity.integrity.state}, freshness ${continuity.freshness.state})`,
  );
  if (continuity.anchor_job) {
    lines.push(
      `  anchor job: ${continuity.anchor_job.ingest_job_id} at ${continuity.anchor_job.latest_memory_created_at}`,
    );
  }
  renderContinuityChannel(lines, "current state", continuity.current_state.items);
  renderContinuityChannel(lines, "completed outcomes", continuity.completed_outcomes.items);
  renderContinuityChannel(lines, "active blockers", continuity.active_blockers.items);
  renderContinuityChannel(lines, "next actions", continuity.next_actions.items);
  renderContinuityChannel(lines, "recent decisions", continuity.recent_decisions.items);
  if (continuity.reason_codes.length > 0) {
    lines.push(`  continuity reasons: ${continuity.reason_codes.join(", ")}`);
  }
}

function renderContinuityChannel(
  lines: string[],
  label: string,
  items: NonNullable<ProjectOperationalStatusV1["briefing"]>["session_continuity"]["current_state"]["items"],
): void {
  if (items.length === 0) return;
  lines.push(`  ${label}:`);
  for (const item of items) {
    const title = item.title ? `${item.title}: ` : "";
    lines.push(`    [${item.relation_to_anchor}] ${item.id} — ${title}${item.summary}`);
  }
}

function renderContract(contract: ProjectOperationalStatusV1["session_memory"]["retrieval"]["active_contract"]): string {
  return contract ? `${contract.provider}/${contract.model} (${contract.dimensions}d, v${contract.format_version})` : "not active";
}
