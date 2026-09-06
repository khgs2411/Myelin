import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdir, symlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { WorkspaceContextService } from "../../src/workspace/workspace-context.service.ts";
import type { ProjectRegistration } from "../../src/project/project-registration.ts";
import { TemporaryGit } from "../support/temporary-git.ts";

let fixture: TemporaryGit;
let repository: string;
let oldEnvironment: NodeJS.ProcessEnv;

beforeEach(async () => {
  fixture = await TemporaryGit.Create();
  repository = await fixture.repository();
  oldEnvironment = { ...process.env };
  // Observation uses the real subprocess boundary with isolated Git configuration.
  for (const key of Object.keys(process.env)) if (key.startsWith("GIT_")) delete process.env[key];
  for (const [key, value] of Object.entries(fixture.environment)) if (value !== undefined) process.env[key] = value;
});
afterEach(async () => {
  for (const key of Object.keys(process.env)) if (!(key in oldEnvironment)) delete process.env[key];
  Object.assign(process.env, oldEnvironment);
  await fixture.close();
});

function service(registrations: readonly ProjectRegistration[]) {
  return new WorkspaceContextService({ async listRegistrations() { return registrations; } });
}
async function observe(repositoryRootPath: string | undefined = repository) {
  const result = await service([{ identity: 1, key: "project", rootPath: repository, repositoryRootPath }])
    .resolve({ workingDirectory: repository });
  expect(result.kind).toBe("managed");
  if (result.kind !== "managed") throw new Error("Expected managed Project");
  return result.context;
}

async function configureUpstream(destination = "refs/remotes/team/*") {
  await fixture.run(repository, "config", "remote.team.url", join(fixture.root, "unused-remote"));
  await fixture.run(repository, "config", "remote.team.fetch", `+refs/heads/*:${destination}`);
  await fixture.run(repository, "config", "branch.master.remote", "team");
  await fixture.run(repository, "config", "branch.master.merge", "refs/heads/review");
}

describe("registered workspace and local Git observation", () => {
  test("canonicalizes symbolic links before matching ownership", async () => {
    const linked = join(fixture.root, "alias");
    await symlink(repository, linked);
    const resolution = await service([{ identity: 1, key: "project", rootPath: repository }]).resolve({ workingDirectory: linked });
    expect(resolution).toMatchObject({ kind: "managed", context: { workingDirectory: repository, project: { identity: 1 } } });
  });

  test("most-specific ownership does not depend on registration order", async () => {
    const nested = join(repository, "nested"); await mkdir(nested);
    const outer = { identity: 1, key: "outer", rootPath: repository };
    const inner = { identity: 2, key: "inner", rootPath: nested };
    for (const registrations of [[outer, inner], [inner, outer]]) {
      expect(await service(registrations).resolve({ workingDirectory: nested })).toMatchObject({ kind: "managed", context: { project: inner } });
    }
  });

  test("maps inaccessible canonicalization to its failure code", async () => {
    const loop = join(fixture.root, "inaccessible");
    await symlink(loop, loop);
    // ELOOP is deterministic even when permission-bit tests run as an administrator.
    expect(await service([]).resolve({ workingDirectory: loop })).toMatchObject({ kind: "failed", failure: { code: "workspace.inaccessible-working-directory" } });
  });

  test("an unregistered directory stays unmanaged without registration writes", async () => {
    const registrations: ProjectRegistration[] = [];
    expect(await service(registrations).resolve({ workingDirectory: repository })).toMatchObject({ kind: "unmanaged" });
    expect(registrations).toEqual([]);
  });

  test("a registration without a repository has no Git context", async () => {
    const result = await service([{ identity: 1, key: "project", rootPath: repository }]).resolve({ workingDirectory: repository });
    expect(result).toEqual({ kind: "managed", context: { project: { identity: 1, key: "project", rootPath: repository }, workingDirectory: repository } });
  });

  test("observes an unborn branch and preserves a configured missing upstream", async () => {
    expect((await observe()).git).toEqual({ kind: "observed", branchName: "master", headCommitId: null, upstream: null });
    await configureUpstream();
    expect((await observe()).git).toEqual({ kind: "observed", branchName: "master", headCommitId: null, upstream: { reference: "team/review", commitId: null } });
  });

  test("observes normal and detached HEAD without mutating an earlier snapshot", async () => {
    const head = await fixture.commit(repository, "first");
    const first = await observe();
    expect(first.git).toEqual({ kind: "observed", branchName: "master", headCommitId: head, upstream: null });
    await fixture.run(repository, "checkout", "--detach", head);
    expect((await observe()).git).toEqual({ kind: "observed", branchName: null, headCommitId: head, upstream: null });
    expect(first.git).toEqual({ kind: "observed", branchName: "master", headCommitId: head, upstream: null });
  });

  test("uses a custom remote mapping and distinguishes an absent tracking commit", async () => {
    const head = await fixture.commit(repository, "first");
    await configureUpstream("refs/remotes/custom/*");
    expect((await observe()).git).toMatchObject({ upstream: { reference: "custom/review", commitId: null } });
    await fixture.run(repository, "update-ref", "refs/remotes/custom/review", head);
    expect((await observe()).git).toMatchObject({ headCommitId: head, upstream: { reference: "custom/review", commitId: head } });
  });

  test("supports an exact fetch mapping and a local branch upstream", async () => {
    const head = await fixture.commit(repository, "first");
    await configureUpstream();
    await fixture.run(repository, "config", "remote.team.fetch", "+refs/heads/review:refs/remotes/team/exact");
    await fixture.run(repository, "update-ref", "refs/remotes/team/exact", head);
    expect((await observe()).git).toMatchObject({ upstream: { reference: "team/exact", commitId: head } });
    await fixture.run(repository, "config", "branch.master.remote", ".");
    await fixture.run(repository, "config", "branch.master.merge", "refs/heads/master");
    expect((await observe()).git).toMatchObject({ upstream: { reference: "master", commitId: head } });
  });

  test("never fetches a newer commit from its configured remote", async () => {
    const remote = await fixture.repository("remote");
    const old = await fixture.commit(remote, "old");
    await fixture.run(repository, "remote", "add", "team", remote);
    await fixture.run(repository, "fetch", "team");
    await fixture.commit(repository, "local");
    await fixture.run(repository, "branch", "--set-upstream-to=team/master", "master");
    const currentRemote = await fixture.commit(remote, "new");
    expect(currentRemote).not.toBe(old);
    expect((await observe()).git).toMatchObject({ upstream: { reference: "team/master", commitId: old } });
    expect(await fixture.run(repository, "rev-parse", "refs/remotes/team/master")).toBe(old);
  });

  test("unavailable repository observation does not revoke Project ownership", async () => {
    expect((await observe(join(fixture.root, "missing"))).git).toMatchObject({ kind: "unavailable", safeDiagnostic: "The Git context is unavailable." });
  });

  test("an existing ref with unreadable commit data is unavailable, not unborn", async () => {
    await fixture.commit(repository, "first");
    await writeFile(join(repository, ".git", "refs", "heads", "master"), `${"1".repeat(40)}\n`);
    expect((await observe()).git).toMatchObject({ kind: "unavailable" });
  });
});
