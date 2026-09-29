#!/usr/bin/env bash
# Idempotent: starts the autosave daemon under pm2 if it isn't running.
# Called automatically by git hooks (post-commit / post-checkout / post-merge),
# so a sandbox reset that killed pm2 self-heals on the next git operation.
#   usage: pipeline/autosave_ensure.sh [--install-hooks]
cd "$(dirname "$0")/.." || exit 0
ROOT="$(pwd)"
NAME="autosave"

if [ "${1:-}" = "--install-hooks" ]; then
  for h in post-commit post-checkout post-merge post-rewrite; do
    cat > "$ROOT/.git/hooks/$h" <<'EOF'
#!/usr/bin/env bash
# installed by pipeline/autosave_ensure.sh — keep the autosave daemon alive
"$(git rev-parse --show-toplevel)/pipeline/autosave_ensure.sh" >/dev/null 2>&1 &
exit 0
EOF
    chmod +x "$ROOT/.git/hooks/$h"
  done
  echo "hooks installed"
fi

command -v pm2 >/dev/null 2>&1 || { nohup "$ROOT/pipeline/autosave.sh" >/dev/null 2>&1 & exit 0; }
if pm2 jlist 2>/dev/null | grep -q "\"name\":\"$NAME\".*\"status\":\"online\""; then
  exit 0
fi
pm2 delete "$NAME" >/dev/null 2>&1
pm2 start "$ROOT/pipeline/autosave.sh" --name "$NAME" --interpreter bash \
  --restart-delay 5000 --max-restarts 1000 -- "${AUTOSAVE_INTERVAL:-180}" >/dev/null 2>&1
pm2 save >/dev/null 2>&1
echo "autosave daemon started under pm2"
