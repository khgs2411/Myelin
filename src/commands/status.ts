import type { Cli } from "./registry.ts";
import { ok } from "./registry.ts";

export function registerStatusCommand(cli: Cli): void {
  cli.command(["status"], () => {
    return ok("Myelin CLI is installed. Runtime: Bun/TypeScript. Project status: not loaded yet.");
  });
}
