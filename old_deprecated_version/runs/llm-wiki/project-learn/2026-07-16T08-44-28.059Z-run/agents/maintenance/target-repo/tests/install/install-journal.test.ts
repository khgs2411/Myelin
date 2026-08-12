import { afterEach, expect, test } from "bun:test";
import { mkdtemp, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  createInstallJournal,
  markInstallActionComplete,
  parseInstallJournal,
  readInstallJournalIfExists,
  removeInstallJournal,
  writeInstallJournal,
} from "../../src/install/install-journal.ts";

let sandbox: string | null = null;

afterEach(async () => {
  if (sandbox) await rm(sandbox, { recursive: true, force: true });
  sandbox = null;
});

test("install journal persists action state privately and is removed after completion", async () => {
  sandbox = await mkdtemp(join(tmpdir(), "myelin-journal-"));
  const path = join(sandbox, ".myelin", "install-journal.json");
  const journal = createInstallJournal({
    transactionId: "txn-1",
    operation: "uninstall",
    myelinRoot: join(sandbox, "checkout"),
    launcherPath: join(sandbox, "bin", "myelin"),
    locatorPath: join(sandbox, ".myelin", "install.json"),
    desiredManifest: null,
    actions: [{
      id: "remove_launcher",
      description: "remove launcher",
      path: join(sandbox, "bin", "myelin"),
      expected_sha256: "abc",
      backup_path: null,
    }],
    createdAt: "2026-07-10T10:00:00.000Z",
  });

  await writeInstallJournal(path, journal);
  expect((await stat(path)).mode & 0o777).toBe(0o600);
  expect((await readInstallJournalIfExists(path))?.actions[0]?.state).toBe("pending");

  await markInstallActionComplete(path, journal, "remove_launcher");
  expect((await readInstallJournalIfExists(path))?.actions[0]?.state).toBe("complete");
  await removeInstallJournal(path);
  expect(await readInstallJournalIfExists(path)).toBeNull();
});

test("install journal rejects unsupported operations and relative paths", () => {
  expect(() => parseInstallJournal({ schema_version: 1 }, "fixture")).toThrow("transaction_id");
  expect(() => parseInstallJournal({
    schema_version: 1,
    transaction_id: "txn",
    operation: "repair",
    myelin_root: "/checkout",
    launcher_path: "/bin/myelin",
    locator_path: "/home/install.json",
    desired_manifest: null,
    actions: [],
    created_at: "now",
  })).toThrow("operation");
});
