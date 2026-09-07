import type { EvidenceItem } from "../storage/sqlite/models/evidence-item.model.ts";

export interface IPreparedEvidenceItem {
  readonly evidenceId: number;
  readonly content: string;
  readonly nativeEventKind: string;
  readonly nativeSessionReference: string | null;
  readonly nativeInteractionReference: string | null;
  readonly nativeOccurredAt: string | null;
}

export interface IEvidenceAdapter {
  Prepare(evidence: readonly EvidenceItem[]): readonly IPreparedEvidenceItem[];
}
