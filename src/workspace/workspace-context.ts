import type {
  CanonicalDirectoryPath,
  ProjectRegistration,
} from "../project/project-registration.ts";

export type GitBranchContext =
  | Readonly<{
      kind: "active";
      name: string;
    }>
  | Readonly<{
      kind: "unavailable";
      safeDiagnostic: string;
    }>;

export type WorkspaceContext = Readonly<{
  project: ProjectRegistration;
  workingDirectory: CanonicalDirectoryPath;
  repositoryBranch?: GitBranchContext;
}>;
