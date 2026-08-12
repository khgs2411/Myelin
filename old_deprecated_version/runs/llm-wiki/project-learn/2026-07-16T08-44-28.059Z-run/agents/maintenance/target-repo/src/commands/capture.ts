import { CaptureService } from "../capture/capture-service.ts";
import type { LaunchContext } from "../runtime/launch-context.ts";
import type { Cli, CommandResult } from "./registry.ts";
import { ok } from "./registry.ts";

export type CaptureCommandDeps = { context: LaunchContext };

export function registerCaptureCommands(cli: Cli, deps: CaptureCommandDeps): void {
  cli.command(["capture", "codex-hook"], async () => {
    try {
      if (isCaptureDisabled()) return ok("");
      const payload = JSON.parse(await Bun.stdin.text());
      await captureCodexPayload(deps.context.myelinRoot, payload);
    } catch {
      // Codex hooks must fail open; capture should never interrupt an agent session.
    }
    return ok("");
  });
}

export function isCaptureDisabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.MYELIN_CAPTURE_DISABLED === "1";
}

export async function captureCodexPayload(root: string, payload: unknown): Promise<CommandResult> {
  const result = await new CaptureService(root).captureCodexPayload(payload);
  return ok(result.message);
}
