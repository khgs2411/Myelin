# `src/storage/sqlite/repositories/project-registration.repository.ts`

> Pseudocode artifact. Non-executable reference shape.

Intended destination:
`src/storage/sqlite/repositories/project-registration.repository.ts`

`ProjectRegistrationRepository` is the read boundary between Sequelize
`Project` models and immutable application registration values. It becomes
usable only after `SqliteDatabase.open()` initializes the registered models.

```ts
// intentionally illustrative pseudocode

type ProjectRegistration = imported immutable application value

class ProjectRegistrationRepository {
  async listRegistrations(): Promise<readonly ProjectRegistration[]> {
    projectModels = await Project.findAll()

    return projectModels mapped to immutable ProjectRegistration values:
      identity = projectModel.id
      key = projectModel.key
      rootPath = projectModel.rootPath
      repositoryRootPath = projectModel.repositoryRootPath when present
  }
}
```

## Read boundary

The repository performs one durable read and maps every returned row before it
crosses into workspace resolution. A nullable Sequelize
`repositoryRootPath` becomes an absent optional application value.

The repository does not accept a working directory. It does not canonicalize
paths, decide workspace membership, select the most specific root, or inspect
Git. Those responsibilities belong to `WorkspaceContextService`.

## Mutation boundary

This owner does not create, update, relocate, repair, or delete Project rows.
The development seed remains the only current Project-registration writer.

The repository does not retain or return Sequelize model instances. It relies
on Application composition to construct and use it only while its
process-scoped `SqliteDatabase` is open.
