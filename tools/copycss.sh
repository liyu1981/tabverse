#!/bin/bash

cp -v node_modules/normalize.css/normalize.css dist/static

mkdir -p dist/static/blueprintjs
cp -v node_modules/@blueprintjs/core/lib/css/blueprint.css* dist/static/blueprintjs/
cp -v node_modules/@blueprintjs/icons/lib/css/blueprint-icons.css* dist/static/blueprintjs/
cp -v node_modules/@blueprintjs/popover2/lib/css/blueprint-popover2.css* dist/static/blueprintjs/

mkdir -p dist/static/draftjs
cp -v node_modules/draft-js/dist/Draft.css dist/static/draftjs/

mkdir -p dist/static/fontawesome/css
cp -v node_modules/@fortawesome/fontawesome-free/css/all.min.css dist/static/fontawesome/css/
# font files needs to be inside webfonts in same level of fontawesome css
mkdir -p dist/static/fontawesome/webfonts
cp -v node_modules/@fortawesome/fontawesome-free/webfonts/* dist/static/fontawesome/webfonts/

mkdir -p dist/static/simplebar
cp -v node_modules/simplebar/dist/simplebar.min.css dist/static/simplebar/
