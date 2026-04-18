"""Every stage's instructions.md must include a required output schema block."""

from pathlib import Path


REPO_ROOT = Path(__file__).parent.parent


def _instructions(stage: str) -> str:
    return (REPO_ROOT / "agents" / "update" / stage / "instructions.md").read_text()


def _has_schema_section(text: str) -> bool:
    return "## Required output schema" in text


def _has_json_example(text: str) -> bool:
    return "```json" in text


def test_sense_instructions_have_schema():
    text = _instructions("01-sense")
    assert _has_schema_section(text), "sense instructions missing '## Required output schema'"
    assert _has_json_example(text), "sense instructions missing inline ```json example"


def test_impact_instructions_have_schema():
    text = _instructions("02-impact")
    assert _has_schema_section(text)
    assert _has_json_example(text)
    schema_section = text.split("## Required output schema", 1)[1]
    assert "02-impact.ranking" in schema_section
    assert "02-impact.delta" in schema_section
    assert "ranked_domains" in schema_section
    assert "signal_c_reasoning" in schema_section
    assert "affected_pages" in schema_section
    assert "new_domains" in schema_section


def test_propose_instructions_have_schema():
    text = _instructions("03-propose")
    assert _has_schema_section(text)
    assert _has_json_example(text)
    schema_section = text.split("## Required output schema", 1)[1]
    assert "justification_signals" in schema_section
    assert "destructive" in schema_section
    assert "uncertainty" in schema_section
    assert "source_classification" in schema_section
    assert "source_citations" in schema_section
    assert "deferred_domains" in schema_section


def test_propose_instructions_enforce_shelf_allowlist():
    text = _instructions("03-propose")
    schema_section = text.split("## Required output schema", 1)[1]
    assert "shelf_allowlist" in schema_section.lower() or "allowed shelves" in schema_section.lower()
    for shelf in (
        "architecture",
        "systems",
        "modules",
        "integrations",
        "decisions",
        "runbooks",
        "sessions",
        "glossary",
        "open-questions",
    ):
        assert shelf in schema_section, f"missing shelf {shelf!r} in propose instructions"
