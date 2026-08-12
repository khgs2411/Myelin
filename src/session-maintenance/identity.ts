import { createHash } from "node:crypto";
import { stableJson } from "../runtime/json.ts";
import {
  SESSION_MAINTENANCE_PROJECTION_CONTRACT_VERSION,
  sessionMaintenanceProjectionJsonSchema,
} from "./output-contract.ts";
import { smcBatchProposalJsonSchema } from "./proposal-contract.ts";
import {
  SMC_TOOL_PROTOCOL_VERSION,
  smcActionJsonSchema,
  smcResultJsonSchema,
} from "./protocol.ts";
import {
  SESSION_MAINTENANCE_POLICY_TEXT,
  SESSION_MAINTENANCE_POLICY_VERSION,
} from "./policy.ts";

export type SessionMaintenanceIdentity = {
  version: string;
  digest: `sha256:${string}`;
};

export const SESSION_MAINTENANCE_TOOL_PROTOCOL_VERSION = SMC_TOOL_PROTOCOL_VERSION;

export function sessionMaintenancePolicyIdentity(): SessionMaintenanceIdentity {
  return {
    version: SESSION_MAINTENANCE_POLICY_VERSION,
    digest: digest({
      version: SESSION_MAINTENANCE_POLICY_VERSION,
      policy: SESSION_MAINTENANCE_POLICY_TEXT,
    }),
  };
}

export function sessionMaintenanceOutputContractIdentity(): SessionMaintenanceIdentity {
  return {
    version: String(SESSION_MAINTENANCE_PROJECTION_CONTRACT_VERSION),
    digest: digest({
      version: SESSION_MAINTENANCE_PROJECTION_CONTRACT_VERSION,
      canonicalization: "smc-proposal-projection-set-order-v1",
      batch_proposal_schema: smcBatchProposalJsonSchema(),
      accepted_projection_schema: sessionMaintenanceProjectionJsonSchema(),
    }),
  };
}

export function sessionMaintenanceToolProtocolIdentity(): SessionMaintenanceIdentity {
  return {
    version: SESSION_MAINTENANCE_TOOL_PROTOCOL_VERSION,
    digest: digest({
      version: SESSION_MAINTENANCE_TOOL_PROTOCOL_VERSION,
      authority: "coordinator-mediated",
      canonicalization: "strict-json-action-result-v1",
      action_schema: smcActionJsonSchema(),
      result_schema: smcResultJsonSchema(),
      canonical_write_authority: "myelin",
    }),
  };
}

function digest(value: unknown): `sha256:${string}` {
  return `sha256:${createHash("sha256").update(stableJson(value), "utf8").digest("hex")}`;
}
