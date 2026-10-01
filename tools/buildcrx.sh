#!/bin/bash
# Builds the store package: production bundle + zip (and a .crx on macOS
# where a Chrome binary with the signing key is available).
set -e

pnpm run build || exit 1

mkdir -p dist_crx
cd dist_crx

rm -rf tabverse
mkdir tabverse

# copy the whole generated extension (manifest, pages, assets, icons, locales)
cp -R ../dist/. tabverse/
# source maps must never ship in the store package
find tabverse -name '*.map' -delete

rm -f tabverse.zip tabverse.crx
zip -qr tabverse.zip tabverse

MACOS_CHROME="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
if [ -f "$MACOS_CHROME" ]; then
  TABVERSE_DIST="$(pwd)/tabverse"
  TABVERSE_DIST_KEY="$(pwd)/tabverse.pem"
  "$MACOS_CHROME" --pack-extension="${TABVERSE_DIST}" --pack-extension-key="${TABVERSE_DIST_KEY}"
fi

cd -
