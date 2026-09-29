#!/usr/bin/env bash
# Run a git (or any) command while holding the autosave lock, so the
# autosave daemon can't snapshot in the middle of it.
#   usage: pipeline/gitlock.sh git rebase origin/main
cd "$(dirname "$0")/.." || exit 1
exec 9>"$(pwd)/.git/autosave.lock"
flock -w 120 9 || { echo "autosave lock busy" >&2; exit 1; }
"$@"
