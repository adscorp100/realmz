#!/usr/bin/env bash
# Publishes build_web/ to the gh-pages branch of a GitHub repo.
#
#   scripts/deploy_pages.sh <owner/repo>
#
# Run scripts/build_web.sh first. The branch is replaced on every deploy (it
# only ever holds the latest build), so the repo doesn't accumulate copies
# of the 52 MB data file.
set -euo pipefail

REPO="${1:?usage: deploy_pages.sh <owner/repo>}"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
BUILD="$ROOT/build_web"
STAGE="$(mktemp -d)"
trap 'rm -rf "$STAGE"' EXIT

for f in index.html realmz-web.css realmz-web.js sw.js manifest.webmanifest \
         icon-192.png icon-512.png stone.png Realmz.js Realmz.wasm Realmz.data; do
  cp "$BUILD/$f" "$STAGE/"
done
cp -R "$BUILD/fonts" "$STAGE/fonts"
touch "$STAGE/.nojekyll"
cp "$ROOT/LICENSE" "$STAGE/LICENSE"

BUILD_ID="$(grep -o 'REALMZ_BUILD = "[0-9]*"' "$STAGE/index.html" | grep -o '[0-9]*')"

git -C "$STAGE" init -q -b gh-pages
git -C "$STAGE" add -A
git -C "$STAGE" -c user.name="$(git -C "$ROOT" config user.name || echo Realmz)" \
  -c user.email="$(git -C "$ROOT" config user.email || echo realmz@localhost)" \
  commit -q -m "Deploy Realmz web build $BUILD_ID"
git -C "$STAGE" push -q -f "https://github.com/$REPO.git" gh-pages

echo "Pushed build $BUILD_ID to $REPO gh-pages."
