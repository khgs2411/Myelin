#!/usr/bin/env bash

set -euo pipefail

project_key="${1:?project_key is required}"
lock_file_path="${2:?lock_file_path is required}"

cleanup() {
  rm -f "$lock_file_path"
}

trap cleanup EXIT

make update PROJECT="$project_key" AUTO=1
