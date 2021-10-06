#!/bin/bash

cd ./dist
rm -f assets
ln -sf generated/prod assets
cd -

webpack --mode production --config webpack.prod.config.js --profile --json >./dist/generated/prod/stat.json
