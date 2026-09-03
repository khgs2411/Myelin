import type { ProjectRegistration } from "../../../project/project-registration.ts";
import { Project } from "../models/project.model.ts";

export class ProjectRegistrationRepository {
  async listRegistrations(): Promise<readonly ProjectRegistration[]> {
    const projects = await Project.findAll();

    return projects.map((project) => ({
      identity: project.id,
      key: project.key,
      rootPath: project.rootPath,
      ...(project.repositoryRootPath === null
        ? {}
        : { repositoryRootPath: project.repositoryRootPath }),
    }));
  }
}
