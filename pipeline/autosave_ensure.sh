#!/usr/bin/env bash
# Idempotent: starts the autosave daemon (pipeline/autosave.sh) under pm2 if it isn't running.
# Called automatically by git hooks (post-commit / post-checkout / post-merge / post-rewrite),
# so a sandbox reset that killed pm2 self-heals on the very next git operation.
#
#   pipeline/autosave_ensure.sh                     # start if not running
#   pipeline/autosave_ensure.sh --install-hooks     # + install the self-healing git hooks
#   pipeline/autosave_ensure.sh --agent B           # + remember this sandbox's agent id (.git/agent-id)
#   pipeline/autosave_ensure.sh --status            # show daemon state + last log lines
cd "$(dirname "$0")/.." || exit 0
ROOT="$(pwd)"
NAME="autosave"
while [ $# -gt 0 ]; do
  case "$1" in
    --agent) shift; printf '%s\n' "${1:-}" | tr '[:lower:]' '[:upper:]' > "$ROOT/.git/agent-id"; echo "agent id: $(cat "$ROOT/.git/agent-id")";;
    --install-hooks)
      for h in post-commit post-checkout post-merge post-rewrite; do
        cat > "$ROOT/.git/hooks/$h" <<'EOF'
#!/usr/bin/env bash
# installed by pipeline/autosave_ensure.sh — keep the autosave daemon alive
"$(git rev-parse --show-toplevel)/pipeline/autosave_ensure.sh" >/dev/null 2>&1 &
exit 0
EOF
        chmod +x "$ROOT/.git/hooks/$h"
      done
      echo "hooks installed";;
    --status)
      pm2 describe "$NAME" 2>/dev/null | grep -E "status|uptime|restarts" | head -4
      tail -n 8 "$ROOT/.cache/autosave.log" 2>/dev/null; exit 0;;
  esac
  shift
done
chmod +x "$ROOT"/pipeline/*.sh 2>/dev/null
git config merge.ours.driver true 2>/dev/null     # .gitattributes: generated files keep ours on conflict → rebuild

if ! command -v pm2 >/dev/null 2>&1; then
  # no pm2: a nohup loop guarded by a pid file
  PID="$ROOT/.git/autosave.pid"
  if [ -f "$PID" ] && kill -0 "$(cat "$PID")" 2>/dev/null; then exit 0; fi
  nohup "$ROOT/pipeline/autosave.sh" >/dev/null 2>&1 & echo $! > "$PID"
  echo "autosave daemon started (nohup, pid $!)"; exit 0
fi
pid="$(pm2 pid "$NAME" 2>/dev/null | tr -d '[:space:]')"
if [ -n "$pid" ] && [ "$pid" != "0" ] && kill -0 "$pid" 2>/dev/null; then
  exit 0
fi
pm2 delete "$NAME" >/dev/null 2>&1
pm2 start "$ROOT/pipeline/autosave.sh" --name "$NAME" --interpreter bash \
  --restart-delay 5000 --max-restarts 100000 -- "${AUTOSAVE_INTERVAL:-180}" >/dev/null 2>&1
pm2 save >/dev/null 2>&1
echo "autosave daemon started under pm2 ($(pm2 pid "$NAME" 2>/dev/null))"
