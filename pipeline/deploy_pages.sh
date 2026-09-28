#!/usr/bin/env bash
# Publish dist/ to the gh-pages branch (GitHub Pages: Settings → Pages → Branch: gh-pages / root)
set -euo pipefail
cd "$(dirname "$0")/.."
[ -f dist/index.html ] || { echo "dist/index.html missing — run python3 -m pipeline.run first" >&2; exit 1; }
REV="$(git rev-parse --short HEAD)"
DIRTY="$(git status --porcelain -- dist templates src data | head -1)"
URL="$(git remote get-url origin)"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT                         # the temp copy (≈120 MB) was never cleaned up
cp -r dist/. "$TMP/"
find "$TMP/img" -name meta.json -delete 2>/dev/null || true
cd "$TMP"
git init -q && git checkout -q -b gh-pages
touch .nojekyll
# a fresh repo has no identity in CI / clean sandboxes → "Please tell me who you are" aborted the deploy
NAME="$(git -C "$OLDPWD" config user.name || echo deploy-bot)"
MAIL="$(git -C "$OLDPWD" config user.email || echo deploy@localhost)"
git add -A
git -c user.name="$NAME" -c user.email="$MAIL" commit -qm "deploy: site from $REV${DIRTY:+ (+uncommitted changes)}"
git push -q -f "$URL" gh-pages
echo "deployed $REV → gh-pages"
