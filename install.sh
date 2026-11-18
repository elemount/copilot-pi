#!/usr/bin/env bash
# Install copilot-pi.
#   curl -fsSL https://raw.githubusercontent.com/elemount/copilot-pi/main/install.sh | bash
#
# Environment:
#   COPILOT_PI_HOME     plugin location (default: ~/.copilot/pi-mode)
#   COPILOT_PI_BIN_DIR  where the copilot-pi command goes (default: ~/.local/bin)
#   COPILOT_PI_REF      git branch or tag to install (default: main)
set -euo pipefail

repo="elemount/copilot-pi"
ref="${COPILOT_PI_REF:-main}"
pi_home="${COPILOT_PI_HOME:-$HOME/.copilot/pi-mode}"
bin_dir="${COPILOT_PI_BIN_DIR:-$HOME/.local/bin}"

say() { printf 'copilot-pi: %s\n' "$*"; }
die() { printf 'copilot-pi: %s\n' "$*" >&2; exit 1; }

command -v curl >/dev/null 2>&1 || die "curl is required"
command -v tar >/dev/null 2>&1 || die "tar is required"

tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT

say "downloading $repo@$ref"
curl -fsSL "https://codeload.github.com/$repo/tar.gz/$ref" | tar -xz -C "$tmp" --strip-components=1 \
  || die "download failed"

# Plugin and extension: always replaced, so updates apply.
mkdir -p "$pi_home"
rm -rf "$pi_home/plugin"
cp -R "$tmp/pi-mode/plugin" "$pi_home/plugin"

# System prompt: keep local edits; install the new default alongside.
if [[ -f "$pi_home/SYSTEM.md" ]] && ! cmp -s "$tmp/pi-mode/SYSTEM.md" "$pi_home/SYSTEM.md"; then
  cp "$tmp/pi-mode/SYSTEM.md" "$pi_home/SYSTEM.default.md"
  say "kept your edited $pi_home/SYSTEM.md (new default saved as SYSTEM.default.md)"
else
  cp "$tmp/pi-mode/SYSTEM.md" "$pi_home/SYSTEM.md"
fi

mkdir -p "$bin_dir"
install -m 0755 "$tmp/bin/copilot-pi" "$bin_dir/copilot-pi"

say "installed $bin_dir/copilot-pi"
say "plugin: $pi_home/plugin"

if ! command -v copilot >/dev/null 2>&1; then
  say "warning: GitHub Copilot CLI ('copilot') not found; install it: npm install -g @github/copilot"
fi
case ":$PATH:" in
  *":$bin_dir:"*) ;;
  *) say "warning: $bin_dir is not on PATH; add: export PATH=\"$bin_dir:\$PATH\"" ;;
esac

say "run: copilot-pi"
