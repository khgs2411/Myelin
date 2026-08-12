import type {
  InstallationStatusSection,
  OperationalState,
  OperationalStatusResult,
  ProjectMemoryStatusSection,
  SessionMemoryStatusSection,
  StatusAction,
  StatusEvidence,
  StatusWarning,
} from "./contracts.ts";
import type { SessionCurrentContinuityV1 } from "../memory/session-current-continuity-types.ts";

export type StatusBriefingV1 = {
  contract_version: "myelin.status.briefing.v1";
  session_continuity: SessionCurrentContinuityV1;
};

export type ProjectOperationalStatusV1 = {
  contract_version: "myelin.status.v1";
  kind: "project_operational_status";
  generated_at: string;
  overall_state: OperationalState;
  project: OperationalStatusResult["project"];
  installation: InstallationStatusSection;
  session_memory: SessionMemoryStatusSection;
  project_memory: ProjectMemoryStatusSection;
  briefing?: StatusBriefingV1;
  warnings: StatusWarning[];
  actions: StatusAction[];
  evidence: StatusEvidence[];
};

export function serializeStatusV1(result: OperationalStatusResult): ProjectOperationalStatusV1 {
  return {
    contract_version: "myelin.status.v1",
    kind: "project_operational_status",
    generated_at: result.generated_at,
    overall_state: result.overall_state,
    project: {
      key: result.project.key,
      name: result.project.name,
      repo_paths: [...result.project.repo_paths].sort(),
      resolved_from: result.project.resolved_from,
    },
    installation: {
      ...result.installation,
      evidence_ids: [...result.installation.evidence_ids],
      providers: [...result.installation.providers].sort((a, b) => a.name.localeCompare(b.name)),
    },
    session_memory: cloneSection(result.session_memory),
    project_memory: cloneSection(result.project_memory),
    briefing: {
      contract_version: "myelin.status.briefing.v1",
      session_continuity: cloneSection(result.session_continuity),
    },
    warnings: [...result.warnings]
      .map((item) => ({ ...item, evidence_ids: [...item.evidence_ids] }))
      .sort((a, b) => a.section.localeCompare(b.section) || a.code.localeCompare(b.code) || a.message.localeCompare(b.message)),
    actions: [...result.actions]
      .map((item) => ({ ...item }))
      .sort((a, b) => a.section.localeCompare(b.section) || a.command.localeCompare(b.command) || a.reason.localeCompare(b.reason)),
    evidence: [...result.evidence]
      .map((item) => ({ ...item }))
      .sort((a, b) => evidenceNumber(a.id) - evidenceNumber(b.id) || a.id.localeCompare(b.id)),
  };
}

function cloneSection<T>(section: T): T {
  return structuredClone(section);
}

function evidenceNumber(id: string): number {
  const match = /^e(\d+)$/.exec(id);
  return match ? Number(match[1]) : Number.MAX_SAFE_INTEGER;
}
