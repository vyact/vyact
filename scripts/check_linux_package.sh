#!/usr/bin/env bash
# Run inside a disposable Debian/Ubuntu container, with artifacts at /packages.
set -euo pipefail
export DEBIAN_FRONTEND=noninteractive
apt-get update -qq
packages=(/packages/*.deb)
[[ ${#packages[@]} == 1 && -f "${packages[0]}" ]]
apt-get install -y --no-install-recommends "${packages[0]}"

resources=/opt/Vyact/resources
for executable in /opt/Vyact/vyact "$resources/python/bin/python3" "$resources/linux-runtime/llama-server"; do
  dependencies="$(ldd "$executable")"
  echo "$dependencies"
  if [[ "$dependencies" == *"not found"* ]]; then exit 1; fi
done
ELECTRON_RUN_AS_NODE=1 /opt/Vyact/vyact -e 'console.log(process.versions.electron)'
"$resources/python/bin/python3" --version
"$resources/python/bin/python3" -I -c 'import sys; sys.path.insert(0, "/opt/Vyact/resources/app"); from services.linux_dependencies import chromium_dependencies_available; assert chromium_dependencies_available(), "Chromium libraries are missing after DEB installation"'
"$resources/linux-runtime/llama-server" --version
"$resources/linux-runtime/llama-swap" --version
test -f "$resources/app/static/index.html"
