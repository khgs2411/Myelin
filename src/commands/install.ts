import { InstallService } from "../install/install-service.ts";
import type { ProviderInstallPlan } from "../install/types.ts";
import { repoRoot } from "../runtime/fs.ts";
import type { Cli } from "./registry.ts";
import { fail, ok } from "./registry.ts";

export type InstallCommandDeps = {
  myelinRoot?: string;
  codexRoot?: string;
  isInteractive?: boolean;
  detectedProviders?: string[];
};

type ParsedInstallArgs = {
  apply: boolean;
  provider: string | null;
  error?: string;
};

export function registerInstallCommands(cli: Cli, deps: InstallCommandDeps = {}): void {
  cli.command(["install"], async (args) => {
    const parsed = parseInstallArgs(args);
    if (parsed.error) return fail(parsed.error);

    try {
      const result = await service(deps).install(parsed);
      return ok(render("install", result.mode, result.plan));
    } catch (error) {
      return fail(error instanceof Error ? error.message : String(error));
    }
  });

  cli.command(["uninstall"], async (args) => {
    const parsed = parseInstallArgs(args);
    if (parsed.error) return fail(parsed.error);
    if (parsed.apply) return fail("uninstall does not accept --apply");

    try {
      const result = await service(deps).uninstall(parsed.provider);
      return ok(render("uninstall", result.mode, result.plan));
    } catch (error) {
      return fail(error instanceof Error ? error.message : String(error));
    }
  });
}

function parseInstallArgs(args: string[]): ParsedInstallArgs {
  let apply = false;
  let provider: string | null = null;

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === "--apply") {
      apply = true;
    } else if (arg === "--provider") {
      const value = args[index + 1];
      if (!value || value.startsWith("--")) return { apply, provider, error: "--provider requires a value" };
      provider = value;
      index += 1;
    } else {
      return { apply, provider, error: `Unknown install option: ${arg}` };
    }
  }

  return { apply, provider };
}

function render(command: string, mode: string, plan: ProviderInstallPlan): string {
  return [
    `Command: ${command}`,
    `Provider: ${plan.provider}`,
    `Mode: ${mode}`,
    `Detected: ${plan.detected}`,
    `Provider root: ${plan.provider_root}`,
    `Hooks path: ${plan.hooks_path}`,
    ...plan.actions.map((action) => `- ${action}`),
    ...plan.warnings.map((warning) => `Warning: ${warning}`),
  ].join("\n");
}

function service(deps: InstallCommandDeps): InstallService {
  return new InstallService({
    myelinRoot: deps.myelinRoot ?? repoRoot().root,
    codexRoot: deps.codexRoot,
    isInteractive: deps.isInteractive,
    detectedProviders: deps.detectedProviders,
  });
}
