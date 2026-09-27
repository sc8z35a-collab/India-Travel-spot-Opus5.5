#!/usr/bin/env bash
# Autosave watchdog — protects work in volatile sandboxes.
# Every INTERVAL seconds: if the working tree changed, create a WIP commit
# and push the current branch to origin so nothing lives only on this disk.
#   usage: pipeline/autosave.sh [interval_seconds]   (default 300)
set -u
cd "$(dirname "$0")/.." || exit 1
INTERVAL="${1:-300}"
LOG=".cache/autosave.log"
mkdir -p .cache
echo "[$(date '+%F %T')] autosave started (every ${INTERVAL}s)" >> "$LOG"
while true; do
  sleep "$INTERVAL"
  BR="$(git rev-parse --abbrev-ref HEAD)"
  if [ -n "$(git status --porcelain)" ]; then
    git add -A >/dev/null 2>&1
    git commit -qm "wip(autosave): snapshot $(date '+%F %T')" >/dev/null 2>&1 \
      && echo "[$(date '+%F %T')] committed snapshot" >> "$LOG"
  fi
  if [ -n "$(git log "origin/${BR}..${BR}" --oneline 2>/dev/null || echo new)" ]; then
    git push -q -u origin "$BR" >/dev/null 2>&1 \
      && echo "[$(date '+%F %T')] pushed ${BR}" >> "$LOG" \
      || echo "[$(date '+%F %T')] push failed" >> "$LOG"
  fi
done
