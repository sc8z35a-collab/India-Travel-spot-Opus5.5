#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# Autosave daemon — protects work in volatile sandboxes.
#
# Every INTERVAL seconds (default 180 = 3 min):
#   1. if the working tree changed → WIP commit (files > 95 MB are skipped)
#   2. push the current branch to origin
#   3. make sure an OPEN pull request exists for the branch (creates one if not)
#
# Safety:
#   • flock on .git/autosave.lock  → never races a manual git operation
#     (wrap your own git work with:  pipeline/gitlock.sh <git command...>)
#   • skips during merge / rebase / cherry-pick / detached HEAD
#   • push rejected (remote moved) → fetch + rebase only if it applies cleanly,
#     otherwise abort the rebase and retry next cycle (never force-pushes)
#
# Run it managed (auto-restart on crash):   pipeline/autosave_ensure.sh
# Run it in the foreground (debug):          pipeline/autosave.sh 180
# ─────────────────────────────────────────────────────────────────────────────
set -u
cd "$(dirname "$0")/.." || exit 1
ROOT="$(pwd)"
INTERVAL="${1:-${AUTOSAVE_INTERVAL:-180}}"
BASE="${AUTOSAVE_BASE:-main}"
LOG="$ROOT/.cache/autosave.log"
LOCK="$ROOT/.git/autosave.lock"
MAX_BYTES=$((95 * 1024 * 1024))
mkdir -p "$ROOT/.cache"

log() { echo "[$(date '+%F %T')] $*" | tee -a "$LOG"; }

in_git_operation() {
  local g="$ROOT/.git"
  [ -e "$g/MERGE_HEAD" ] || [ -d "$g/rebase-merge" ] || [ -d "$g/rebase-apply" ] \
    || [ -e "$g/CHERRY_PICK_HEAD" ] || [ -e "$g/REVERT_HEAD" ]
}

skip_huge_files() {
  # untrack/unstage anything GitHub would reject (100 MB hard limit)
  git ls-files -mo --exclude-standard -z 2>/dev/null | while IFS= read -r -d '' f; do
    [ -f "$f" ] || continue
    local sz; sz=$(stat -c %s "$f" 2>/dev/null || echo 0)
    if [ "$sz" -gt "$MAX_BYTES" ]; then
      git reset -q -- "$f" 2>/dev/null
      log "skipped huge file ($((sz/1024/1024)) MB): $f"
    fi
  done
}

ensure_pr() {
  local br="$1"
  command -v gh >/dev/null 2>&1 || return 0
  local n
  n=$(gh pr list --head "$br" --state open --json number --jq 'length' 2>/dev/null || echo "?")
  if [ "$n" = "0" ]; then
    local url
    url=$(gh pr create --base "$BASE" --head "$br" \
      --title "wip(autosave): ${br} — work in progress" \
      --body "自動保存システム (pipeline/autosave.sh) が作成したPRです。作業完了時に squash され、正式なタイトル・説明に更新されます。" 2>&1) \
      && log "opened PR: $url" || log "PR create failed: $(echo "$url" | tail -1)"
  fi
}

cycle() {
  local br
  br="$(git rev-parse --abbrev-ref HEAD 2>/dev/null)" || return
  [ "$br" = "HEAD" ] && { log "detached HEAD — skipped"; return; }
  [ "$br" = "$BASE" ] && { log "on base branch '$BASE' — skipped"; return; }
  in_git_operation && { log "merge/rebase in progress — skipped"; return; }

  if [ -n "$(git status --porcelain 2>/dev/null)" ]; then
    git add -A >/dev/null 2>&1
    skip_huge_files
    if ! git diff --cached --quiet 2>/dev/null; then
      git commit -q --no-verify -m "wip(autosave): snapshot $(date '+%F %T')" >/dev/null 2>&1 \
        && log "committed snapshot ($(git diff --stat HEAD~1 2>/dev/null | tail -1 | xargs))"
    fi
  fi

  local ahead
  ahead=$(git rev-list --count "origin/${br}..${br}" 2>/dev/null || echo new)
  if [ "$ahead" != "0" ]; then
    if git push -q -u origin "$br" >/dev/null 2>&1; then
      log "pushed ${br} (${ahead} commit(s))"
    else
      log "push rejected — trying fetch + clean rebase"
      git fetch -q origin "$br" 2>/dev/null
      if git rebase -q "origin/${br}" >/dev/null 2>&1; then
        git push -q -u origin "$br" >/dev/null 2>&1 && log "pushed after rebase" || log "push failed again"
      else
        git rebase --abort >/dev/null 2>&1
        log "rebase not clean — aborted, will retry next cycle"
      fi
    fi
  fi
  ensure_pr "$br"
}

log "autosave daemon started (pid $$, every ${INTERVAL}s, base=${BASE})"
while true; do
  (
    flock -w 60 9 || { log "lock busy — skipped this cycle"; exit 0; }
    cycle
  ) 9>"$LOCK"
  sleep "$INTERVAL"
done
