export type ProjectIdentity = number;
export type ProjectKey = string;
export type CanonicalDirectoryPath = string;

export type ProjectRegistration = Readonly<{
  identity: ProjectIdentity;
  key: ProjectKey;
  rootPath: CanonicalDirectoryPath;
  repositoryRootPath?: CanonicalDirectoryPath;
}>;
