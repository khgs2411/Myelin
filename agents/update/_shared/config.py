"""Config precedence resolver for update pipeline stages.

Precedence (highest to lowest):
1. Environment variable override (if env_override_name is set)
2. Project-level override in project.json (if project_key is set)
3. Default in stage's config.json (at key_path)

Raises FileNotFoundError if config_path is missing.
Raises KeyError if key_path not found in config and no override provides a value.
"""

import json
import os
from pathlib import Path
from typing import Any


def _dig(data: dict, key_path: str) -> Any:
    """Walk a dotted key path into a nested dict. Raise KeyError on miss."""
    node = data
    for part in key_path.split("."):
        if not isinstance(node, dict) or part not in node:
            raise KeyError(f"key path '{key_path}' not in config")
        node = node[part]
    return node


def resolve(
    *,
    config_path: Path,
    project_config_path: Path | None,
    env_override_name: str | None,
    key_path: str,
    project_key: str | None = None,
    value_type: type = None,
) -> Any:
    """Resolve a config value honoring env > project > stage-default precedence."""
    if env_override_name:
        env_val = os.environ.get(env_override_name)
        if env_val is not None and env_val != "":
            return value_type(env_val) if value_type else env_val

    if project_config_path and project_key and project_config_path.is_file():
        project_data = json.loads(project_config_path.read_text())
        if project_key in project_data and project_data[project_key] is not None:
            return project_data[project_key]

    if not config_path.is_file():
        raise FileNotFoundError(f"stage config missing: {config_path}")
    config_data = json.loads(config_path.read_text())
    return _dig(config_data, key_path)
