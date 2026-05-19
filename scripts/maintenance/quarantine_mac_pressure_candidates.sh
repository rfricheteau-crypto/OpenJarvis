#!/usr/bin/env bash
set -euo pipefail

MODE="${1:---dry-run}"
STAMP="$(date +%Y%m%d-%H%M%S)"
QUARANTINE="${HOME}/Jarvis_Quarantine/mac_pressure_${STAMP}"

if [[ "$MODE" != "--dry-run" && "$MODE" != "--execute" ]]; then
  echo "Usage: $0 [--dry-run|--execute]" >&2
  exit 2
fi

move_candidate() {
  local path="$1"
  local label="$2"
  if [[ ! -e "$path" ]]; then
    echo "SKIP missing: $path"
    return 0
  fi

  local size
  size="$(du -sh "$path" 2>/dev/null | awk '{print $1}')"
  echo "CANDIDATE [$label] $size $path"

  if [[ "$MODE" == "--execute" ]]; then
    mkdir -p "$QUARANTINE/$label"
    mv "$path" "$QUARANTINE/$label/"
    echo "MOVED to $QUARANTINE/$label/"
  fi
}

echo "Mode: $MODE"
echo "Quarantine target: $QUARANTINE"
echo "No permanent deletion is performed by this script."
echo

# Mail logs: technical logs, not mail messages. Close Mail before executing.
MAIL_LOG_DIR="${HOME}/Library/Containers/com.apple.mail/Data/Library/Logs/Mail"
if [[ -d "$MAIL_LOG_DIR" ]]; then
  while IFS= read -r -d '' file; do
    move_candidate "$file" "mail_logs"
  done < <(find "$MAIL_LOG_DIR" -type f -size +100M -print0)
fi

# Messages temporary media. Close Messages before executing.
SMS_TMP="${HOME}/Library/Containers/com.apple.MobileSMS/Data/tmp/TemporaryItems/com.apple.MobileSMS"
if [[ -d "$SMS_TMP" ]]; then
  while IFS= read -r -d '' file; do
    move_candidate "$file" "messages_tmp_large_media"
  done < <(find "$SMS_TMP" -type f -size +100M -print0)
fi

# Large Downloads media: quarantine only after explicit validation.
DOWNLOADS="${HOME}/Downloads"
if [[ -d "$DOWNLOADS" ]]; then
  while IFS= read -r -d '' file; do
    move_candidate "$file" "downloads_large_media"
  done < <(find "$DOWNLOADS" -maxdepth 1 -type f \( -iname '*.mov' -o -iname '*.mp4' \) -size +100M -print0)
fi

echo
if [[ "$MODE" == "--dry-run" ]]; then
  echo "Dry run complete. Re-run with --execute only after explicit validation."
else
  echo "Quarantine complete: $QUARANTINE"
fi
