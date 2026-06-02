import type { Cli } from "./registry.ts";
import { ok } from "./registry.ts";

export function registerProjectCommands(cli: Cli): void {
  cli.command(["project", "learn"], () => ok("project learn is registered but not implemented in this slice."));
  cli.command(["project", "ingest"], () => ok("project ingest is registered but not implemented in this slice."));
  cli.command(["project", "onboard"], () => ok("project onboard is registered but not implemented in this slice."));
}
