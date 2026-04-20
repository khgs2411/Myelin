from __future__ import annotations

import os
import subprocess
from pathlib import Path


REPO_ROOT = Path(__file__).parent.parent
WRAPPER = REPO_ROOT / "scripts" / "_auto_update_wrapper.sh"


def _write_fake_make(bin_dir: Path, exit_code: int) -> None:
    (bin_dir / "make").write_text(
        "#!/usr/bin/env bash\n"
        "if [ \"$1\" != \"update\" ]; then\n"
        "  exit 9\n"
        "fi\n"
        "if [ \"$2\" != \"PROJECT=sample\" ]; then\n"
        "  exit 8\n"
        "fi\n"
        "if [ \"$3\" != \"AUTO=1\" ]; then\n"
        "  exit 7\n"
        "fi\n"
        f"exit {exit_code}\n"
    )
    os.chmod(bin_dir / "make", 0o755)


def test_auto_update_wrapper_removes_lockfile_on_success(tmp_path: Path):
    bin_dir = tmp_path / "bin"
    bin_dir.mkdir()
    _write_fake_make(bin_dir, exit_code=0)

    lock_path = tmp_path / ".update.lock"
    lock_path.write_text("2026-04-20T10:00:00Z\n")

    result = subprocess.run(
        ["bash", str(WRAPPER), "sample", str(lock_path)],
        cwd=REPO_ROOT,
        env={**os.environ, "PATH": f"{bin_dir}:{os.environ['PATH']}"},
        capture_output=True,
        text=True,
    )

    assert result.returncode == 0
    assert not lock_path.exists()


def test_auto_update_wrapper_removes_lockfile_on_failure(tmp_path: Path):
    bin_dir = tmp_path / "bin"
    bin_dir.mkdir()
    _write_fake_make(bin_dir, exit_code=1)

    lock_path = tmp_path / ".update.lock"
    lock_path.write_text("2026-04-20T10:00:00Z\n")

    result = subprocess.run(
        ["bash", str(WRAPPER), "sample", str(lock_path)],
        cwd=REPO_ROOT,
        env={**os.environ, "PATH": f"{bin_dir}:{os.environ['PATH']}"},
        capture_output=True,
        text=True,
    )

    assert result.returncode == 1
    assert not lock_path.exists()
