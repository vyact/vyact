#!/bin/bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")" && pwd)"
DIST_DIR="$ROOT_DIR/dist"
WORKFLOW_FILE="ci.yml"
LINUX_ARTIFACT_NAME="vyact-linux-x64"

if [ "$(uname -s)" != "Darwin" ]; then
  echo "The combined release build must be run on macOS." >&2
  exit 1
fi

for COMMAND in git gh; do
  if ! command -v "$COMMAND" >/dev/null 2>&1; then
    echo "Required command not found: $COMMAND" >&2
    exit 1
  fi
done

cd "$ROOT_DIR"

if [ -n "$(git status --porcelain)" ]; then
  echo "The working tree must be clean before creating release artifacts." >&2
  exit 1
fi

COMMIT_SHA="$(git rev-parse HEAD)"

if ! git branch -r --contains "$COMMIT_SHA" | grep -q .; then
  echo "Commit $COMMIT_SHA has not been pushed. Push it before building a release." >&2
  exit 1
fi

if ! gh auth status >/dev/null 2>&1; then
  echo "GitHub CLI authentication is required. Run: gh auth login" >&2
  exit 1
fi

echo "Locating the GitHub Actions run for commit $COMMIT_SHA..."
RUN_ID="$(gh run list \
  --workflow "$WORKFLOW_FILE" \
  --commit "$COMMIT_SHA" \
  --limit 1 \
  --json databaseId \
  --jq '.[0].databaseId // empty')"

if [ -z "$RUN_ID" ]; then
  echo "No GitHub Actions run was found for commit $COMMIT_SHA." >&2
  echo "Push the commit and wait for the CI workflow to start." >&2
  exit 1
fi

echo "Building the macOS release DMG..."
printf '1\n' | "$ROOT_DIR/build_release_dmg.sh"

echo "Building the Windows installer on macOS..."
printf '1\n' | "$ROOT_DIR/build_win_on_mac.sh"

echo "Waiting for GitHub Actions run $RUN_ID..."
gh run watch "$RUN_ID" --exit-status

LINUX_DOWNLOAD_DIR="$(mktemp -d)"
cleanup() {
  rm -rf "$LINUX_DOWNLOAD_DIR"
}
trap cleanup EXIT

echo "Downloading Linux packages from artifact $LINUX_ARTIFACT_NAME..."
gh run download "$RUN_ID" \
  --name "$LINUX_ARTIFACT_NAME" \
  --dir "$LINUX_DOWNLOAD_DIR"

mkdir -p "$DIST_DIR"
find "$LINUX_DOWNLOAD_DIR" -type f \( -name '*.AppImage' -o -name '*.deb' \) -exec cp {} "$DIST_DIR/" \;

shopt -s nullglob
DMG_FILES=("$DIST_DIR"/*.dmg)
EXE_FILES=("$DIST_DIR"/*.exe)
APPIMAGE_FILES=("$DIST_DIR"/*.AppImage)
DEB_FILES=("$DIST_DIR"/*.deb)
shopt -u nullglob

if [ "${#DMG_FILES[@]}" -eq 0 ] || \
   [ "${#EXE_FILES[@]}" -eq 0 ] || \
   [ "${#APPIMAGE_FILES[@]}" -eq 0 ] || \
   [ "${#DEB_FILES[@]}" -eq 0 ]; then
  echo "Release artifact collection is incomplete." >&2
  exit 1
fi

echo "All release artifacts are available in $DIST_DIR:"
ls -lh "$DIST_DIR"
