import { afterEach, describe, expect, mock, spyOn, test } from "bun:test";
import { ApplicationError } from "../../src/application-error.ts";
import type { CaptureResult } from "../../src/capture/capture-adapter.ts";
import { EvidenceCaptureService } from "../../src/capture/evidence-capture.service.ts";
import type { CapturedEvidenceReference } from "../../src/evidence/captured-evidence-reference.ts";
import type { EvidenceItemDto } from "../../src/evidence/evidence-item.dto.ts";
import { ProjectRegistrationRepository } from "../../src/storage/sqlite/repositories/project-registration.repository.ts";
import { WorkspaceContextService, type WorkspaceContextResolution } from "../../src/workspace/workspace-context.service.ts";
import type { WorkspaceContext } from "../../src/workspace/workspace-context.ts";

afterEach(() => mock.restore());

function result(index: number): CaptureResult {
  return {
    nativeEventKind: "fixture.input",
    nativeSessionReference: "session",
    nativeInteractionReference: String(index),
    nativeOccurredAt: "2026-09-05T00:00:00.000Z",
    normalizedContent: `value ${index}`,
    workingDirectory: `/project/${index}`,
    replay: { scheme: "fixture/v1", key: String(index) },
    sourceMaterial: { format: "bytes.v1", content: new Uint8Array([index, 0, 255]) },
  };
}

function context(index: number, identity = 1): WorkspaceContext {
  return {
    project: { identity, key: `project-${identity}`, rootPath: "/project" },
    workingDirectory: `/project/${index}`,
    git: { kind: "observed", branchName: `branch-${index}`, headCommitId: null, upstream: null },
  };
}

function setup(resolve: (directory: string) => Promise<WorkspaceContextResolution>) {
  const workspace = new WorkspaceContextService(new ProjectRegistrationRepository());
  spyOn(workspace, "resolve").mockImplementation(({ workingDirectory }) => resolve(workingDirectory));
  const receipt: readonly CapturedEvidenceReference[] = [
    { evidenceId: 15, projectSequence: 8, disposition: "inserted" },
    { evidenceId: 4, projectSequence: 2, disposition: "existing" },
  ];
  const insertBatch = mock(async (_items: readonly EvidenceItemDto[]) => receipt);
  return { service: new EvidenceCaptureService(workspace, { insertBatch }), insertBatch, receipt };
}

describe("EvidenceCaptureService batch contract", () => {
  test("preserves ordered source facts and distinct snapshots for one Project", async () => {
    const inputs = [result(1), result(2)];
    const contexts = [context(1), context(2)];
    const run = setup(async (directory) => ({ kind: "managed", context: contexts[Number(directory.slice(-1)) - 1]! }));
    const receipt = await run.service.captureBatch({ sourceKey: "trusted.route", results: inputs });
    expect(run.insertBatch).toHaveBeenCalledTimes(1);
    expect(run.insertBatch.mock.calls[0]![0]).toEqual(inputs.map(({ workingDirectory: _directory, ...facts }, index) => ({
      captureSourceKey: "trusted.route", workspaceContext: contexts[index]!, ...facts,
    })));
    expect(receipt).toEqual(run.receipt);
  });

  test("rejects an empty batch before persistence", async () => {
    const run = setup(async () => { throw new Error("Resolver must not be needed"); });
    await expect(run.service.captureBatch({ sourceKey: "route", results: [] })).rejects.toMatchObject({ code: "capture:invalid-input" });
    expect(run.insertBatch).not.toHaveBeenCalled();
  });

  test.each([
    { resolution: { kind: "unmanaged", reason: { code: "workspace.unmanaged-project", safeDiagnostic: "Unmanaged" } }, code: "capture:unmanaged-workspace" },
    { resolution: { kind: "failed", failure: { code: "workspace.missing-working-directory", safeDiagnostic: "Missing" } }, code: "capture:failed" },
    { resolution: { kind: "managed", context: context(2, 2) }, code: "capture:mixed-project-batch" },
  ] as const)("rejects a later invalid resolution: $code", async ({ resolution, code }) => {
    const run = setup(async (directory) => directory === "/project/1" ? { kind: "managed", context: context(1) } : resolution);
    const operation = run.service.captureBatch({ sourceKey: "route", results: [result(1), result(2)] });
    await expect(operation).rejects.toMatchObject({ code });
    if (resolution.kind === "failed") {
      await expect(operation).rejects.toMatchObject({ cause: resolution.failure });
    }
    expect(run.insertBatch).not.toHaveBeenCalled();
  });

  test("an unexpected resolver rejection prevents all persistence", async () => {
    const cause = new Error("Resolver failed");
    const run = setup(async (directory) => {
      if (directory === "/project/2") throw cause;
      return { kind: "managed", context: context(1) };
    });
    await expect(run.service.captureBatch({ sourceKey: "route", results: [result(1), result(2)] })).rejects.toBe(cause);
    expect(run.insertBatch).not.toHaveBeenCalled();
  });

  test("does not persist while a later resolution is pending", async () => {
    const pending = Promise.withResolvers<WorkspaceContextResolution>();
    const entered = Promise.withResolvers<void>();
    const run = setup(async (directory) => {
      if (directory === "/project/2") { entered.resolve(); return pending.promise; }
      return { kind: "managed", context: context(1) };
    });
    const operation = run.service.captureBatch({ sourceKey: "route", results: [result(1), result(2)] });
    await entered.promise;
    expect(run.insertBatch).not.toHaveBeenCalled();
    pending.resolve({ kind: "managed", context: context(2) });
    await expect(operation).resolves.toEqual(run.receipt);
    expect(run.insertBatch.mock.calls[0]![0]).toHaveLength(2);
  });

  test("propagates persistence rejection without returning a receipt", async () => {
    const run = setup(async () => ({ kind: "managed", context: context(1) }));
    const conflict = new ApplicationError("capture:replay-conflict");
    run.insertBatch.mockRejectedValueOnce(conflict);
    await expect(run.service.captureBatch({ sourceKey: "route", results: [result(1)] })).rejects.toBe(conflict);
  });
});
