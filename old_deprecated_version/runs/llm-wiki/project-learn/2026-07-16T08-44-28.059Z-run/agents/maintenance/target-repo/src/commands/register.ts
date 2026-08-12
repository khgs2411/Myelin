import type { LaunchContext } from "../runtime/launch-context.ts";
import { registerBootstrapCommand } from "./bootstrap.ts";
import { registerCaptureCommands } from "./capture.ts";
import { registerIngestCommands } from "./ingest.ts";
import { registerInstallCommands } from "./install.ts";
import { registerMemoryCommands } from "./memory.ts";
import { registerMaintenanceCommands } from "./maintenance.ts";
import { registerProjectCommands } from "./project.ts";
import type { Cli } from "./registry.ts";
import { registerSchemaCommands } from "./schema.ts";
import { registerSessionCommands } from "./session.ts";
import { registerStatusCommand } from "./status.ts";

export type CommandRegistrars = {
  status: typeof registerStatusCommand;
  bootstrap: typeof registerBootstrapCommand;
  capture: typeof registerCaptureCommands;
  install: typeof registerInstallCommands;
  ingest: typeof registerIngestCommands;
  memory: typeof registerMemoryCommands;
  maintenance: typeof registerMaintenanceCommands;
  project: typeof registerProjectCommands;
  session: typeof registerSessionCommands;
  schema: typeof registerSchemaCommands;
};

const defaultRegistrars: CommandRegistrars = {
  status: registerStatusCommand,
  bootstrap: registerBootstrapCommand,
  capture: registerCaptureCommands,
  install: registerInstallCommands,
  ingest: registerIngestCommands,
  memory: registerMemoryCommands,
  maintenance: registerMaintenanceCommands,
  project: registerProjectCommands,
  session: registerSessionCommands,
  schema: registerSchemaCommands,
};

export function registerCommands(
  cli: Cli,
  context: LaunchContext,
  registrars: CommandRegistrars = defaultRegistrars,
): void {
  registrars.status(cli, { context });
  registrars.bootstrap(cli, { context });
  registrars.capture(cli, { context });
  registrars.install(cli, { context });
  registrars.ingest(cli, { context });
  registrars.memory(cli, { context });
  registrars.maintenance(cli, { context });
  registrars.project(cli, { context });
  registrars.session(cli, { context });
  registrars.schema(cli, { context });
}
