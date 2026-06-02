import json
import subprocess
import sys
from pathlib import Path


REPO_ROOT = Path(__file__).parent.parent


def test_render_metadata_products_copies_generated_state_to_latest(tmp_sample_project):
    state = tmp_sample_project / "state"
    (state / "page-metadata.json").write_text(json.dumps({"schema_version": 1, "pages": []}) + "\n")
    (state / "tag-index.json").write_text(json.dumps({"schema_version": 1, "tags": {}}) + "\n")
    (state / "alias-index.json").write_text(json.dumps({"schema_version": 1, "aliases": {}}) + "\n")
    (state / "relationships.json").write_text(json.dumps({"relationships": []}) + "\n")

    result = subprocess.run(
        [
            sys.executable,
            str(REPO_ROOT / "scripts" / "stable_products.py"),
            "render-metadata",
            "--project-dir",
            str(tmp_sample_project),
        ],
        capture_output=True,
        text=True,
    )

    assert result.returncode == 0, result.stderr
    latest = state / "latest"
    assert json.loads((latest / "page-metadata.json").read_text())["schema_version"] == 1
    assert json.loads((latest / "tag-index.json").read_text())["schema_version"] == 1
    assert json.loads((latest / "alias-index.json").read_text())["schema_version"] == 1
    assert json.loads((latest / "relationships.json").read_text())["relationships"] == []
