import { bootstrapProject, type BootstrapResult } from "../runtime/bootstrap.ts";

export type BootstrapProjectInput = {
  projectKey: string;
  repoPath: string;
};

export class BootstrapService {
  constructor(private readonly root: string) {}

  async bootstrap(input: BootstrapProjectInput): Promise<BootstrapResult> {
    return bootstrapProject(this.root, input.projectKey, input.repoPath);
  }
}
