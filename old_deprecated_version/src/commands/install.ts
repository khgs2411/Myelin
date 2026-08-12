import { InstallService } from "../install/install-service.ts";
import type { InstallServiceDeps } from "../install/types.ts";
import type { MachineInstallPlan } from "../install/types.ts";
import type { LaunchContext } from "../runtime/launch-context.ts";
import type { Cli } from "./registry.ts";
import { fail, ok } from "./registry.ts";

export type InstallCommandDeps = {
  context: LaunchContext;
  service?: Omit<InstallServiceDeps, "myelinRoot">;
};

type ParsedInstallArgs = {
  apply: boolean;
  rebind: boolean;
  binDir: string | null;
  commandOnly: boolean;
  providers: string[];
  prune: boolean;
  rollback: boolean;
  error?: string;
};

export function registerInstallCommands(cli: Cli, deps: InstallCommandDeps): void {
  cli.command(["install"], async (args) => {
    const parsed = parseArgs(args, "install");
    if (parsed.error) return fail(parsed.error);
    try {
      const result = await service(deps).install(parsed);
      return ok(render(result.plan));
    } catch (error) {
      return fail(error instanceof Error ? error.message : String(error));
    }
  });

  cli.command(["uninstall"], async (args) => {
    const parsed = parseArgs(args, "uninstall");
    if (parsed.error) return fail(parsed.error);
    try {
      const result = await service(deps).uninstall({ apply: parsed.apply, providers: parsed.providers });
      return ok(render(result.plan));
    } catch (error) {
      return fail(error instanceof Error ? error.message : String(error));
    }
  });
}

function parseArgs(args: string[], command: "install" | "uninstall"): ParsedInstallArgs {
  const parsed: ParsedInstallArgs = {
    apply: false,
    rebind: false,
    binDir: null,
    commandOnly: false,
    providers: [],
    prune: false,
    rollback: false,
  };
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === "--apply") parsed.apply = true;
    else if (arg === "--rebind") parsed.rebind = true;
    else if (arg === "--command-only") parsed.commandOnly = true;
    else if (arg === "--prune") parsed.prune = true;
    else if (arg === "--rollback") parsed.rollback = true;
    else if (arg === "--bin-dir") {
      const value = args[++index];
      if (!value || value.startsWith("--")) return { ...parsed, error: "--bin-dir requires a value" };
      parsed.binDir = value;
    } else if (arg === "--provider") {
      const value = args[++index];
      if (!value || value.startsWith("--")) return { ...parsed, error: "--provider requires a value" };
      parsed.providers.push(value);
    } else return { ...parsed, error: `Unknown ${command} option: ${arg}` };
  }
  if (command === "uninstall" && (parsed.rebind || parsed.commandOnly || parsed.binDir || parsed.prune || parsed.rollback)) {
    return { ...parsed, error: "uninstall accepts only --apply and --provider <name>" };
  }
  if (parsed.commandOnly && parsed.providers.length > 0) {
    return { ...parsed, error: "--command-only cannot be combined with --provider" };
  }
  if (parsed.rollback && (parsed.rebind || parsed.commandOnly || parsed.binDir || parsed.prune || parsed.providers.length > 0)) {
    return { ...parsed, error: "--rollback can only be combined with --apply" };
  }
  return parsed;
}

function render(plan: MachineInstallPlan): string {
  return [
    `Operation: ${plan.operation}`,
    `Mode: ${plan.mode}`,
    `Myelin root: ${plan.myelin_root}`,
    `Launcher: ${plan.launcher_path}`,
    `Locator: ${plan.locator_path}`,
    `Version store: ${plan.store_root}`,
    plan.active_version ? `Active version: ${plan.active_version}` : "",
    plan.previous_version ? `Previous version: ${plan.previous_version}` : "",
    `PATH active: ${plan.path_active ? "yes" : "no"}`,
    plan.rebind ? `Rebind: ${plan.current_root} -> ${plan.myelin_root}` : "",
    ...plan.actions.map((item) => `- ${item.description}: ${item.path}`),
    ...plan.warnings.map((warning) => `Warning: ${warning}`),
  ].filter(Boolean).join("\n");
}

function service(deps: InstallCommandDeps): InstallService {
  return new InstallService({
    myelinRoot: deps.context.myelinRoot,
    sourceRoot: deps.context.runtimeRoot ?? deps.context.myelinRoot,
    ...deps.service,
  });
}
