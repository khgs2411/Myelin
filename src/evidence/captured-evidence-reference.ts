export type CapturedEvidenceReference = Readonly<{
  evidenceId: number;
  projectSequence: number;
  disposition: "inserted" | "existing";
}>;
