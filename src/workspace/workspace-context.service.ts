import { realpath, stat } from "node:fs/promises";
import { isAbsolute, relative, sep } from "node:path";

import type {
  CanonicalDirectoryPath,
  ProjectRegistration,
} from "../project/project-registration.ts";
import type { ProjectRegistrationRepository } from "../storage/sqlite/repositories/project-registration.repository.ts";
import type {
  GitBranchContext,
  WorkspaceContext,
} from "./workspace-context.ts";

export type WorkspaceContextInput = Readonly<{
  workingDirectory: string;
}>;

export type WorkspaceContextIgnoreReason = Readonly<{
  code: "workspace.unmanaged-project";
  safeDiagnostic: string;
}>;

export type WorkspaceContextFailure = Readonly<{
  code:
    | "workspace.invalid-working-directory"
    | "workspace.missing-working-directory"
    | "workspace.inaccessible-working-directory";
  safeDiagnostic: string;
}>;

export type WorkspaceContextResolution =
  | Readonly<{
      kind: "managed";
      context: WorkspaceContext;
    }>
  | Readonly<{
      kind: "unmanaged";
      reason: WorkspaceContextIgnoreReason;
    }>
  | Readonly<{
      kind: "failed";
      failure: WorkspaceContextFailure;
    }>;

type CanonicalWorkingDirectoryResult =
  | Readonly<{
      kind: "resolved";
      path: CanonicalDirectoryPath;
    }>
  | Readonly<{
      kind: "failed";
      failure: WorkspaceContextFailure;
    }>;

export class WorkspaceContextService {
  constructor(
    private readonly projectRegistrationRepository: ProjectRegistrationRepository,
  ) {}

  async resolve(
    input: WorkspaceContextInput,
  ): Promise<WorkspaceContextResolution> {
    const workingDirectoryResult = await canonicalizeWorkingDirectory(
      input.workingDirectory,
    );
    if (workingDirectoryResult.kind === "failed") {
      return workingDirectoryResult;
    }

    const registrations =
      await this.projectRegistrationRepository.listRegistrations();
    const project = selectMostSpecificProject(
      registrations,
      workingDirectoryResult.path,
    );

    if (!project) {
      return {
        kind: "unmanaged",
        reason: {
          code: "workspace.unmanaged-project",
          safeDiagnostic:
            "The working directory is not registered with LLM Wiki.",
        },
      };
    }

    const repositoryBranch = project.repositoryRootPath
      ? await observeRepositoryBranch(project.repositoryRootPath)
      : undefined;

    return {
      kind: "managed",
      context: repositoryBranch
        ? {
            project,
            workingDirectory: workingDirectoryResult.path,
            repositoryBranch,
          }
        : {
            project,
            workingDirectory: workingDirectoryResult.path,
          },
    };
  }
}

async function canonicalizeWorkingDirectory(
  workingDirectory: string,
): Promise<CanonicalWorkingDirectoryResult> {
  if (!workingDirectory || !isAbsolute(workingDirectory)) {
    return workingDirectoryFailure(
      "workspace.invalid-working-directory",
      "The working directory is invalid.",
    );
  }

  try {
    const canonicalPath = await realpath(workingDirectory);
    const directoryStat = await stat(canonicalPath);
    if (!directoryStat.isDirectory()) {
      return workingDirectoryFailure(
        "workspace.invalid-working-directory",
        "The working directory is not a directory.",
      );
    }

    return { kind: "resolved", path: canonicalPath };
  } catch (cause) {
    const errorCode = readErrorCode(cause);
    if (errorCode === "ENOENT" || errorCode === "ENOTDIR") {
      return workingDirectoryFailure(
        "workspace.missing-working-directory",
        "The working directory does not exist.",
      );
    }

    return workingDirectoryFailure(
      "workspace.inaccessible-working-directory",
      "The working directory is inaccessible.",
    );
  }
}

function workingDirectoryFailure(
  code: WorkspaceContextFailure["code"],
  safeDiagnostic: string,
): CanonicalWorkingDirectoryResult {
  return {
    kind: "failed",
    failure: { code, safeDiagnostic },
  };
}

function readErrorCode(cause: unknown): string | undefined {
  if (
    typeof cause !== "object" ||
    cause === null ||
    !("code" in cause) ||
    typeof cause.code !== "string"
  ) {
    return undefined;
  }

  return cause.code;
}

function selectMostSpecificProject(
  registrations: readonly ProjectRegistration[],
  workingDirectory: CanonicalDirectoryPath,
): ProjectRegistration | undefined {
  let selected: ProjectRegistration | undefined;

  for (const registration of registrations) {
    if (
      containsDirectory(registration.rootPath, workingDirectory) &&
      (!selected || registration.rootPath.length > selected.rootPath.length)
    ) {
      selected = registration;
    }
  }

  return selected;
}

function containsDirectory(
  rootPath: CanonicalDirectoryPath,
  directoryPath: CanonicalDirectoryPath,
): boolean {
  const relativePath = relative(rootPath, directoryPath);
  return (
    relativePath === "" ||
    (relativePath !== ".." &&
      !relativePath.startsWith(`..${sep}`) &&
      !isAbsolute(relativePath))
  );
}

async function observeRepositoryBranch(
  repositoryRootPath: CanonicalDirectoryPath,
): Promise<GitBranchContext> {
  try {
    const process = Bun.spawn(
      ["git", "-C", repositoryRootPath, "branch", "--show-current"],
      {
        stdout: "pipe",
        stderr: "ignore",
      },
    );
    const branchName = (await new Response(process.stdout).text()).trim();
    const exitCode = await process.exited;

    if (exitCode === 0 && branchName) {
      return { kind: "active", name: branchName };
    }
  } catch {
    // Branch observation degrades to an unavailable result.
  }

  return {
    kind: "unavailable",
    safeDiagnostic: "The active Git branch is unavailable.",
  };
}
