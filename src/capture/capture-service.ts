import { handleProviderInput } from "./facade.ts";
import { codexInputAdapter } from "../inputs/providers/codex.ts";

export type CapturePayloadResult = {
  message: string;
};

export class CaptureService {
  constructor(private readonly root: string) {}

  async captureCodexPayload(payload: unknown): Promise<CapturePayloadResult> {
    const result = await handleProviderInput(this.root, codexInputAdapter.classify(payload));
    if (result.status === "failed-open") return { message: `capture failed open: ${result.error_message}` };
    if (result.status === "ignored") return { message: `codex hook ignored: ${result.reason}` };
    return { message: `capture ${result.status}` };
  }
}
