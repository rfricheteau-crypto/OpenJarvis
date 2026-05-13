#!/usr/bin/env bash
set -euo pipefail

STAMP="$(date +%Y%m%d-%H%M%S)"
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
LOG_DIR="$ROOT/logs/maintenance"
LOG_FILE="$LOG_DIR/second_pass_cleanup_${STAMP}.log"
QUARANTINE="${HOME}/Jarvis_Quarantine/second_pass_${STAMP}"

mkdir -p "$LOG_DIR" "$QUARANTINE"

log() {
  printf '%s %s\n' "$(date '+%Y-%m-%d %H:%M:%S')" "$*" | tee -a "$LOG_FILE"
}

size_k() {
  local path="$1"
  if [[ -e "$path" ]]; then
    du -sk "$path" 2>/dev/null | awk '{print $1}'
  else
    printf '0'
  fi
}

remove_path() {
  local path="$1"
  local label="$2"
  if [[ -e "$path" ]]; then
    local k
    k="$(size_k "$path")"
    log "REMOVE label=$label size_k=$k path=$path"
    rm -rf "$path"
  else
    log "REMOVE_SKIP_MISSING label=$label path=$path"
  fi
}

quarantine_path() {
  local path="$1"
  local label="$2"
  if [[ -e "$path" ]]; then
    local k base dest_dir dest
    k="$(size_k "$path")"
    base="$(basename "$path")"
    dest_dir="$QUARANTINE/$label"
    dest="$dest_dir/$base"
    mkdir -p "$dest_dir"
    log "QUARANTINE label=$label size_k=$k from=$path to=$dest"
    mv "$path" "$dest"
  else
    log "QUARANTINE_SKIP_MISSING label=$label path=$path"
  fi
}

log "START second pass cleanup"
log "Log file: $LOG_FILE"
log "Quarantine: $QUARANTINE"
log "Explicit exclusions: Claude/vm_bundles, Chrome OptGuideOnDeviceModel, Qwen local model, PDFs, credentials JSON."
df -h /System/Volumes/Data | tee -a "$LOG_FILE"

log "STEP 1: permanently remove explicitly approved paths"
remove_path "${HOME}/Jarvis_Quarantine/mac_pressure_20260423-171911" "approved_old_mail_log_quarantine"
remove_path "${HOME}/Downloads/IMG_2308.MOV" "approved_personal_video"
remove_path "${HOME}/Downloads/IMG_2307.MOV" "approved_personal_video"
remove_path "${HOME}/Downloads/IMG_2309.MOV" "approved_personal_video"
remove_path "${HOME}/Downloads/IMG_2310.MOV" "approved_personal_video"

log "STEP 2: remove safe recreable caches and build artifacts"
remove_path "${HOME}/Library/Caches/com.openai.atlas" "recreable_cache_openai_atlas"
remove_path "${HOME}/Library/Caches/typescript" "recreable_cache_typescript"
remove_path "${HOME}/Library/Caches/node-gyp" "recreable_cache_node_gyp"
remove_path "${HOME}/Library/Application Support/Google/GoogleUpdater/crx_cache" "recreable_cache_google_updater_crx"
remove_path "${HOME}/Library/Application Support/Code/CachedExtensionVSIXs" "recreable_cache_vscode_vsix"
remove_path "${HOME}/Jarvis/OpenJarvis/rust/target" "recreable_build_openjarvis_rust_target"
remove_path "${HOME}/n8n-boost/n8n-mcp/node_modules" "recreable_node_modules_n8n_mcp"
remove_path "${HOME}/n8n-boost/haunchen-n8n-skills/node_modules" "recreable_node_modules_n8n_skills"

log "STEP 3: quarantine approved installers and temporary media"
# DMG/PKG installers only. No PDFs, JSON credentials, or personal documents.
quarantine_path "${HOME}/Downloads/Installers/Claude (1).dmg" "installers_duplicate_claude_exact_hash"
quarantine_path "${HOME}/Downloads/Duplicates_To_Review/Claude (2).dmg" "installers_duplicate_claude_exact_hash"
quarantine_path "${HOME}/Downloads/Duplicates_To_Review/Claude (3).dmg" "installers_duplicate_claude_exact_hash"
quarantine_path "${HOME}/Downloads/Installers/Claude.dmg" "installers_recreable"
quarantine_path "${HOME}/Downloads/Installateurs/Claude.dmg" "installers_recreable"
quarantine_path "${HOME}/Downloads/Obsidian-1.12.7.dmg" "installers_recreable"
quarantine_path "${HOME}/Downloads/Installateurs/Zoom.pkg" "installers_recreable"

# Keep the Messages draft as reference; quarantine only the MobileSMS temporary duplicate.
quarantine_path "${HOME}/Library/Containers/com.apple.MobileSMS/Data/tmp/TemporaryItems/com.apple.MobileSMS/LinkedFiles/23DFA9D1-52CE-4A31-983B-7EAF4E8F8DCE/Joyeux Anniversaire Taméra.mp4" "messages_tmp_duplicate_media"
quarantine_path "${HOME}/Library/Containers/com.apple.MobileSMS/Data/tmp/TemporaryItems/com.apple.MobileSMS/Media/B5581ECE-F760-4962-918A-057C3CF3AFED/invideo-ai-1080 Découvre la Puissance de la Numérologie 2025-05-31.mp4" "messages_tmp_parasite_media"

log "FINAL disk state"
df -h /System/Volumes/Data | tee -a "$LOG_FILE"
du -sh "$QUARANTINE" 2>/dev/null | tee -a "$LOG_FILE"
log "DONE second pass cleanup"
