# Class Kit Codex Capture Verification

Date: 2026-06-12

## Preflight

- `test -d /Users/liadgoren/Repositories/class-kit`: passed.
- `bun test`: passed. Final output line: `Ran 78 tests across 20 files. [286.00ms]`.
- `bun run typecheck`: passed. Final output line: `$ tsc --noEmit`.
- `bun src/cli.ts install`: passed as preview only and did not apply real provider changes.

Install preview summary:

```text
Command: install
Provider: codex
Mode: preview
Detected: true
Provider root: /Users/liadgoren/.codex
Hooks path: /Users/liadgoren/.codex/hooks.json
- create hooks.json
- write .myelin/shim/codex-hook
- write .myelin/install-manifest.json
```

## Approval Gate

Real `~/.codex` mutation was approved by Liad in chat immediately before running install apply.

- Approval timestamp: 2026-06-12T13:40Z UTC.
- Command: `bun src/cli.ts install --apply --provider codex`
- Result: passed.

Install apply summary:

```text
Command: install
Provider: codex
Mode: apply
Detected: true
Provider root: /Users/liadgoren/.codex
Hooks path: /Users/liadgoren/.codex/hooks.json
- create hooks.json
- write .myelin/shim/codex-hook
- write .myelin/install-manifest.json
```

Verified files:

- `/Users/liadgoren/.codex/hooks.json`: exists.
- `/Users/liadgoren/.codex/.myelin/shim/codex-hook`: exists and exports `MYELIN_ROOT="/Users/liadgoren/Repositories/llm-wiki"`.
- `/Users/liadgoren/.codex/.myelin/backups`: exists. It is empty because there was no pre-existing `hooks.json` to back up.

## Bootstrap

- Command: `bun src/cli.ts bootstrap class-kit --repo /Users/liadgoren/Repositories/class-kit`
- Result:

```text
Bootstrapped project class-kit.
repo: /Users/liadgoren/Repositories/class-kit
created: 0
kept: 9
```

- `projects/class-kit/state/project.json`: exists and records `/Users/liadgoren/Repositories/class-kit`.
- `projects/class-kit/wiki/index.md`: exists.
- `bun src/cli.ts status class-kit`: passed and printed project key `class-kit`.

## Capture

Synthetic capture command, run from `/Users/liadgoren/Repositories/class-kit`:

```bash
printf '%s\n' '{"hook_event_name":"UserPromptSubmit","session_id":"manual-session-approved","turn_id":"manual-turn-approved","cwd":"/Users/liadgoren/Repositories/class-kit","prompt":"Synthetic verification prompt for Myelin capture after approved install."}' | MYELIN_ROOT=/Users/liadgoren/Repositories/llm-wiki bun /Users/liadgoren/Repositories/llm-wiki/src/cli.ts capture codex-hook
```

Result:

```text
capture stored
```

Rows observed in `/Users/liadgoren/Repositories/llm-wiki/state/memory.db` for `class-kit`:

```json
[
  {
    "project_key": "class-kit",
    "event_kind": "user.prompt",
    "provider": "codex",
    "source": "codex-hook",
    "status": "valid",
    "provider_session_id": "manual-session",
    "turn_id": "manual-turn",
    "raw_text": "Synthetic verification prompt for Myelin capture."
  },
  {
    "project_key": "class-kit",
    "event_kind": "user.prompt",
    "provider": "codex",
    "source": "codex-hook",
    "status": "valid",
    "provider_session_id": "manual-session-approved",
    "turn_id": "manual-turn-approved",
    "raw_text": "Synthetic verification prompt for Myelin capture after approved install."
  },
  {
    "project_key": "class-kit",
    "event_kind": "user.prompt",
    "provider": "codex",
    "source": "codex-hook",
    "status": "valid",
    "provider_session_id": "manual-session-approved-2",
    "turn_id": "manual-turn-approved-2",
    "raw_text": "Synthetic verification prompt for Myelin capture after approved install number two."
  }
]
```

- Hook errors observed for `class-kit`: `0`.
- `test ! -f /Users/liadgoren/Repositories/class-kit/state/memory.db`: passed.
- Wiki mutation check: `git status --short projects/class-kit/wiki state/memory.db state/hook-errors.jsonl` produced no tracked changes.

## Fixture Outcome

Redacted live fixture file written:

- `tests/fixtures/capture/codex/live-user-prompt-submit-redacted.json`

The fixture uses only synthetic prompt text and redacted session/turn identifiers.
