import type {
  CanonicalDirectoryPath,
  ProjectRegistration,
} from "../project/project-registration.ts";

export type GitContext =
  | Readonly<{
      kind: "observed";
      branchName: string | null;
      headCommitId: string | null;
      upstream: Readonly<{
        reference: string;
        commitId: string | null;
      }> | null;
    }>
  | Readonly<{
      kind: "unavailable";
      safeDiagnostic: string;
    }>;

export type WorkspaceContext = Readonly<{
  project: ProjectRegistration;
  workingDirectory: CanonicalDirectoryPath;
  git?: GitContext;
}>;
