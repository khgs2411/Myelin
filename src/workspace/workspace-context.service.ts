import { realpath, stat } from "node:fs/promises";
import { isAbsolute, relative, sep } from "node:path";

import type {
  CanonicalDirectoryPath,
  ProjectRegistration,
} from "../project/project-registration.ts";
import type { ProjectRegistrationRepository } from "../storage/sqlite/repositories/project-registration.repository.ts";
import type {
  GitContext,
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
  public constructor(
    private readonly projectRegistrationRepository: ProjectRegistrationRepository,
  ) {}

  public async resolve(
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

    const git = project.repositoryRootPath
      ? await observeGitContext(project.repositoryRootPath)
      : undefined;

    return {
      kind: "managed",
      context: git
        ? {
            project,
            workingDirectory: workingDirectoryResult.path,
            git,
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

async function observeGitContext(
  repositoryRootPath: CanonicalDirectoryPath,
): Promise<GitContext> {
  try {
    await readGit(repositoryRootPath, ["rev-parse", "--git-dir"]);
    const branch = await readGit(
      repositoryRootPath,
      ["symbolic-ref", "--quiet", "HEAD"],
      [0, 1],
    );
    const branchReference = branch.exitCode === 0 ? branch.output : null;
    const branchName = branchReference?.replace(/^refs\/heads\//, "") ?? null;
    const headCommitId = await readCommit(
      repositoryRootPath,
      branchReference ?? "HEAD",
    );
    // A missing symbolic branch is unborn. A missing detached HEAD is a failure.
    if (branchReference === null && headCommitId === null) {
      throw new Error("The detached HEAD commit is unavailable.");
    }
    const upstreamReference =
      branchName === null
        ? null
        : await readUpstreamReference(repositoryRootPath, branchName);
    const upstream =
      upstreamReference === null
        ? null
        : {
            reference: upstreamReference.replace(/^refs\/(heads|remotes|tags)\//, ""),
            commitId: await readCommit(repositoryRootPath, upstreamReference),
          };
    return { kind: "observed", branchName, headCommitId, upstream };
  } catch {
    return {
      kind: "unavailable",
      safeDiagnostic: "The Git context is unavailable.",
    };
  }
}

async function readCommit(
  repositoryRootPath: CanonicalDirectoryPath,
  reference: string,
): Promise<string | null> {
  const exists = await readGit(
    repositoryRootPath,
    ["show-ref", "--exists", reference],
    [0, 2],
  );
  if (exists.exitCode === 2) return null;
  // An existing ref with an unreadable commit is not an absent commit.
  const commit = await readGit(repositoryRootPath, [
    "rev-parse", "--verify", "--end-of-options", `${reference}^{commit}`,
  ]);
  return commit.output;
}

async function readUpstreamReference(
  repositoryRootPath: CanonicalDirectoryPath,
  branchName: string,
): Promise<string | null> {
  const remote = await readGit(
    repositoryRootPath,
    ["config", "--get", `branch.${branchName}.remote`],
    [0, 1],
  );
  const merge = await readGit(
    repositoryRootPath,
    ["config", "--get-all", `branch.${branchName}.merge`],
    [0, 1],
  );
  if (remote.exitCode === 1 || merge.exitCode === 1) return null;
  const mergeReference = merge.output.split("\n")[0]!;
  if (remote.output === ".") return mergeReference;

  // Read configuration even for an unborn branch or a missing tracking ref.
  const fetch = await readGit(repositoryRootPath, [
    "config", "--get-all", `remote.${remote.output}.fetch`,
  ]);
  for (const refspec of fetch.output.split("\n")) {
    if (refspec.startsWith("^")) continue;
    const [source, destination] = refspec.replace(/^\+/, "").split(":");
    if (!source || !destination) continue;
    const wildcard = source.indexOf("*");
    if (wildcard === -1) {
      if (source === mergeReference) return destination;
      continue;
    }
    const prefix = source.slice(0, wildcard);
    const suffix = source.slice(wildcard + 1);
    if (
      mergeReference.startsWith(prefix) &&
      mergeReference.endsWith(suffix) &&
      mergeReference.length >= prefix.length + suffix.length
    ) {
      return destination.replace(
        "*",
        mergeReference.slice(prefix.length, mergeReference.length - suffix.length),
      );
    }
  }
  throw new Error("The configured upstream reference is unavailable.");
}

async function readGit(
  repositoryRootPath: CanonicalDirectoryPath,
  arguments_: readonly string[],
  acceptedExitCodes: readonly number[] = [0],
): Promise<Readonly<{ output: string; exitCode: number }>> {
  const process = Bun.spawn(["git", "-C", repositoryRootPath, ...arguments_], {
    stdin: "ignore",
    stdout: "pipe",
    stderr: "ignore",
  });
  const [output, exitCode] = await Promise.all([
    new Response(process.stdout).text(), process.exited,
  ]);
  if (!acceptedExitCodes.includes(exitCode)) {
    throw new Error("Git observation failed.");
  }
  return { output: output.trim(), exitCode };
}
