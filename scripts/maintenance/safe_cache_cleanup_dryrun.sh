#!/usr/bin/env bash
set -euo pipefail

MODE="${1:---dry-run}"
if [[ "$MODE" != "--dry-run" && "$MODE" != "--execute" ]]; then
  echo "Usage: $0 [--dry-run|--execute]" >&2
  exit 2
fi

echo "Mode: $MODE"
echo "Targets are recreable caches only. Close Chrome, VS Code, Claude/Atlas and Node tools before --execute."
echo

remove_cache() {
  local path="$1"
  if [[ ! -e "$path" ]]; then
    echo "SKIP missing: $path"
    return 0
  fi

  local size
  size="$(du -sh "$path" 2>/dev/null | awk '{print $1}')"
  echo "CACHE $size $path"

  if [[ "$MODE" == "--execute" ]]; then
    rm -rf "$path"
    echo "REMOVED $path"
  fi
}

remove_cache "${HOME}/Library/Caches/Google/Chrome"
remove_cache "${HOME}/Library/Caches/com.microsoft.VSCode.ShipIt"
remove_cache "${HOME}/Library/Caches/com.openai.atlas/org.sparkle-project.Sparkle"
remove_cache "${HOME}/Library/Caches/com.openai.atlas/browser-data"
remove_cache "${HOME}/Library/Caches/Homebrew/downloads"
remove_cache "${HOME}/Library/Caches/typescript"
remove_cache "${HOME}/Library/Caches/node-gyp"
remove_cache "${HOME}/.cache/uv"
remove_cache "${HOME}/.npm/_npx"
remove_cache "${HOME}/.npm/_cacache"

# Project build outputs. Rebuild/reinstall needed after removal.
remove_cache "${HOME}/Jarvis/OpenJarvis/rust/target"
remove_cache "${HOME}/Jarvis/OpenJarvis/frontend/node_modules"

echo
if [[ "$MODE" == "--dry-run" ]]; then
  echo "Dry run complete. Re-run with --execute only after explicit validation."
else
  echo "Cache cleanup complete."
fi
