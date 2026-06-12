import { expect, test } from "bun:test";
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { normalizeCodexHookPayload } from "./codex.ts";

const fixtures = join(process.cwd(), "tests", "fixtures", "capture", "codex");

test("maps SessionStart to session.start", async () => {
  const payload = JSON.parse(await readFile(join(fixtures, "session-start.json"), "utf8"));
  const event = normalizeCodexHookPayload(payload);

  expect(event?.provider).toBe("codex");
  expect(event?.source).toBe("codex-hook");
  expect(event?.hook_event_name).toBe("SessionStart");
  expect(event?.event_kind).toBe("session.start");
  expect(event?.provider_session_id).toBe("sess_123");
});

test("maps UserPromptSubmit prompt text", async () => {
  const payload = JSON.parse(await readFile(join(fixtures, "user-prompt-submit.json"), "utf8"));
  const event = normalizeCodexHookPayload(payload);

  expect(event?.event_kind).toBe("user.prompt");
  expect(event?.turn_id).toBe("turn_1");
  expect(event?.raw_text).toContain("Supabase");
});

test("maps Stop with assistant text and preserves empty Stop as invalid evidence", async () => {
  const withMessage = JSON.parse(await readFile(join(fixtures, "stop-with-message.json"), "utf8"));
  const empty = JSON.parse(await readFile(join(fixtures, "stop-empty.json"), "utf8"));

  expect(normalizeCodexHookPayload(withMessage)?.event_kind).toBe("assistant.response");
  const emptyEvent = normalizeCodexHookPayload(empty);
  expect(emptyEvent?.hook_event_name).toBe("Stop");
  expect(emptyEvent?.event_kind).toBeNull();
  expect(emptyEvent?.status).toBe("invalid");
  expect(emptyEvent?.raw_payload_json).toContain("Stop");
});

test("unknown or malformed payload becomes invalid raw evidence when cwd is present", () => {
  const event = normalizeCodexHookPayload({ hook_event_name: "Unexpected", cwd: "/tmp/class-kit" });

  expect(event?.status).toBe("invalid");
  expect(event?.event_kind).toBeNull();
  expect(event?.raw_payload_json).toContain("Unexpected");
});

test("redacted live fixtures normalize to capture events", async () => {
  const files = (await readdir(fixtures)).filter((file) => file.startsWith("live-") && file.endsWith(".json"));

  expect(files.length).toBeGreaterThan(0);
  for (const file of files) {
    const payload = JSON.parse(await readFile(join(fixtures, file), "utf8"));
    expect(normalizeCodexHookPayload(payload)).not.toBeNull();
  }
});
