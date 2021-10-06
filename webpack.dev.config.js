const path = require('path');
const { merge } = require('webpack-merge');
const baseConfig = require('./webpack.base.config.js');
const webpack = require('webpack');

module.exports = merge(baseConfig, {
  // devServer: {
  //   port: 4000,
  //   devMiddleware: {
  //     writeToDisk: true
  //   }
  // },
  output: {
    path: path.resolve(__dirname, 'dist/generated/dev'),
    filename: '[name].js',
    publicPath: '',
  },
  module: {
    rules: [
      {
        test: /\.(j|t)s$/,
        exclude: /node_modules/,
        use: ['eslint-loader'],
      },
    ],
  },
  plugins: [new webpack.HotModuleReplacementPlugin()],
});
