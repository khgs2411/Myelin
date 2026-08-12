// Pseudocode artifact. Non-executable reference shape for planning.

// Intended destination: src/project/project-memory-markdown-sections.ts
// Owns deterministic extraction of canonical Project Memory page and section records.
// Does not own semantic hints, embeddings, SQLite writes, or curator decisions.

type ProjectMemoryMarkdownPage = {
  project_key: string;
  wiki_path: string;
  absolute_path: string;
  category: string | null;
  slug: string;
  title: string;
  page_hash: string;
  size_bytes: number;
};

type ProjectMemoryMarkdownSection = {
  project_key: string;
  wiki_path: string;
  category: string | null;
  page_title: string;
  section_id: string;
  heading_level: number;
  heading_text: string;
  heading_path: string[];
  body_text: string;
  snippet: string;
  section_hash: string;
  start_line?: number;
  end_line?: number;
};

type ProjectMemorySectionManifest = {
  schema_version: 1;
  project_key: string;
  generated_at: string;
  pages: ProjectMemoryMarkdownPage[];
  sections: ProjectMemoryMarkdownSection[];
  warnings: string[];
};

class ProjectMemoryMarkdownSectionExtractor {
  extractProject(root: string, projectKey: string): Promise<ProjectMemorySectionManifest> {
    // Read projects/<key>/wiki/**/*.md.
    // Ignore dotfiles and non-markdown files.
    // Preserve relative wiki path as canonical ref.
    // For each page, parse title from first H1 or filename fallback.
    // Split sections by markdown headings.
    // If a page has body before first heading, attach it to a synthetic "page-overview" section.
    // Generate stable section ids from heading path; if duplicates collide, add deterministic ordinal suffix.
    // Compute page_hash and section_hash from normalized text.
    // Return warnings for duplicate headings, empty pages, or unsupported markdown shapes.
  }

  sectionIdFor(input: { wiki_path: string; heading_path: string[]; ordinal: number }): string {
    // Slugify heading path.
    // Include ordinal only when needed to disambiguate duplicate heading paths.
    // Must be deterministic across runs for unchanged markdown.
  }

  normalizeForHash(input: { heading_path: string[]; body_text: string }): string {
    // Normalize newlines, trim trailing whitespace, preserve meaningful markdown content.
    // Do not include generated snippets or semantic hints in section_hash.
  }
}

// Idempotency:
// - Same markdown content must produce same page/section ids and hashes.
// - Changed section body or heading path must change section_hash.
// - Moved page changes wiki_path and therefore creates new canonical refs.

// Failure posture:
// - Missing wiki directory returns empty manifest with warning, not an exception, unless project resolution fails upstream.
// - Unreadable files produce blocking extraction failure for that project run.
