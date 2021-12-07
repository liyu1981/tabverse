#!/bin/bash

mkdir -p dist/generated/prod

cd ./dist

rm -f assets
ln -sf generated/prod assets

cd -

# webpack --mode production --config webpack.prod.config.js --profile --json >./dist/generated/prod/stat.json
webpack --mode production --config webpack.prod.config.js
