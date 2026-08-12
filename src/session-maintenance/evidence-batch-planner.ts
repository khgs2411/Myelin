import { createHash } from "node:crypto";
import { stableJson } from "../runtime/json.ts";

export type SMCBatchableEvidence = {
  source_id: string;
  content_hash: `sha256:${string}`;
  encoded_bytes: number;
};

export type SMCEvidenceBatchBudgets = {
  max_items_per_batch: number;
  max_encoded_bytes_per_batch: number;
  max_encoded_bytes_per_item: number;
};

export type SMCWorkBatch = {
  id: string;
  ordinal: number;
  work_kind: "evidence" | "audit";
  source_ids: string[];
  content_hashes: Array<`sha256:${string}`>;
  item_count: number;
  encoded_bytes: number;
};

export type SMCBatchPlanningResult =
  | { kind: "planned"; batches: SMCWorkBatch[] }
  | {
      kind: "blocked";
      code: "evidence_item_too_large";
      source_id: string;
      encoded_bytes: number;
      max_encoded_bytes_per_item: number;
    };

export function planSMCEvidenceBatches(input: {
  anchor_job_id: string;
  preparation_plan_identity: `sha256:${string}`;
  items: readonly SMCBatchableEvidence[];
  budgets: SMCEvidenceBatchBudgets;
}): SMCBatchPlanningResult {
  assertBatchBudgets(input.budgets);
  assertBatchableItems(input.items);

  const oversize = input.items.find(
    (item) => item.encoded_bytes > input.budgets.max_encoded_bytes_per_item,
  );
  if (oversize) {
    return {
      kind: "blocked",
      code: "evidence_item_too_large",
      source_id: oversize.source_id,
      encoded_bytes: oversize.encoded_bytes,
      max_encoded_bytes_per_item: input.budgets.max_encoded_bytes_per_item,
    };
  }

  const batches: SMCWorkBatch[] = [];
  let pending: SMCBatchableEvidence[] = [];
  let pendingBytes = 0;

  const flush = (): void => {
    if (pending.length === 0) return;
    const ordinal = batches.length;
    const sourceIds = pending.map((item) => item.source_id);
    const contentHashes = pending.map((item) => item.content_hash);
    batches.push({
      id: stableBatchId({
        anchor_job_id: input.anchor_job_id,
        preparation_plan_identity: input.preparation_plan_identity,
        ordinal,
        source_ids: sourceIds,
        content_hashes: contentHashes,
      }),
      ordinal,
      work_kind: "evidence",
      source_ids: sourceIds,
      content_hashes: contentHashes,
      item_count: pending.length,
      encoded_bytes: pendingBytes,
    });
    pending = [];
    pendingBytes = 0;
  };

  for (const item of input.items) {
    const wouldExceedItems = pending.length >= input.budgets.max_items_per_batch;
    const wouldExceedBytes = pendingBytes + item.encoded_bytes
      > input.budgets.max_encoded_bytes_per_batch;
    if (pending.length > 0 && (wouldExceedItems || wouldExceedBytes)) flush();
    pending.push(item);
    pendingBytes += item.encoded_bytes;
  }
  flush();

  return { kind: "planned", batches };
}

function assertBatchableItems(items: readonly SMCBatchableEvidence[]): void {
  const sourceIds = new Set<string>();
  for (const item of items) {
    if (item.source_id.length === 0) throw new Error("Evidence source_id must not be empty");
    if (sourceIds.has(item.source_id)) throw new Error(`Duplicate evidence source_id: ${item.source_id}`);
    if (!Number.isInteger(item.encoded_bytes) || item.encoded_bytes <= 0) {
      throw new Error(`Invalid encoded_bytes for evidence ${item.source_id}: ${item.encoded_bytes}`);
    }
    sourceIds.add(item.source_id);
  }
}

function assertBatchBudgets(budgets: SMCEvidenceBatchBudgets): void {
  if (!budgets || typeof budgets !== "object") {
    throw new Error("Invalid evidence batch budgets: expected an object");
  }
  const required: Array<keyof SMCEvidenceBatchBudgets> = [
    "max_items_per_batch",
    "max_encoded_bytes_per_batch",
    "max_encoded_bytes_per_item",
  ];
  for (const name of required) {
    const value = budgets[name];
    if (!Number.isInteger(value) || value <= 0) {
      throw new Error(`Invalid ${name}: ${value}. Expected a positive integer`);
    }
  }
  if (budgets.max_encoded_bytes_per_item > budgets.max_encoded_bytes_per_batch) {
    throw new Error("max_encoded_bytes_per_item cannot exceed max_encoded_bytes_per_batch");
  }
}

function stableBatchId(input: {
  anchor_job_id: string;
  preparation_plan_identity: `sha256:${string}`;
  ordinal: number;
  source_ids: string[];
  content_hashes: Array<`sha256:${string}`>;
}): string {
  const hex = createHash("sha256").update(stableJson(input), "utf8").digest("hex");
  return `smc_batch_${hex}`;
}
