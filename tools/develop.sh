#!/bin/bash

cd ./dist
rm -f assets
rm -rf generated/dev/*
ln -sf generated/dev/ assets
cd -

webpack --mode development --config webpack.dev.config.js --watch
