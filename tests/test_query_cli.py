from __future__ import annotations

from pathlib import Path


REPO_ROOT = Path(__file__).parent.parent


def test_make_ask_target_exists():
    content = (REPO_ROOT / "Makefile").read_text()
    assert "ask:" in content
    assert "scripts/ask.sh" in content
