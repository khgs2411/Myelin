# Use provider-agnostic capture adapters

Myelin's session-input capture must treat Codex as one provider implementation, not as the product boundary. Hook ingestion, installation, and event normalization should sit behind a provider-agnostic capture adapter interface so Codex-specific hooks can live under a Codex adapter today, while future providers such as Claude Code or Gemini can implement the same capture contract using their native mechanisms without refactoring Myelin's core Experience Log, project routing, or memory-promotion logic.
