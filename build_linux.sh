#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")" && pwd)"
FRONTEND_DIR="$ROOT_DIR/frontend"
ELECTRON_DIR="$ROOT_DIR/electron"
DIST_DIR="$ROOT_DIR/dist"

if [ "$(uname -s)" != "Linux" ]; then
  echo "Linux packages must be built on Linux (x86_64)." >&2
  exit 1
fi

case "$(uname -m)" in
  x86_64|amd64) ;;
  *) echo "Unsupported Linux architecture: $(uname -m). Only x86_64 is currently supported." >&2; exit 1 ;;
esac

cd "$FRONTEND_DIR"
npm ci
npm run build

cd "$ROOT_DIR"
"$ROOT_DIR/scripts/prepare_python_runtime.sh" linux-x64
bash "$ROOT_DIR/scripts/prepare_linux_runtime.sh"

cd "$ELECTRON_DIR"
npm ci
npm run build:linux

mkdir -p "$DIST_DIR"
find "$ELECTRON_DIR/dist" -maxdepth 1 -type f \( -name '*.AppImage' -o -name '*.deb' -o -name 'latest-linux.yml' \) -exec cp {} "$DIST_DIR/" \;

echo "Linux packages created in $DIST_DIR"
