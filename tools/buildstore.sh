#!/bin/bash
# Builds the store package: the production bundle as a zip.
#
# The zip is what the Chrome Web Store dashboard takes, and what a person
# downloads from a release to install by hand - Chrome loads a *folder*, not a
# zip, so the steps are "extract it, then Load unpacked".
#
# No .crx is produced. Modern Chrome blocks installing an off-store .crx, and a
# self-signed one would carry a different extension id than the store build
# anyway, so it is a file nobody could use.
set -e

pnpm run build || exit 1

mkdir -p dist_store
cd dist_store

rm -rf tabverse
mkdir tabverse

# copy the whole generated extension (manifest, pages, assets, icons, locales)
cp -R ../dist/. tabverse/
# source maps must never ship in the store package
find tabverse -name '*.map' -delete

rm -f tabverse.zip
zip -qr tabverse.zip tabverse

cd -
