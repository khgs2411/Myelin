#!/usr/bin/env bun

import { Database } from "bun:sqlite";
import { existsSync, writeFileSync } from "node:fs";
import { runFrozenPreFirewallLauncher } from "../../pre-firewall-session-runtime.ts";

const INTERNAL_INVOCATION_KIND_ENV = "MYELIN_INTERNAL_INVOCATION_KIND";

const [command, dbPath, jobId, readyPath, releasePath, expectedRoute] = process.argv.slice(2);
if (command !== "post-spawn-pre-pid" || !dbPath || !jobId || !readyPath || !releasePath || !expectedRoute) {
  throw new Error("invalid frozen pre-firewall fixture invocation");
}
const route = process.env[INTERNAL_INVOCATION_KIND_ENV] === "installed" ? "installed-locator" : "direct-source";
if (route !== expectedRoute) throw new Error(`unexpected frozen runtime route: ${route}`);

const db = new Database(dbPath);
try {
  db.exec("PRAGMA busy_timeout = 10000; PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;");
  writeFileSync(readyPath, JSON.stringify({ route, job_id: jobId }));
  while (!existsSync(releasePath)) await Bun.sleep(5);
  runFrozenPreFirewallLauncher({
    db,
    jobId,
    now: "2026-08-11T10:00:00.000Z",
    spawn: () => ({ pid: 5150, logPath: `/tmp/${route}.log` }),
  });
} finally {
  db.close();
}
