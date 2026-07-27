#!/bin/bash
# build_dmg.sh – RAG Agent Electron DMG Builder (safe version)
set -e

IS_CLEAN_BUILD=false
UPDATE_BEFORE_BUILD=false

echo "Select build mode:"
echo "  1) Build current checkout"
echo "  2) Pull latest changes, then build"
echo "  3) Clean build current checkout"
echo "  4) Pull latest changes, then clean build"
read -r -p "Enter a number [1-4]: " BUILD_OPTION

case "$BUILD_OPTION" in
  1) ;;
  2) UPDATE_BEFORE_BUILD=true ;;
  3) IS_CLEAN_BUILD=true ;;
  4) UPDATE_BEFORE_BUILD=true; IS_CLEAN_BUILD=true ;;
  *) echo "Invalid selection."; exit 1 ;;
esac

ROOT_DIR="$(pwd)"
FRONTEND_DIR="$ROOT_DIR/frontend"
APP_STATIC_DIR="$ROOT_DIR/app/static"
ELECTRON_DIR="$ROOT_DIR/electron"
DIST_DIR="$ROOT_DIR/dist"

# ── 로그 파일 설정 ─────────────────────────────
LOG_FILE="$ROOT_DIR/build.log"
exec > >(tee "$LOG_FILE") 2>&1
echo "Build log: $LOG_FILE"
echo "Started: $(date)"
echo "========================================"

G='\033[0;32m'; Y='\033[1;33m'; C='\033[0;36m'; NC='\033[0m'; BOLD='\033[1m'
log()  { echo -e "$1"; }
step() { log "\n${C}${BOLD}▸ $1${NC}"; }
ok()   { log "${G}  ✅ $1${NC}"; }
warn() { log "${Y}  ⚠️  $1${NC}"; }

if [[ "$OSTYPE" != "darwin"* ]]; then
  echo "❌ macOS only"; exit 1
fi

if $UPDATE_BEFORE_BUILD; then
  step "Updating source code"
  git pull
fi

# ── 1. 리액트 프론트엔드 빌드 ─────────────────
step "Building React Frontend"

if [ -d "$FRONTEND_DIR" ]; then
  cd "$FRONTEND_DIR"
  log "  Installing frontend packages..."
  npm install

  log "  Running npm run build..."
  npm run build

  ok "Frontend build completed"
else
  warn "Frontend directory not found. Skipping frontend build."
fi

cd "$ROOT_DIR"

# ── 2. 시스템 정리 ─────────────────────────────
step "Preparing build environment"

if hdiutil info | grep -q "/Volumes/RAG Agent"; then
  warn "Detaching existing volume..."
  DEVICES=$(hdiutil info | grep -B 20 "/Volumes/RAG Agent" | grep "/dev/disk" | awk '{print $1}')
  for DEV in $DEVICES; do
    hdiutil detach "$DEV" -force || true
  done
fi

rm -rf "$ELECTRON_DIR/dist"
rm -rf "$DIST_DIR"

if $IS_CLEAN_BUILD; then
  step "Cleaning dependency caches"
  pkill -f "hdiutil attach" 2>/dev/null || true
  rm -rf "$HOME/Library/Caches/electron-builder"
  rm -rf "$HOME/Library/Caches/electron"
fi

ok "Clean up done"

# ── 3. Node.js 확인 ─────────────────────────────
step "Checking Node.js"
ok "Node.js $(node --version)"

# ── 4. npm 패키지 설치 ─────────────────────────
step "Installing npm packages"

if [ -d "$HOME/Library/Caches/electron" ]; then
  chown -R "$(whoami)" "$HOME/Library/Caches/electron" 2>/dev/null || true
fi

cd "$ELECTRON_DIR"

if $IS_CLEAN_BUILD; then
  rm -rf node_modules
fi
npm install --unsafe-perm

ok "Packages installed"

# ── 5. 아이콘 생성 ─────────────────────────────
step "Generating app icon"

if [ -d "$ROOT_DIR/AppIcon.iconset" ]; then
  iconutil -c icns "$ROOT_DIR/AppIcon.iconset" -o "$ELECTRON_DIR/icon.icns"
  ok "icon.icns generated"
elif [ -f "$ELECTRON_DIR/icon.icns" ]; then
  ok "Using existing icon.icns"
else
  warn "AppIcon.iconset and icon.icns not found – electron-builder may use its default icon"
fi

# ── 6. Electron 빌드 ───────────────────────────
step "Building DMG (arm64)"

npm run build

# ── 7. 결과물 정리 ────────────────────────────
step "Collecting artifacts"

mkdir -p "$DIST_DIR"
cp "$ELECTRON_DIR/dist/"*.dmg "$DIST_DIR/" 2>/dev/null || true

echo ""
echo "========================================"
echo "Finished: $(date)"
echo "Log saved: $LOG_FILE"

log ""
log "${G}${BOLD}╔══════════════════════════════════════════════╗${NC}"
log "${G}${BOLD}║   ✅  DMG Build Complete                    ║${NC}"
log "${G}${BOLD}╚══════════════════════════════════════════════╝${NC}"
log "  Output: ${Y}$DIST_DIR${NC}"

ls -lh "$DIST_DIR"/*.dmg 2>/dev/null || true

open "$DIST_DIR"
