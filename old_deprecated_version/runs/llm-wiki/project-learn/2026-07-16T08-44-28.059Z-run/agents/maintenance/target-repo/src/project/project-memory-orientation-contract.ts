import { existsSync } from "node:fs";
import { join } from "node:path";

export const PROJECT_MEMORY_DEFAULT_ORIENTATION_SURFACES = [
  "AGENTS.md",
  "MYELIN.md",
  "CONTEXT.md",
  "README.md",
  "package.json",
  "Makefile",
  "docs/CLI.md",
  "docs/ROADMAP.md",
  "docs/adr/",
  "docs/design/",
  "src/cli.ts",
  "src/project/",
  "src/memory/",
  "src/ingest/",
  "src/query/",
  "src/commands/",
  "src/runtime/",
] as const;

export type ProjectMemoryOrientationSurface = {
  path: string;
  required: boolean;
  reason: string;
};

export type ProjectMemoryOrientationSurfaceDiagnostic = {
  path: string;
  reason: "not_present" | "present_not_inspected";
};

export type ProjectMemoryDocumentationContract = {
  inspected_default_surfaces: string[];
  curator_added_surfaces: { path: string; reason: string }[];
  missing_orientation_surfaces: ProjectMemoryOrientationSurfaceDiagnostic[];
  missing_coverage: string[];
  shallow_summary_findings: string[];
};

export async function missingRequiredOrientationSurfaces(input: {
  targetRepoRoot: string;
  inspected: string[];
  missing?: ProjectMemoryOrientationSurfaceDiagnostic[];
}): Promise<string[]> {
  return missingRequiredOrientationSurfacesSync(input);
}

export function missingRequiredOrientationSurfacesSync(input: {
  targetRepoRoot: string;
  inspected: string[];
  missing?: ProjectMemoryOrientationSurfaceDiagnostic[];
}): string[] {
  const inspectedSet = new Set(input.inspected);
  const missing: string[] = [];
  for (const surface of PROJECT_MEMORY_DEFAULT_ORIENTATION_SURFACES) {
    if (!existsSync(join(input.targetRepoRoot, surface))) continue;
    if (orientationSurfaceSatisfied(surface, inspectedSet)) continue;
    missing.push(`required orientation surface not inspected: ${surface}`);
  }
  return missing;
}

export function orientationSurfaceSatisfied(surface: string, inspectedSet: ReadonlySet<string>): boolean {
  if (inspectedSet.has(surface)) return true;
  if (!surface.endsWith("/")) return false;
  return [...inspectedSet].some((inspected) => inspected.startsWith(surface));
}
