import { Application } from "../../src/application.ts";
import { ApplicationError } from "../../src/application-error.ts";
import { EvidenceItemRepository } from "../../src/evidence/evidence-item.repository.ts";
import { SqliteRuntime } from "../../src/storage/sqlite/sqlite-runtime.ts";
import { runCli } from "../../cli.ts";

export type CaptureProcessInput = {
  mode: "application" | "cli";
  databasePath: string;
  inputs?: readonly unknown[];
  sourceKey?: string;
  args?: string[];
  fault?: "repository" | "startup" | "output" | "cleanup";
  readyPath?: string;
  gatePath?: string;
};

// Test-only process entry. Faults affect only this process and never add
// switches or dependencies to the production CLI.
if (import.meta.main) {
  const input: CaptureProcessInput = JSON.parse(await Bun.stdin.text());
  const privateCause = new Error("PRIVATE_FAILURE_SENTINEL");
  if (input.fault === "repository") {
    EvidenceItemRepository.prototype.insertBatch = async () => { throw privateCause; };
  }
  if (input.fault === "startup") {
    SqliteRuntime.initialize = async () => { throw privateCause; };
  }
  if (input.fault === "cleanup") {
    const close = Application.prototype.close;
    Application.prototype.close = async function () { await close.call(this); throw privateCause; };
  }
  if (input.fault === "output") {
    const write = Bun.write;
    Bun.write = async (destination, data, options) => {
      if (destination === Bun.stdout) throw privateCause;
      return Reflect.apply(write, Bun, [destination, data, options]);
    };
  }

  if (input.mode === "cli") {
    process.exitCode = await runCli(input.args ?? [], { sqlite: { databasePath: input.databasePath } });
  } else {
    let app: Application | undefined;
    try {
      app = await Application.create({ sqlite: { databasePath: input.databasePath } });
      if (input.readyPath && input.gatePath) {
        await Bun.write(input.readyPath, "ready");
        const deadline = Date.now() + 10_000;
        while (!(await Bun.file(input.gatePath).exists())) {
          if (Date.now() > deadline) throw new Error("Test writer gate timed out");
          await Bun.sleep(10);
        }
      }
      const receipt = await app.capture({ sourceKey: input.sourceKey ?? "development.fixture", nativeInputs: input.inputs ?? [] });
      process.stdout.write(JSON.stringify({ ok: true, receipt }) + "\n");
    } catch (error) {
      const cause = error instanceof Error ? error.cause : undefined;
      process.stdout.write(JSON.stringify({
        ok: false,
        code: error instanceof ApplicationError ? error.code : undefined,
        causeMessage: cause instanceof Error ? cause.message : undefined,
        causeName: cause instanceof Error ? cause.name : undefined,
      }) + "\n");
      process.exitCode = 1;
    } finally {
      await app?.close();
    }
  }
}
