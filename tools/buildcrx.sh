#!/bin/bash

npm run build || exit 1

mkdir dist_crx
cd dist_crx

rm -rf tabverse
mkdir tabverse
cp -rv ../dist/_locales tabverse/
mkdir tabverse/assets
cp -rv ../dist/generated/prod/* tabverse/assets/
rm -rv tabverse/assets/*.map
cp -rv ../dist/icons tabverse/
cp -rv ../dist/static tabverse/
cp -v ../dist/backgroundWrapper.js tabverse/
cp -v ../dist/manager.html tabverse/
cp -v ../dist/manifest.json tabverse/
cp -v ../dist/popup.html tabverse/

rm -v tabverse.zip
rm -v tabverse.crx

zip -r tabverse.zip tabverse/*

MACOS_CHROME="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
if [ -f "$MACOS_CHROME" ]; then
  TABVERSE_DIST="$(pwd)/tabverse"
  TABVERSE_DIST_KEY="$(pwd)/tabverse.pem"
  "$MACOS_CHROME" --pack-extension="${TABVERSE_DIST}" --pack-extension-key="${TABVERSE_DIST_KEY}"
fi

cd -
