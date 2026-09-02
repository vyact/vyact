#!/bin/bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
TARGET_OS="${1:-macos}"
RELEASE_TAG="${PYTHON_STANDALONE_RELEASE:-20251007}"
RUNTIME_DIR="$ROOT_DIR/electron/python-runtime"
API_URL="https://api.github.com/repos/astral-sh/python-build-standalone/releases/tags/$RELEASE_TAG"

case "$TARGET_OS" in
  macos) ASSET_PATTERN='cpython-3\.12\.[0-9]+(\+|%2B).*-aarch64-apple-darwin-install_only_stripped\.tar\.gz' ;;
  windows) ASSET_PATTERN='cpython-3\.12\.[0-9]+(\+|%2B).*-x86_64-pc-windows-msvc-install_only_stripped\.tar\.gz' ;;
  linux-x64) ASSET_PATTERN='cpython-3\.12\.[0-9]+(\+|%2B).*-x86_64-unknown-linux-gnu-install_only_stripped\.tar\.gz' ;;
  *) echo "Unsupported Python runtime target: $TARGET_OS" >&2; exit 1 ;;
esac

mkdir -p "$RUNTIME_DIR"
RELEASE_ID="$(curl --fail --silent --show-error --location "$API_URL" \
  | sed -n 's/.*"id": *\([0-9][0-9]*\),.*/\1/p' | head -n 1)"
ASSET_URL=""
for PAGE in $(seq 1 10); do
  ASSET_URL="$(curl --fail --silent --show-error --location \
    "https://api.github.com/repos/astral-sh/python-build-standalone/releases/$RELEASE_ID/assets?per_page=100&page=$PAGE" \
    | sed -n 's/.*"browser_download_url": *"\([^"]*\)".*/\1/p' \
    | grep -E "$ASSET_PATTERN" | head -n 1 || true)"
  [ -n "$ASSET_URL" ] && break
done

if [ -z "$ASSET_URL" ]; then
  echo "Python 3.12 runtime asset was not found in release $RELEASE_TAG" >&2
  exit 1
fi

ARCHIVE_PATH="$(mktemp "${TMPDIR:-/tmp}/vyact-python.XXXXXX.tar.gz")"
trap 'rm -f "$ARCHIVE_PATH"' EXIT
echo "Downloading bundled Python 3.12 runtime ($TARGET_OS)..."
curl --fail --show-error --location "$ASSET_URL" --output "$ARCHIVE_PATH"
rm -rf "$RUNTIME_DIR/python"
tar -xzf "$ARCHIVE_PATH" -C "$RUNTIME_DIR"

if [ "$TARGET_OS" != "windows" ]; then
  "$RUNTIME_DIR/python/bin/python3" --version
else
  test -f "$RUNTIME_DIR/python/python.exe"
fi
