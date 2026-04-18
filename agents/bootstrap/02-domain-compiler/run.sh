#!/usr/bin/env bash

set -euo pipefail

AGENT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "$AGENT_DIR/../../.." && pwd)"

exec "$ROOT_DIR/agents/bootstrap/_shared/stage_runner.sh" --agent-dir "$AGENT_DIR" "$@"
