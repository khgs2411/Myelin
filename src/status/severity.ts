import type { OperationalState, StatusSectionName, StatusWarning } from "./contracts.ts";

const RANK: Record<OperationalState, number> = { healthy: 0, attention: 1, blocked: 2 };

export function maxState(...states: OperationalState[]): OperationalState {
  return states.reduce((worst, state) => RANK[state] > RANK[worst] ? state : worst, "healthy");
}

export function aggregateOverall(states: OperationalState[]): OperationalState {
  return maxState(...states);
}

export function warning(
  code: string,
  severity: Exclude<OperationalState, "healthy">,
  section: StatusSectionName,
  message: string,
  evidenceIds: string[] = [],
): StatusWarning {
  return { code, severity, section, message, evidence_ids: evidenceIds };
}

export function sessionRetrievalState(active: number, indexed: number, pending: number, failed: number): OperationalState {
  if (active === 0) return "healthy";
  if (indexed === 0) return "blocked";
  return pending > 0 || failed > 0 ? "attention" : "healthy";
}

export function projectRetrievalState(curated: boolean, indexed: number, pending: number, failed: number): OperationalState {
  if (!curated) return "healthy";
  if (indexed === 0) return "blocked";
  return pending > 0 || failed > 0 ? "attention" : "healthy";
}
