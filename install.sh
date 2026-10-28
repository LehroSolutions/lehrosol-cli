#!/usr/bin/env bash
# LehroSol CLI (alias: lehr-sol) installer — mirrors the curl-pipe pattern used by opencode/homebrew taps.
# Usage:
#   curl -fsSL https://get.lehro.dev/install | bash
# or, without network install, from a cloned repo:
#   bash install.sh --local
set -euo pipefail

REPO="lehrosolutions/lehrosol-cli"
INSTALL_DIR="${LEHRO_INSTALL_DIR:-$HOME/.lehro/bin}"

log() { printf '\033[1;36m[lehro]\033[0m %s\n' "$1"; }
fail() { printf '\033[1;31m[lehro]\033[0m %s\n' "$1" >&2; exit 1; }

command -v node >/dev/null 2>&1 || fail "Node.js 20+ is required. Install Node, then re-run this script."

NODE_MAJOR=$(node -e 'process.stdout.write(process.versions.node.split(".")[0])')
if [ "$NODE_MAJOR" -lt 20 ]; then
  fail "Node.js 20+ required, found $(node -v)."
fi

if [ "${1:-}" = "--local" ]; then
  log "Linking local checkout into $INSTALL_DIR"
  mkdir -p "$INSTALL_DIR"
  ln -sf "$(pwd)/bin/lehrosol.js" "$INSTALL_DIR/lehrosol"
  ln -sf "$(pwd)/bin/lehrosol.js" "$INSTALL_DIR/lehr-sol"
  chmod +x "$(pwd)/bin/lehrosol.js"
elif command -v bun >/dev/null 2>&1; then
  log "Installing via bun"
  bun install -g "$REPO"
elif command -v npm >/dev/null 2>&1; then
  log "Installing via npm"
  npm install -g "@lehrosolutions/cli@beta"
else
  fail "Neither bun nor npm found. Install one of them, or clone the repo and run: bash install.sh --local"
fi

log "Installed. Try: lehrosol --help  (short alias: lehr-sol --help)"
