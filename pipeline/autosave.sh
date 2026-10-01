#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# Autosave daemon v2 — protects work in volatile sandboxes (multi-agent aware).
#
# Every INTERVAL seconds (default 180 = 3 min), with ZERO manual action:
#   1. working tree changed → WIP commit on the CURRENT branch (files > 95 MB skipped)
#   2. push the branch to origin (never force; rebase only if it applies cleanly)
#   3. make sure an OPEN pull request exists for the branch
#        agent/<x>            → base genspark_ai_developer   (agent work branches)
#        genspark_ai_developer → base main                   (integration branch)
#   4. sync the shared collaboration branch `collab` (worktree .collab/):
#        pull everyone's notes, push this agent's own files + a heartbeat
#
# Safety:
#   • flock on .git/autosave.lock → never races a manual git operation
#     (wrap your own git work with:  pipeline/gitlock.sh <git command...>)
#   • skips during merge / rebase / cherry-pick / detached HEAD / on base branch `main`
#   • push rejected → fetch + rebase only if it applies cleanly, else abort & retry later
#   • each agent writes ONLY its own files in collab → collab rebases never conflict
#
# Identity: AGENT_ID env, else .git/agent-id (local, never committed), else derived
#           from the branch name (agent/b → B, genspark_ai_developer → A).
# Managed run (auto-restart, self-healing via git hooks): pipeline/autosave_ensure.sh
# Foreground debug run:                                     pipeline/autosave.sh 180
# One immediate cycle (e.g. before a risky command):        pipeline/autosave.sh --once
# ─────────────────────────────────────────────────────────────────────────────
set -u
cd "$(dirname "$0")/.." || exit 1
ROOT="$(pwd)"
ONCE=0; [ "${1:-}" = "--once" ] && { ONCE=1; shift; }
INTERVAL="${1:-${AUTOSAVE_INTERVAL:-180}}"
INTEGRATION="${AUTOSAVE_INTEGRATION:-genspark_ai_developer}"
MAINB="${AUTOSAVE_BASE:-main}"
LOG="$ROOT/.cache/autosave.log"
LOCK="$ROOT/.git/autosave.lock"
COLLAB="$ROOT/.collab"
MAX_BYTES=$((95 * 1024 * 1024))
mkdir -p "$ROOT/.cache"
export GIT_TERMINAL_PROMPT=0          # a missing credential must fail fast, never hang the daemon

log() { echo "[$(date '+%F %T')] $*" >> "$LOG"; [ -t 1 ] && echo "[$(date '+%T')] $*"; }
# keep the log bounded (a week of 3-min cycles is ~3k lines)
trim_log() { [ -f "$LOG" ] && [ "$(wc -l < "$LOG")" -gt 4000 ] && tail -n 2000 "$LOG" > "$LOG.tmp" && mv "$LOG.tmp" "$LOG"; }

