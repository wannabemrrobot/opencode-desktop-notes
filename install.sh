#!/bin/sh
# Installs opencode-desktop-notes into OpenCode's global plugin config.
# Usage: curl -fsSL https://raw.githubusercontent.com/wannabemrrobot/opencode-desktop-notes/main/install.sh | sh
set -eu

PKG="github:wannabemrrobot/opencode-desktop-notes"

find_cli() {
  if command -v opencode >/dev/null 2>&1; then
    echo opencode
    return
  fi
  # OpenCode Desktop ships its own CLI but doesn't put it on PATH.
  latest=""
  for dir in \
    "$HOME/Library/Application Support/ai.opencode.desktop/cli" \
    "${XDG_CONFIG_HOME:-$HOME/.config}/ai.opencode.desktop/cli"; do
    for cli in "$dir"/*/opencode-cli; do
      [ -x "$cli" ] && latest="$cli"
    done
  done
  [ -n "$latest" ] && echo "$latest"
}

CLI=$(find_cli || true)
if [ -z "$CLI" ]; then
  cat >&2 <<MSG
Could not find the OpenCode CLI.

Install OpenCode Desktop (https://opencode.ai) and open it once, or install the CLI.
Then run this again, or add the plugin by hand to ~/.config/opencode/opencode.json(c):

  { "plugins": ["$PKG"] }
MSG
  exit 1
fi

echo "Using $CLI"
"$CLI" plugin add "$PKG"
echo
echo "Done. In OpenCode Desktop, open a session, press + in the side panel and pick \"Session notes\"."
echo "If it doesn't show up, run /reload or check Settings > Extensions > Plugins."
