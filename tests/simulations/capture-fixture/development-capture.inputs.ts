import { resolve } from "node:path";

const REPOSITORY_ROOT = resolve(import.meta.dir, "../../..");

export const DEVELOPMENT_CAPTURE_INPUTS = [
  {
    fixtureReference: "llm-wiki-development-capture-session-2026-09-07",
    itemIndex: 0,
    workingDirectory: REPOSITORY_ROOT,
    occurredAt: "2026-09-07T09:00:00.000Z",
    speakerRole: "user",
    content:
      "The development fixture is not a CLI command. It is a development capture source that exercises the application capture path.",
  },
  {
    fixtureReference: "llm-wiki-development-capture-session-2026-09-07",
    itemIndex: 1,
    workingDirectory: REPOSITORY_ROOT,
    occurredAt: "2026-09-07T09:01:00.000Z",
    speakerRole: "assistant",
    content:
      "The development simulation now creates the Application and calls Application.capture with development.fixture native inputs.",
  },
  {
    fixtureReference: "llm-wiki-development-capture-session-2026-09-07",
    itemIndex: 2,
    workingDirectory: REPOSITORY_ROOT,
    occurredAt: "2026-09-07T09:02:00.000Z",
    speakerRole: "user",
    content:
      "The complete product will capture provider-native session inputs through automated hooks and accept explicit memory candidates through future CLI or MCP commands.",
  },
  {
    fixtureReference: "llm-wiki-development-capture-session-2026-09-07",
    itemIndex: 3,
    workingDirectory: REPOSITORY_ROOT,
    occurredAt: "2026-09-07T09:03:00.000Z",
    speakerRole: "assistant",
    content:
      "Automated capture and the development fixture use source-specific adapters, then share Application.capture, EvidenceCaptureService, and durable EvidenceItem persistence.",
  },
  {
    fixtureReference: "llm-wiki-development-capture-session-2026-09-07",
    itemIndex: 4,
    workingDirectory: REPOSITORY_ROOT,
    occurredAt: "2026-09-07T09:04:00.000Z",
    speakerRole: "assistant",
    content:
      "A Bun debug entry and VS Code launch configuration invoke the manual development simulation without routing through the CLI.",
  },
  {
    fixtureReference: "llm-wiki-development-capture-session-2026-09-07",
    itemIndex: 5,
    workingDirectory: REPOSITORY_ROOT,
    occurredAt: "2026-09-07T09:05:00.000Z",
    speakerRole: "user",
    content:
      "The manual development fixture captures real project-session evidence that later evidence ingestion can curate into session-memory drafts.",
  },
] as const;
