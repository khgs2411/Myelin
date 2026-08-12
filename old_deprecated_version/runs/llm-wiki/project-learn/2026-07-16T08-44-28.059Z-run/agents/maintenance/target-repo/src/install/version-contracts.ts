export const MYELIN_VERSION_MANIFEST = "version-manifest.json" as const;

export type InstalledVersionManifestV1 = {
  schema_version: 1;
  version_id: string;
  product_version: string;
  source_revision: string | null;
  source_dirty: boolean;
  content_sha256: string;
  bun_lock_sha256: string | null;
  entrypoint: "src/cli.ts";
  installed_at: string;
  artifacts: string[];
};

export type InstalledVersion = {
  id: string;
  path: string;
  manifest_path: string;
  manifest_sha256: string;
  product_version: string;
  source_revision: string | null;
  source_dirty: boolean;
  content_sha256: string;
  bun_lock_sha256: string | null;
  installed_at: string;
};

export type PlannedInstalledVersion = {
  version: InstalledVersion;
  manifest: InstalledVersionManifestV1;
  artifacts: string[];
  already_present: boolean;
};
