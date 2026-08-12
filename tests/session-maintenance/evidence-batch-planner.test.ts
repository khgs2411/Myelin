import { expect, test } from "bun:test";
import {
  planSMCEvidenceBatches,
  type SMCBatchableEvidence,
  type SMCEvidenceBatchBudgets,
} from "../../src/session-maintenance/evidence-batch-planner.ts";

const planIdentity = `sha256:${"a".repeat(64)}` as const;

test("packs complete evidence in stable order by item and encoded-byte budgets", () => {
  const items = [item("a", 4), item("b", 5), item("c", 3), item("d", 2)];
  const input = {
    anchor_job_id: "job_1",
    preparation_plan_identity: planIdentity,
    items,
    budgets: {
      max_items_per_batch: 2,
      max_encoded_bytes_per_batch: 8,
      max_encoded_bytes_per_item: 8,
    },
  };

  const first = planSMCEvidenceBatches(input);
  const second = planSMCEvidenceBatches(input);

  expect(first).toEqual(second);
  expect(first.kind).toBe("planned");
  if (first.kind !== "planned") throw new Error("expected planned batches");
  expect(first.batches.map((batch) => ({
    ordinal: batch.ordinal,
    source_ids: batch.source_ids,
    item_count: batch.item_count,
    encoded_bytes: batch.encoded_bytes,
  }))).toEqual([
    { ordinal: 0, source_ids: ["a"], item_count: 1, encoded_bytes: 4 },
    { ordinal: 1, source_ids: ["b", "c"], item_count: 2, encoded_bytes: 8 },
    { ordinal: 2, source_ids: ["d"], item_count: 1, encoded_bytes: 2 },
  ]);
  expect(new Set(first.batches.map((batch) => batch.id)).size).toBe(3);
});

test("batch identity changes with its anchor job, plan identity, order, or content hash", () => {
  const budgets = {
    max_items_per_batch: 10,
    max_encoded_bytes_per_batch: 100,
    max_encoded_bytes_per_item: 100,
  };
  const baseItems = [item("a", 2), item("b", 2)];
  const idFor = (input: {
    anchor_job_id?: string;
    preparation_plan_identity?: `sha256:${string}`;
    items?: SMCBatchableEvidence[];
  }): string => {
    const result = planSMCEvidenceBatches({
      anchor_job_id: input.anchor_job_id ?? "job_1",
      preparation_plan_identity: input.preparation_plan_identity ?? planIdentity,
      items: input.items ?? baseItems,
      budgets,
    });
    if (result.kind !== "planned") throw new Error("expected planned batches");
    return result.batches[0]!.id;
  };

  const base = idFor({});
  expect(idFor({ anchor_job_id: "job_2" })).not.toBe(base);
  expect(idFor({ preparation_plan_identity: `sha256:${"b".repeat(64)}` })).not.toBe(base);
  expect(idFor({ items: [...baseItems].reverse() })).not.toBe(base);
  expect(idFor({ items: [{ ...baseItems[0]!, content_hash: `sha256:${"f".repeat(64)}` }, baseItems[1]!] }))
    .not.toBe(base);
});

test("blocks an oversize item without splitting or excerpting it", () => {
  expect(planSMCEvidenceBatches({
    anchor_job_id: "job_1",
    preparation_plan_identity: planIdentity,
    items: [item("oversize", 11)],
    budgets: {
      max_items_per_batch: 10,
      max_encoded_bytes_per_batch: 20,
      max_encoded_bytes_per_item: 10,
    },
  })).toEqual({
    kind: "blocked",
    code: "evidence_item_too_large",
    source_id: "oversize",
    encoded_bytes: 11,
    max_encoded_bytes_per_item: 10,
  });
});

test("requires explicit coherent positive budgets", () => {
  expect(() => planSMCEvidenceBatches({
    anchor_job_id: "job_1",
    preparation_plan_identity: planIdentity,
    items: [],
    budgets: {
      max_items_per_batch: 0,
      max_encoded_bytes_per_batch: 10,
      max_encoded_bytes_per_item: 10,
    },
  })).toThrow("Invalid max_items_per_batch");

  expect(() => planSMCEvidenceBatches({
    anchor_job_id: "job_1",
    preparation_plan_identity: planIdentity,
    items: [],
    budgets: {
      max_items_per_batch: 1,
      max_encoded_bytes_per_batch: 9,
      max_encoded_bytes_per_item: 10,
    },
  })).toThrow("max_encoded_bytes_per_item cannot exceed max_encoded_bytes_per_batch");
});

test("fails closed when any runtime budget field is missing or malformed", () => {
  const valid = {
    max_items_per_batch: 1,
    max_encoded_bytes_per_batch: 10,
    max_encoded_bytes_per_item: 10,
  };
  const names = Object.keys(valid) as Array<keyof SMCEvidenceBatchBudgets>;
  const malformedValues: unknown[] = [undefined, Number.NaN, 1.5, 0, -1];

  for (const name of names) {
    const missing = { ...valid } as Partial<SMCEvidenceBatchBudgets>;
    delete missing[name];
    expect(() => planWithRuntimeBudgets(missing)).toThrow(`Invalid ${name}`);
    for (const value of malformedValues) {
      expect(() => planWithRuntimeBudgets({ ...valid, [name]: value })).toThrow(`Invalid ${name}`);
    }
  }
});

function item(sourceId: string, encodedBytes: number): SMCBatchableEvidence {
  return {
    source_id: sourceId,
    content_hash: `sha256:${sourceId.padEnd(64, sourceId).slice(0, 64)}`,
    encoded_bytes: encodedBytes,
  };
}

function planWithRuntimeBudgets(value: unknown): void {
  planSMCEvidenceBatches({
    anchor_job_id: "job_1",
    preparation_plan_identity: planIdentity,
    items: [],
    budgets: value as SMCEvidenceBatchBudgets,
  });
}
