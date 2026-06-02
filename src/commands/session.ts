import type { Cli } from "./registry.ts";
import { ok } from "./registry.ts";

export function registerSessionCommands(cli: Cli): void {
  cli.command(["session", "close"], () => ok("session close is registered but not implemented in this slice."));
}