agent_id() {
  if [ -n "${AGENT_ID:-}" ]; then echo "$AGENT_ID"; return; fi
  [ -s "$ROOT/.git/agent-id" ] && { tr -d '[:space:]' < "$ROOT/.git/agent-id"; return; }
  local br; br="$(git rev-parse --abbrev-ref HEAD 2>/dev/null)"
  case "$br" in agent/*) echo "${br#agent/}" | tr '[:lower:]' '[:upper:]';; "$INTEGRATION") echo A;; *) echo "X";; esac
}

in_git_operation() {
  local g="$ROOT/.git"
  [ -e "$g/MERGE_HEAD" ] || [ -d "$g/rebase-merge" ] || [ -d "$g/rebase-apply" ] \
    || [ -e "$g/CHERRY_PICK_HEAD" ] || [ -e "$g/REVERT_HEAD" ]
}

skip_huge_files() {
  # unstage anything GitHub would reject (100 MB hard limit)
  git diff --cached --name-only -z 2>/dev/null | while IFS= read -r -d '' f; do
    [ -f "$f" ] || continue
    local sz; sz=$(stat -c %s "$f" 2>/dev/null || echo 0)
    if [ "$sz" -gt "$MAX_BYTES" ]; then
      git reset -q -- "$f" 2>/dev/null
      log "skipped huge file ($((sz/1024/1024)) MB): $f"
    fi
  done
}

pr_base_for() { case "$1" in agent/*) echo "$INTEGRATION";; *) echo "$MAINB";; esac; }

ensure_pr() {
  local br="$1" base; base="$(pr_base_for "$br")"
  command -v gh >/dev/null 2>&1 || return 0
  # the base must exist remotely, otherwise gh errors every cycle
  git ls-remote --exit-code --heads origin "$base" >/dev/null 2>&1 || return 0
  local n
  n=$(timeout 40 gh pr list --head "$br" --base "$base" --state open --json number --jq 'length' 2>/dev/null || echo "?")
  if [ "$n" = "0" ]; then
    local url
    url=$(timeout 60 gh pr create --base "$base" --head "$br" \
      --title "wip(autosave/$(agent_id)): ${br} — work in progress" \
      --body "自動保存システム (pipeline/autosave.sh v2) が作成したPRです（3分ごとに自動push）。作業完了時に squash され、正式なタイトル・説明に更新されます。" 2>&1) \
      && log "opened PR ($br → $base): $url" \
      || { echo "$url" | grep -q "already exists" && log "PR already exists ($br → $base)" || log "PR create failed: $(echo "$url" | tail -1)"; }
  fi
}

save_branch() {
  local br
  br="$(git rev-parse --abbrev-ref HEAD 2>/dev/null)" || return
  [ "$br" = "HEAD" ] && { log "detached HEAD — skipped"; return; }
  [ "$br" = "$MAINB" ] && { log "on base branch '$MAINB' — skipped"; return; }
  in_git_operation && { log "merge/rebase in progress — skipped"; return; }

  if [ -n "$(git status --porcelain 2>/dev/null)" ]; then
    git add -A >/dev/null 2>&1
    skip_huge_files
    if ! git diff --cached --quiet 2>/dev/null; then
      git commit -q --no-verify -m "wip(autosave/$(agent_id)): snapshot $(date '+%F %T')" >/dev/null 2>&1 \
        && log "committed snapshot ($(git diff --stat HEAD~1 2>/dev/null | tail -1 | xargs))"
    fi
  fi

  local ahead
  ahead=$(git rev-list --count "origin/${br}..${br}" 2>/dev/null || echo new)
  if [ "$ahead" != "0" ]; then
    if timeout 300 git push -q -u origin "$br" >/dev/null 2>&1; then
      log "pushed ${br} (${ahead} commit(s))"
    else
      log "push rejected — trying fetch + clean rebase"
      timeout 120 git fetch -q origin "$br" 2>/dev/null
      if git rebase -q "origin/${br}" >/dev/null 2>&1; then
        timeout 300 git push -q -u origin "$br" >/dev/null 2>&1 && log "pushed after rebase" || log "push failed again"
      else
        git rebase --abort >/dev/null 2>&1
        log "rebase not clean — aborted, will retry next cycle (resolve manually: see collab/TROUBLESHOOTING.md)"
      fi
    fi
  fi
  ensure_pr "$br"
}

# ---- shared collaboration branch (worktree .collab/) -------------------------
sync_collab() {
  git ls-remote --exit-code --heads origin collab >/dev/null 2>&1 || return 0
  if [ ! -d "$COLLAB/.git" ] && [ ! -f "$COLLAB/.git" ]; then
    timeout 120 git fetch -q origin collab:refs/remotes/origin/collab 2>/dev/null || return 0
    git worktree prune 2>/dev/null
    git worktree add -q -B collab "$COLLAB" origin/collab >/dev/null 2>&1 || { log "collab worktree add failed"; return 0; }
    log "collab worktree created at .collab/"
  fi
  local id; id="$(agent_id)"
  (
    cd "$COLLAB" || exit 0
    [ -d .git/rebase-merge ] || [ -d .git/rebase-apply ] && git rebase --abort >/dev/null 2>&1
    # heartbeat: one tiny file per agent (no one else writes it → no conflicts)
    mkdir -p status
    local hb="status/${id}.json" br sha
    br="$(git -C "$ROOT" rev-parse --abbrev-ref HEAD 2>/dev/null)"; sha="$(git -C "$ROOT" rev-parse --short HEAD 2>/dev/null)"
    local prev_sha=""; [ -f "$hb" ] && prev_sha="$(sed -n 's/.*"head": *"\([^"]*\)".*/\1/p' "$hb")"
    local age=999999; [ -f "$hb" ] && age=$(( $(date +%s) - $(stat -c %Y "$hb") ))
    if [ "$sha" != "$prev_sha" ] || [ "$age" -gt 900 ]; then     # on new work, or every 15 min
      printf '{"agent": "%s", "branch": "%s", "head": "%s", "updated": "%s", "host": "%s"}\n' \
        "$id" "$br" "$sha" "$(date -u '+%FT%TZ')" "$(hostname)" > "$hb"
    fi
    git add -A >/dev/null 2>&1
    git diff --cached --quiet 2>/dev/null || git commit -q --no-verify -m "collab($id): sync $(date '+%F %T')" >/dev/null 2>&1
    timeout 120 git fetch -q origin collab 2>/dev/null
    if ! git rebase -q origin/collab >/dev/null 2>&1; then
      git rebase --abort >/dev/null 2>&1
      # someone edited a file we also touched: keep theirs, re-apply ours on top as an extra note
      log "collab rebase conflict — merging with -X theirs"
      git merge -q --no-edit -X theirs origin/collab >/dev/null 2>&1 || git merge --abort >/dev/null 2>&1
    fi
    if [ "$(git rev-list --count origin/collab..HEAD 2>/dev/null || echo 1)" != "0" ]; then
      if timeout 120 git push -q origin HEAD:collab >/dev/null 2>&1; then log "collab pushed"
      else timeout 60 git fetch -q origin collab 2>/dev/null; [ "$(git rev-list --count origin/collab..HEAD 2>/dev/null)" = "0" ] || log "collab push failed (retry next cycle)"; fi
    fi
  )
}

cycle() {
  save_branch
  sync_collab
  trim_log
}

run_locked() {
  (
    flock -w 60 9 || { log "lock busy — skipped this cycle"; exit 0; }
    cycle
  ) 9>"$LOCK"
}

if [ "$ONCE" = 1 ]; then run_locked; exit 0; fi
log "autosave daemon v2 started (pid $$, every ${INTERVAL}s, agent=$(agent_id), integration=${INTEGRATION})"
while true; do
  run_locked
  sleep "$INTERVAL"
done
