#!/bin/bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")" && pwd)"
DIST_DIR="$ROOT_DIR/dist"
ELECTRON_DIST_DIR="$ROOT_DIR/electron/dist"
NOTARY_PROFILE="vyact-notary"

export APPLE_KEYCHAIN_PROFILE="$NOTARY_PROFILE"

echo "Building signed and notarized macOS application..."
"$ROOT_DIR/build_dmg.sh"

shopt -s nullglob
DMG_FILES=("$DIST_DIR"/*.dmg)
shopt -u nullglob

if [ "${#DMG_FILES[@]}" -ne 1 ]; then
  echo "Expected exactly one DMG in $DIST_DIR, found ${#DMG_FILES[@]}." >&2
  exit 1
fi

DMG_PATH="${DMG_FILES[0]}"
APP_PATH="$(find "$ELECTRON_DIST_DIR" -maxdepth 3 -type d -name 'Vyact.app' -print -quit)"

if [ -z "$APP_PATH" ]; then
  echo "Vyact.app was not found in $ELECTRON_DIST_DIR." >&2
  exit 1
fi

echo "Verifying application signature and notarization ticket..."
codesign --verify --deep --strict --verbose=2 "$APP_PATH"
spctl --assess --type exec --verbose=2 "$APP_PATH"
xcrun stapler validate "$APP_PATH"

echo "Verifying DMG signature..."
codesign --verify --strict --verbose=2 "$DMG_PATH"

echo "Submitting DMG for notarization..."
xcrun notarytool submit "$DMG_PATH" \
  --keychain-profile "$NOTARY_PROFILE" \
  --wait

echo "Stapling and validating the DMG notarization ticket..."
xcrun stapler staple "$DMG_PATH"
xcrun stapler validate "$DMG_PATH"
spctl --assess --type open --context context:primary-signature --verbose=2 "$DMG_PATH"

echo "Release DMG is signed, notarized, stapled, and verified:"
ls -lh "$DMG_PATH"
