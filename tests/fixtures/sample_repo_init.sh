#!/usr/bin/env bash
# Idempotently initialize the sample_repo fixture's git history.
# Called by tests when the .git directory is missing (e.g., after fresh clone).
#
# Why a helper: git cannot track nested .git directories, so we cannot commit
# the fixture's history. Instead, each test run ensures it exists.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_DIR="$SCRIPT_DIR/sample_repo"

if [[ -d "$REPO_DIR/.git" ]]; then
  exit 0
fi

cd "$REPO_DIR"
git init -q
git config user.email "test@fixture.local"
git config user.name "Fixture Author"
git add README.md pyproject.toml
git commit -q -m "chore: initialize project"
git add src/
git commit -q -m "feat: add auth, db, and main modules"
git add docs/
git commit -q -m "docs: add architecture overview"
