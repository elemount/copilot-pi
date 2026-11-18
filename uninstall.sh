#!/usr/bin/env bash
# Uninstall copilot-pi.
#   curl -fsSL https://raw.githubusercontent.com/elemount/copilot-pi/main/uninstall.sh | bash
set -euo pipefail

pi_home="${COPILOT_PI_HOME:-$HOME/.copilot/pi-mode}"
bin_dir="${COPILOT_PI_BIN_DIR:-$HOME/.local/bin}"

rm -f "$bin_dir/copilot-pi"
rm -rf "$pi_home"
printf 'copilot-pi: removed %s and %s\n' "$bin_dir/copilot-pi" "$pi_home"
