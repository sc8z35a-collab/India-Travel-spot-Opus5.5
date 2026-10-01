#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# One-command setup for a collaborating agent's sandbox.
#
#   pipeline/agent_bootstrap.sh B        # (run inside /home/user/webapp, after setup_github_environment)
#
# What it does (idempotent — safe to re-run after every sandbox reset):
#   1. remembers the agent id in .git/agent-id (local only)
#   2. switches to the agent's work branch  agent/<id>  (created from origin/genspark_ai_developer;
#      agent A works directly on genspark_ai_developer)
#   3. creates the shared collaboration worktree  .collab/  (branch `collab`)
#   4. installs the self-healing git hooks + starts the 3-min autosave daemon (pm2)
#   5. installs python deps + playwright chromium in the background (log: .cache/deps.log)
#   6. writes a first heartbeat to collab/status/<ID>.json
# ─────────────────────────────────────────────────────────────────────────────
set -u
cd "$(dirname "$0")/.." || exit 1
ROOT="$(pwd)"
ID="$(printf '%s' "${1:-${AGENT_ID:-}}" | tr '[:lower:]' '[:upper:]')"
[ -n "$ID" ] || { echo "usage: pipeline/agent_bootstrap.sh <A|B|C|D>"; exit 2; }
export GIT_TERMINAL_PROMPT=0
mkdir -p .cache
echo "$ID" > .git/agent-id
git config merge.ours.driver true
git config pull.rebase true
git config rebase.autoStash true
git config core.quotepath false          # Japanese file names readable in git status
git config http.postBuffer 524288000     # big image pushes
git fetch -q origin --prune || { echo "fetch failed — run setup_github_environment first"; exit 1; }

if [ "$ID" = "A" ]; then BR="genspark_ai_developer"; else BR="agent/$(echo "$ID" | tr '[:upper:]' '[:lower:]')"; fi
cur="$(git rev-parse --abbrev-ref HEAD)"
if [ "$cur" != "$BR" ]; then
  [ -n "$(git status --porcelain)" ] && git stash push -u -q -m "bootstrap-$(date +%s)" && echo "local changes stashed"
  if git show-ref -q --verify "refs/heads/$BR"; then git checkout -q "$BR"
  elif git ls-remote --exit-code --heads origin "$BR" >/dev/null 2>&1; then git checkout -q -b "$BR" "origin/$BR"
  else git checkout -q -b "$BR" origin/genspark_ai_developer; fi
fi
echo "branch: $(git rev-parse --abbrev-ref HEAD)"

# shared collaboration worktree
if git ls-remote --exit-code --heads origin collab >/dev/null 2>&1; then
  git fetch -q origin collab:refs/remotes/origin/collab
  if [ ! -e .collab/.git ]; then git worktree prune; git worktree add -q -B collab .collab origin/collab; fi
  (cd .collab && git pull -q --rebase origin collab 2>/dev/null || true)
  echo "collab worktree: .collab/  (read .collab/README.md first)"
fi

pipeline/autosave_ensure.sh --install-hooks >/dev/null
pipeline/autosave_ensure.sh
pipeline/autosave.sh --once
echo "autosave: $(pm2 pid autosave 2>/dev/null | tr -d '[:space:]') (log .cache/autosave.log)"

if ! python3 -c "import playwright" 2>/dev/null; then
  ( pip install -q jinja2 pillow pillow-heif requests beautifulsoup4 onnxruntime numpy openai pyyaml playwright \
    && python3 -m playwright install --with-deps chromium; echo "DEPS DONE rc=$?" ) > .cache/deps.log 2>&1 &
  echo "deps installing in background → tail .cache/deps.log"
fi
echo "ready: agent $ID on $BR"
