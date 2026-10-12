#!/usr/bin/env bash
# Builds DIABASS 6 and installs it on Linux Mint / Ubuntu: a menu entry, the USB rules and serial-port permission.
set -euo pipefail
cd "$(dirname "$0")/.."
echo "== System packages =="
sudo apt-get install -y build-essential pkg-config curl nodejs npm libwebkit2gtk-4.1-dev libgtk-3-dev libsoup-3.0-dev libudev-dev librsvg2-dev libayatana-appindicator3-dev
if ! command -v cargo >/dev/null 2>&1; then
  echo "== Installing Rust =="; curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh -s -- -y
fi
# shellcheck disable=SC1091
[ -f "$HOME/.cargo/env" ] && . "$HOME/.cargo/env"
echo "== Building =="; npm install && npm run tauri build
echo "== Installing =="; sudo apt-get install -y ./src-tauri/target/release/bundle/deb/*.deb
sudo usermod -aG dialout "$USER" || true
echo
echo "Done. Unplug and replug the meter cable. If a serial port is refused, log out and in once."
echo "Start DIABASS 6 from the applications menu."
