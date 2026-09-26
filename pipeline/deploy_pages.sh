#!/usr/bin/env bash
# Publish dist/ to the gh-pages branch (GitHub Pages: Settings → Pages → Branch: gh-pages / root)
set -euo pipefail
cd "$(dirname "$0")/.."
REV="$(git rev-parse --short HEAD)"
URL="$(git remote get-url origin)"
TMP="$(mktemp -d)"
cp -r dist/. "$TMP/"
find "$TMP/img" -name meta.json -delete 2>/dev/null || true
cd "$TMP"
git init -q -b gh-pages
git add -A
git commit -qm "deploy: site from $REV"
git push -q -f "$URL" gh-pages
echo "deployed $REV → gh-pages"
