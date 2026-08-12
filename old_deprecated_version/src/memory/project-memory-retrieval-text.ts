export type ProjectMemoryRetrievalHintsForText = {
  keywords?: string[];
  aliases?: string[];
  topics?: string[];
  query_phrases?: string[];
};

export function normalizeProjectMemorySectionForEmbedding(input: {
  page_title: string;
  category: string | null;
  heading_path: string[];
  body_text: string;
  hints?: ProjectMemoryRetrievalHintsForText | null;
}): string {
  const lines = [
    `title: ${input.page_title}`,
    `category: ${input.category ?? "none"}`,
    `heading_path: ${input.heading_path.join(" > ")}`,
    `section_text: ${input.body_text.trim()}`,
  ];
  appendList(lines, "keywords", input.hints?.keywords);
  appendList(lines, "aliases", input.hints?.aliases);
  appendList(lines, "topics", input.hints?.topics);
  appendList(lines, "query_phrases", input.hints?.query_phrases);
  return lines.filter((line) => line.trim().length > 0).join("\n");
}

function appendList(lines: string[], label: string, values?: string[]): void {
  const cleaned = (values ?? []).map((value) => value.trim()).filter(Boolean);
  if (cleaned.length > 0) lines.push(`${label}: ${cleaned.join("; ")}`);
}
