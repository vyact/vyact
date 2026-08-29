#!/bin/bash
set -e
cd "$(dirname "$0")"

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

echo ""
echo "============================================"
echo "  Vyact Windows Build (on macOS)"
echo "============================================"

restore() {
    echo ""
    echo "[RESTORE] 원본 파일 복원 중..."
    [ -f "electron/package.json.mac_backup" ]  && cp "electron/package.json.mac_backup"  "electron/package.json"
    [ -f "app/docker-compose.yml.mac_backup" ] && cp "app/docker-compose.yml.mac_backup" "app/docker-compose.yml"
    rm -f "electron/package.json.mac_backup"
    rm -f "app/docker-compose.yml.mac_backup"
    rm -f "electron/icon.ico"
    echo "[RESTORE] 원본 복원 완료"
}
trap restore EXIT

if $UPDATE_BEFORE_BUILD; then
    echo ""
    echo "[0/5] Git pull..."
    git pull
    echo "[OK] Git pull 완료"
fi

# ── 1. 원본 파일 백업 ─────────────────────────
echo ""
echo "[1/5] 원본 파일 백업..."
cp "electron/package.json"   "electron/package.json.mac_backup"
cp "app/docker-compose.yml"  "app/docker-compose.yml.mac_backup"
echo "[OK] 백업 완료"

# ── 2. 윈도우 전용 파일 교체 ──────────────────
echo ""
echo "[2/5] 윈도우 전용 파일 적용..."
cp "win/electron/package.json"   "electron/package.json"
cp "win/electron/icon.ico"       "electron/icon.ico"
cp "win/app/docker-compose.yml"  "app/docker-compose.yml"
echo "[OK] 윈도우 파일 적용 완료"

# ── 3. Frontend 빌드 ──────────────────────────
echo ""
echo "[3/5] Frontend build..."
cd frontend
npm install
npm run build
cd ..
echo "[OK] Frontend build 완료"

# ── 4. Electron 빌드 (--win 크로스 컴파일) ────
echo ""
echo "[4/5] Electron build (Windows target)..."
./scripts/prepare_python_runtime.sh windows
cd electron
rm -rf dist
if $IS_CLEAN_BUILD; then
    rm -rf node_modules
fi
npm install
if [ -z "${CSC_LINK:-}" ]; then
    export CSC_IDENTITY_AUTO_DISCOVERY=false
fi
npm run build   # package.json에 "build": "electron-builder --win" 으로 교체됐으므로 그대로 실행
if [ ! -f "dist/win-unpacked/resources/locales/en/settings.json" ]; then
    echo "[FAIL] Packaged locale resource is missing: locales/en/settings.json"
    exit 1
fi
cd ..
echo "[OK] Electron build 완료"

# ── 5. 결과물 수집 ────────────────────────────
echo ""
echo "[5/5] Collecting artifacts..."
mkdir -p dist
cp electron/dist/*.exe dist/ 2>/dev/null || true

# trap이 EXIT에서 restore 자동 호출

echo ""
echo "============================================"
echo "  Build Complete"
echo "============================================"
echo "  Output: $(pwd)/dist/"
echo ""
ls dist/*.exe 2>/dev/null || echo "  (exe 파일 없음)"
