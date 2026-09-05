import { ApplicationError } from "../application-error.ts";
import type { CapturedEvidenceReference } from "../evidence/captured-evidence-reference.ts";
import type { EvidenceItemDto } from "../evidence/evidence-item.dto.ts";
import type { IEvidenceItemRepository } from "../evidence/evidence-item.repository.ts";
import type { WorkspaceContextService } from "../workspace/workspace-context.service.ts";
import type { CaptureResult, CaptureSourceKey } from "./capture-adapter.ts";

export type CaptureBatchInput = Readonly<{
  sourceKey: CaptureSourceKey;
  results: readonly CaptureResult[];
}>;

export class EvidenceCaptureService {
  public constructor(
    private readonly workspaceContextService: WorkspaceContextService,
    private readonly evidenceItemRepository: IEvidenceItemRepository,
  ) {}

  public async captureBatch(
    input: CaptureBatchInput,
  ): Promise<readonly CapturedEvidenceReference[]> {
    if (input.results.length === 0) {
      throw new ApplicationError("capture:invalid-input");
    }

    const items: EvidenceItemDto[] = [];
    for (const result of input.results) {
      const resolution = await this.workspaceContextService.resolve({
        workingDirectory: result.workingDirectory,
      });

      if (resolution.kind === "failed") {
        throw new ApplicationError("capture:failed", {
          cause: resolution.failure,
        });
      }
      if (resolution.kind === "unmanaged") {
        throw new ApplicationError("capture:unmanaged-workspace");
      }

      items.push({
        captureSourceKey: input.sourceKey,
        workspaceContext: resolution.context,
        nativeEventKind: result.nativeEventKind,
        nativeSessionReference: result.nativeSessionReference,
        nativeInteractionReference: result.nativeInteractionReference,
        nativeOccurredAt: result.nativeOccurredAt,
        normalizedContent: result.normalizedContent,
        replay: result.replay,
        sourceMaterial: result.sourceMaterial,
      });
    }

    const projectIdentity = items[0]!.workspaceContext.project.identity;
    if (
      items.some(
        (item) => item.workspaceContext.project.identity !== projectIdentity,
      )
    ) {
      throw new ApplicationError("capture:mixed-project-batch");
    }

    // No persistence starts until every context and the complete batch are valid.
    return this.evidenceItemRepository.insertBatch(items);
  }
}
