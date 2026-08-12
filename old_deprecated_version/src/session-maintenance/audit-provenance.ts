import type { Database } from "bun:sqlite";

export function readAuditInheritedSourceRefs(db: Database, jobId: string, workBatchId?: string): Set<string> {
  const refs = new Set<string>();
  const batchPredicate = workBatchId === undefined ? "" : " AND a.batch_id = ?";
  const args = workBatchId === undefined ? [jobId] : [jobId, workBatchId];
  const memories = db.query(
    `SELECT s.source_event_refs_json FROM smc_audit_batch_members a
     JOIN smc_memory_snapshot s ON s.job_id = a.job_id AND s.memory_id = a.memory_id
     WHERE a.job_id = ?${batchPredicate} ORDER BY a.ordinal`,
  ).all(...args) as Array<{ source_event_refs_json: string }>;
  for (const row of memories) addJsonRefs(refs, row.source_event_refs_json);
  const contexts = db.query(
    `SELECT c.source_event_ref FROM smc_audit_batch_members a
     JOIN smc_memory_snapshot_contexts c ON c.job_id = a.job_id AND c.memory_id = a.memory_id
     WHERE a.job_id = ?${batchPredicate} ORDER BY a.ordinal, c.ordinal`,
  ).all(...args) as Array<{ source_event_ref: string }>;
  for (const row of contexts) refs.add(row.source_event_ref);
  const links = db.query(
    `SELECT l.source_event_refs_json FROM smc_audit_batch_members a
     JOIN smc_memory_snapshot_links l
       ON l.job_id = a.job_id AND (l.source_memory_id = a.memory_id OR l.target_memory_id = a.memory_id)
     WHERE a.job_id = ?${batchPredicate} ORDER BY a.ordinal, l.link_id`,
  ).all(...args) as Array<{ source_event_refs_json: string }>;
  for (const row of links) addJsonRefs(refs, row.source_event_refs_json);
  return refs;
}

function addJsonRefs(target: Set<string>, value: string): void {
  try {
    const parsed = JSON.parse(value);
    if (Array.isArray(parsed)) for (const item of parsed) if (typeof item === "string") target.add(item);
  } catch {
    // Frozen provenance is validated elsewhere; invalid rows fail later integrity checks.
  }
}
