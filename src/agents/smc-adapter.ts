import type { SMCTurnRequest, SMCTurnResult } from "./contracts.ts";
import { invokeSMCTurn } from "./execute.ts";

export type SMCTurnInvoker = (request: SMCTurnRequest) => Promise<SMCTurnResult>;

export const invokeSMCActionTurn: SMCTurnInvoker = async (request) => invokeSMCTurn(request);
