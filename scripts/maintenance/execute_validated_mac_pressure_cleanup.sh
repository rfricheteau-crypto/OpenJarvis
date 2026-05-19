#!/usr/bin/env bash
set -euo pipefail

STAMP="$(date +%Y%m%d-%H%M%S)"
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
LOG_DIR="$ROOT/logs/maintenance"
LOG_FILE="$LOG_DIR/mac_pressure_cleanup_${STAMP}.log"
QUARANTINE="${HOME}/Jarvis_Quarantine/mac_pressure_${STAMP}"

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

log "START validated cleanup"
log "Log file: $LOG_FILE"
log "Quarantine: $QUARANTINE"
log "No Downloads personal files are touched by this script."
df -k /System/Volumes/Data | tee -a "$LOG_FILE"

MAIL_LOG_DIR="${HOME}/Library/Containers/com.apple.mail/Data/Library/Logs/Mail"
MAIL_Q="$QUARANTINE/mail_logs"
mkdir -p "$MAIL_Q"

log "STEP 1: quarantine and compress Mail logs >100M"
if [[ "${SKIP_MAIL:-0}" == "1" ]]; then
  log "MAIL_STEP_SKIPPED reason=SKIP_MAIL"
elif [[ -d "$MAIL_LOG_DIR" ]]; then
  while IFS= read -r -d '' file; do
    before_k="$(size_k "$file")"
    base="$(basename "$file")"
    dest="$MAIL_Q/$base"
    log "MAIL_LOG_MOVE size_k=$before_k from=$file to=$dest"
    mv "$file" "$dest"
    log "MAIL_LOG_GZIP_START path=$dest"
    gzip -1 "$dest"
    compressed="${dest}.gz"
    gzip -t "$compressed"
    after_k="$(size_k "$compressed")"
    log "MAIL_LOG_GZIP_DONE compressed_size_k=$after_k path=$compressed"
  done < <(find "$MAIL_LOG_DIR" -type f -size +100M -print0 | sort -z)
else
  log "MAIL_LOG_DIR_MISSING path=$MAIL_LOG_DIR"
fi

SMS_TMP="${HOME}/Library/Containers/com.apple.MobileSMS/Data/tmp/TemporaryItems/com.apple.MobileSMS"
SMS_Q="$QUARANTINE/messages_tmp_duplicate_manifest"
mkdir -p "$SMS_Q"
HASH_MANIFEST="$SMS_Q/joyeux_anniversaire_tamera_hashes.tsv"
REMOVED_MANIFEST="$SMS_Q/joyeux_anniversaire_tamera_removed.tsv"
KEPT_MANIFEST="$SMS_Q/joyeux_anniversaire_tamera_kept.tsv"
: > "$HASH_MANIFEST"
: > "$REMOVED_MANIFEST"
: > "$KEPT_MANIFEST"

log "STEP 2: Messages temporary duplicate video handling"
if [[ -d "$SMS_TMP" ]]; then
  CANDIDATE_LIST="$SMS_Q/joyeux_anniversaire_tamera_candidates.null"
  find "$SMS_TMP" -type f -name '*.mp4' -size +100M -print0 |
    while IFS= read -r -d '' f; do
      b="$(basename "$f")"
      if [[ "$b" == *Joyeux*Anniversaire*Tame*ra.mp4 ]]; then
        printf '%s\0' "$f"
      fi
    done |
    sort -z > "$CANDIDATE_LIST"

  candidate_count="$(tr -cd '\0' < "$CANDIDATE_LIST" | wc -c | tr -d ' ')"
  log "MESSAGES_VIDEO_CANDIDATE_COUNT count=$candidate_count"
  if (( candidate_count > 0 )); then
    while IFS= read -r -d '' f; do
      bytes="$(stat -f '%z' "$f")"
      hash="$(shasum -a 256 "$f" | awk '{print $1}')"
      printf '%s\t%s\t%s\n' "$hash" "$bytes" "$f" >> "$HASH_MANIFEST"
    done < "$CANDIDATE_LIST"

    # Keep the first path per exact hash, remove only exact duplicate temporary files.
    awk -F '\t' '!seen[$1]++ {print $0}' "$HASH_MANIFEST" > "$KEPT_MANIFEST"
    while IFS=$'\t' read -r hash bytes path; do
      keep_path="$(awk -F '\t' -v h="$hash" '$1 == h {print $3; exit}' "$KEPT_MANIFEST")"
      if [[ "$path" == "$keep_path" ]]; then
        log "MESSAGES_VIDEO_KEEP hash=$hash bytes=$bytes path=$path"
      else
        log "MESSAGES_VIDEO_REMOVE_DUPLICATE hash=$hash bytes=$bytes path=$path"
        printf '%s\t%s\t%s\n' "$hash" "$bytes" "$path" >> "$REMOVED_MANIFEST"
        rm -f "$path"
      fi
    done < "$HASH_MANIFEST"
  fi
else
  log "SMS_TMP_MISSING path=$SMS_TMP"
fi

log "STEP 3: remove recreable caches only"
remove_cache() {
  local path="$1"
  if [[ -e "$path" ]]; then
    before_k="$(size_k "$path")"
    log "CACHE_REMOVE size_k=$before_k path=$path"
    rm -rf "$path"
  else
    log "CACHE_SKIP_MISSING path=$path"
  fi
}

remove_cache "${HOME}/.npm/_npx"
remove_cache "${HOME}/.npm/_cacache"
remove_cache "${HOME}/.cache/uv"
remove_cache "${HOME}/Library/Caches/Google/Chrome"
remove_cache "${HOME}/Library/Caches/com.microsoft.VSCode.ShipIt"
remove_cache "${HOME}/Library/Caches/Homebrew/downloads"

TMP_ROOT="/var/folders/jd/25lfydtd11q47p5zv9870cg00000gn/T"
if [[ -d "$TMP_ROOT" ]]; then
  shopt -s nullglob
  for path in "$TMP_ROOT"/com.microsoft.VSCode.ShipIt.*; do
    remove_cache "$path"
  done
  shopt -u nullglob
fi

log "FINAL disk state"
df -k /System/Volumes/Data | tee -a "$LOG_FILE"
du -sh "$QUARANTINE" 2>/dev/null | tee -a "$LOG_FILE"
log "DONE validated cleanup"
