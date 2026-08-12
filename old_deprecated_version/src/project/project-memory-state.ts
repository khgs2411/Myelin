export function hasCuratedProjectMemoryBaseline(value: unknown): boolean {
  const status = projectMemoryStatus(value);
  return status === "curated" || status === "degraded";
}

export function projectMemoryStatus(value: unknown): string | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const status = (value as { status?: unknown }).status;
  return typeof status === "string" ? status : null;
}

export function projectMemoryMaintenanceStatus(value: unknown): string | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const maintenance = (value as { maintenance?: unknown }).maintenance;
  if (!maintenance || typeof maintenance !== "object" || Array.isArray(maintenance)) return null;
  const status = (maintenance as { status?: unknown }).status;
  return typeof status === "string" ? status : null;
}
