#!/usr/bin/env python3
"""Validate that every agents/update/<stage>/config.json has the required shape.

Exits 0 on success. On failure, prints offending stage + field to stderr and
exits non-zero.

Called by scripts/update.sh at pipeline entry (before invoking any stage).
"""

import argparse
import json
import sys
from pathlib import Path


REQUIRED_KEYS = {
    "stage",
    "agent_kind",
    "token_budget_input",
    "token_budget_output",
    "on_over_budget",
    "stage_specific",
}

VALID_AGENT_KINDS = {"script-only", "script+classifier", "llm-agent"}
VALID_OVER_BUDGET = {"fail-clean"}


def validate_config(path: Path) -> list[str]:
    """Return list of error strings for this config. Empty list = valid."""
    errors: list[str] = []
    try:
        data = json.loads(path.read_text())
    except json.JSONDecodeError as exc:
        return [f"{path}: invalid JSON: {exc}"]

    for key in REQUIRED_KEYS:
        if key not in data:
            errors.append(f"{path}: missing required field '{key}'")

    if "agent_kind" in data and data["agent_kind"] not in VALID_AGENT_KINDS:
        errors.append(
            f"{path}: agent_kind '{data['agent_kind']}' "
            f"not in {sorted(VALID_AGENT_KINDS)}"
        )

    if "on_over_budget" in data and data["on_over_budget"] not in VALID_OVER_BUDGET:
        errors.append(
            f"{path}: on_over_budget '{data['on_over_budget']}' "
            f"not in {sorted(VALID_OVER_BUDGET)}"
        )

    for budget in ("token_budget_input", "token_budget_output"):
        if budget in data and not isinstance(data[budget], int):
            errors.append(f"{path}: {budget} must be an integer")

    if "stage_specific" in data and not isinstance(data["stage_specific"], dict):
        errors.append(f"{path}: stage_specific must be an object")

    return errors


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--stages-root", required=True)
    args = parser.parse_args()
    root = Path(args.stages_root)
    configs = sorted(root.glob("*/config.json"))
    if not configs:
        print(f"error: no configs found under {root}", file=sys.stderr)
        return 2

    all_errors: list[str] = []
    for config in configs:
        all_errors.extend(validate_config(config))

    if all_errors:
        for err in all_errors:
            print(err, file=sys.stderr)
        return 1

    print(f"validated {len(configs)} stage config(s)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
