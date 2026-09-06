import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtemp, mkdir, realpath, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

import type { ProjectRegistration } from "../../src/project/project-registration.ts";
import type { ProjectRegistrationRepository } from "../../src/storage/sqlite/repositories/project-registration.repository.ts";
import type { WorkspaceContext } from "../../src/workspace/workspace-context.ts";
import {
  WorkspaceContextService,
  type WorkspaceContextResolution,
} from "../../src/workspace/workspace-context.service.ts";

let temporaryDirectory: string;

beforeEach(async () => {
  temporaryDirectory = await mkdtemp(
    join(tmpdir(), "llm-wiki-workspace-context-"),
  );
});

afterEach(async () => {
  await rm(temporaryDirectory, { recursive: true, force: true });
});

describe("WorkspaceContextService", () => {
  test("resolves an exact registered project root", async () => {
    const rootPath = await realpath(temporaryDirectory);
    const project = registration({ identity: 1, key: "exact", rootPath });

    const context = await resolveManaged([project], rootPath);

    expect(context).toEqual({ project, workingDirectory: rootPath });
    expect(context).not.toHaveProperty("git");
  });

  test("keeps a descendant working directory distinct from its project root", async () => {
    const rootPath = await realpath(temporaryDirectory);
    const descendant = join(rootPath, "src", "feature");
    await mkdir(descendant, { recursive: true });
    const project = registration({ identity: 1, key: "parent", rootPath });

    const context = await resolveManaged([project], descendant);

    expect(context.project).toEqual(project);
    expect(context.workingDirectory).toBe(await realpath(descendant));
    expect(context.workingDirectory).not.toBe(rootPath);
  });

  test("selects the most specific registration for overlapping roots", async () => {
    const rootPath = await realpath(temporaryDirectory);
    const nestedRoot = join(rootPath, "nested");
    const workingDirectory = join(nestedRoot, "src");
    await mkdir(workingDirectory, { recursive: true });
    const parent = registration({ identity: 1, key: "parent", rootPath });
    const nested = registration({
      identity: 2,
      key: "nested",
      rootPath: await realpath(nestedRoot),
    });

    const context = await resolveManaged([parent, nested], workingDirectory);

    expect(context.project).toEqual(nested);
  });

  test("does not match a similar string prefix outside a registered root", async () => {
    const rootPath = join(temporaryDirectory, "project");
    const similarPath = join(temporaryDirectory, "project-copy");
    await Promise.all([mkdir(rootPath), mkdir(similarPath)]);

    const resolution = await service([
      registration({
        identity: 1,
        key: "project",
        rootPath: await realpath(rootPath),
      }),
    ]).resolve({ workingDirectory: similarPath });

    expect(resolution).toEqual({
      kind: "unmanaged",
      reason: {
        code: "workspace.unmanaged-project",
        safeDiagnostic:
          "The working directory is not registered with LLM Wiki.",
      },
    });
  });

  test("rejects relative, missing, and non-directory inputs", async () => {
    const filePath = join(temporaryDirectory, "file.txt");
    await writeFile(filePath, "not a directory");
    const workspaceContextService = service([]);

    const relative = await workspaceContextService.resolve({
      workingDirectory: "relative/path",
    });
    const missing = await workspaceContextService.resolve({
      workingDirectory: join(temporaryDirectory, "missing"),
    });
    const file = await workspaceContextService.resolve({
      workingDirectory: filePath,
    });

    expectFailure(relative, "workspace.invalid-working-directory");
    expectFailure(missing, "workspace.missing-working-directory");
    expectFailure(file, "workspace.invalid-working-directory");
  });
});

function registration(
  value: ProjectRegistration,
): ProjectRegistration {
  return value;
}

function service(
  registrations: readonly ProjectRegistration[],
): WorkspaceContextService {
  const repository: ProjectRegistrationRepository = {
    async listRegistrations() {
      return registrations;
    },
  };

  return new WorkspaceContextService(repository);
}

async function resolveManaged(
  registrations: readonly ProjectRegistration[],
  workingDirectory: string,
): Promise<WorkspaceContext> {
  const resolution = await service(registrations).resolve({ workingDirectory });
  if (resolution.kind !== "managed") {
    throw new Error(`Expected a managed resolution, received ${resolution.kind}.`);
  }

  return resolution.context;
}

function expectFailure(
  resolution: WorkspaceContextResolution,
  code:
    | "workspace.invalid-working-directory"
    | "workspace.missing-working-directory"
    | "workspace.inaccessible-working-directory",
): void {
  expect(resolution.kind).toBe("failed");
  if (resolution.kind !== "failed") {
    throw new Error(`Expected a failed resolution, received ${resolution.kind}.`);
  }

  expect(resolution.failure.code).toBe(code);
}
