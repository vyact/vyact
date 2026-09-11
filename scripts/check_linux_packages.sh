#!/usr/bin/env bash
# Keep both clean-install checks as upload gates, running in isolated containers.
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
images=(ubuntu:22.04 ubuntu:24.04)
process_ids=()
log_dir="$(mktemp -d)"
trap 'rm -rf "$log_dir"' EXIT

for index in "${!images[@]}"; do
  docker run --rm \
    -v "$ROOT_DIR/electron/dist:/packages:ro" \
    -v "$ROOT_DIR/scripts/check_linux_package.sh:/check.sh:ro" \
    "${images[$index]}" bash /check.sh > "$log_dir/$index.log" 2>&1 &
  process_ids+=("$!")
done

failed=0
for index in "${!images[@]}"; do
  result=0
  wait "${process_ids[$index]}" || result=$?
  echo "::group::Clean installation: ${images[$index]}"
  cat "$log_dir/$index.log"
  echo "::endgroup::"
  if (( result != 0 )); then
    echo "::error::Clean installation failed on ${images[$index]} (exit $result)"
    failed=1
  fi
done
exit "$failed"
