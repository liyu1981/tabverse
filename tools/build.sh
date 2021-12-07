#!/bin/bash

cd ./dist

mkdir -p generated/prod

rm -f assets
ln -sf generated/prod assets

cd -

webpack --mode production --config webpack.prod.config.js --profile --json >./dist/generated/prod/stat.json
