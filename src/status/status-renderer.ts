import type { ProjectOperationalStatusV1 } from "./status-v1.ts";

export function renderStatusHuman(status: ProjectOperationalStatusV1): string {
  const lines = [
    `Myelin status: ${status.overall_state}`,
    `Project: ${status.project.key} (${status.project.name}) [${status.project.resolved_from}]`,
    `Installation: ${status.installation.state} (${status.installation.lifecycle})`,
    `Session Memory: ${status.session_memory.state} (${status.session_memory.lifecycle})`,
    `  capture: ${status.session_memory.capture.queued_events} queued, ${status.session_memory.capture.unleased_events} unleased, ${status.session_memory.capture.leased_events} leased`,
    `  ingest: ${status.session_memory.ingest.running_jobs} running, ${status.session_memory.ingest.failed_jobs} failed, ${status.session_memory.ingest.terminal_tombstones} terminal`,
    `  embedding: ${renderContract(status.session_memory.retrieval.active_contract)}`,
    `  retrieval: ${status.session_memory.retrieval.indexed_count} indexed, ${status.session_memory.retrieval.pending_count} pending, ${status.session_memory.retrieval.failed_count} failed`,
    `Project Memory: ${status.project_memory.state} (${status.project_memory.lifecycle})`,
    `  inbox: ${status.project_memory.inbox.pending_items} pending`,
    `  candidates: ${status.project_memory.candidates.pending} pending, ${status.project_memory.candidates.needs_review} needs review`,
    `  curation: ${status.project_memory.curation.lifecycle}`,
    `  embedding: ${renderContract(status.project_memory.retrieval.active_contract)}`,
    `  retrieval: ${status.project_memory.retrieval.indexed_count} indexed, ${status.project_memory.retrieval.pending_count} pending, ${status.project_memory.retrieval.failed_count} failed`,
  ];
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

function renderContract(contract: ProjectOperationalStatusV1["session_memory"]["retrieval"]["active_contract"]): string {
  return contract ? `${contract.provider}/${contract.model} (${contract.dimensions}d, v${contract.format_version})` : "not active";
}
