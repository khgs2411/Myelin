import { describe, expect, test } from "bun:test";

import type { CapturedEvidenceReference } from "../../src/evidence/captured-evidence-reference.ts";
import type { EvidenceItemDto } from "../../src/evidence/evidence-item.dto.ts";
import { EvidenceManager } from "../../src/evidence/evidence-manager.ts";

function item(
  replayKey: string,
  normalizedContent: string | null,
): EvidenceItemDto {
  return {
    captureSourceKey: "fixture.unit",
    workspaceContext: {
      project: { identity: 1, key: "project", rootPath: "/project" },
      workingDirectory: "/project",
    },
    nativeEventKind: "fixture.input",
    speakerRole: "assistant",
    normalizedContent,
    replay: { scheme: "fixture/v1", key: replayKey },
    sourceMaterial: {
      format: "json.v1",
      content: new TextEncoder().encode(replayKey),
    },
  };
}

function managerWith(
  insertBatch: (
    items: readonly EvidenceItemDto[],
  ) => Promise<readonly CapturedEvidenceReference[]>,
): EvidenceManager {
  return new EvidenceManager(
    undefined as never,
    { insertBatch } as never,
    undefined as never,
  );
}

describe("EvidenceManager capture admission", () => {
  test("persists only evidence with non-whitespace normalized content in input order", async () => {
    const first = item("first", "  retained without normalization  ");
    const second = item("second", "retained second");
    let persisted: readonly EvidenceItemDto[] | undefined;
    const manager = managerWith(async (items) => {
      persisted = items;
      return [];
    });

    await manager.insertBatch([
      item("null", null),
      first,
      item("empty", ""),
      item("whitespace", " \t\n"),
      second,
    ]);

    expect(persisted).toEqual([first, second]);
    expect(persisted?.[0]).toBe(first);
    expect(persisted?.[1]).toBe(second);
  });

  test("returns an empty receipt without repository access when all content is absent", async () => {
    const manager = managerWith(async () => {
      throw new Error("The repository must not be accessed.");
    });

    await expect(
      manager.InsertBatch([
        item("null", null),
        item("empty", ""),
        item("whitespace", " \r\n\t"),
      ]),
    ).resolves.toEqual([]);
  });
});
