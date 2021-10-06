const path = require('path');
const { merge } = require('webpack-merge');
const baseConfig = require('./webpack.base.config.js');
const TerserPlugin = require("terser-webpack-plugin");

module.exports = merge(baseConfig, {
  devtool: 'hidden-source-map',

  output: {
    path: path.resolve(__dirname, 'dist/generated/prod'),
    filename: '[name].js',
    publicPath: ''
  },

  // optimization: {
  //   splitChunks: {
  //     chunks: 'all',
  //   },
  //   minimize: true,
  //   minimizer: [
  //     new TerserPlugin({
  //       terserOptions: {
  //           keep_classnames: true,
  //           keep_fnames: true
  //       }
  //     })
  //   ]
  // },

  module: {
    rules: [
      {
        test: /\.(j|t)s$/,
        enforce: 'pre',
        exclude: /(node_modules|bower_components|\.spec\.js)/,
        use: [
          {
            loader: 'webpack-strip-block',
            options: {
              start: 'DEV-START',
              end: 'DEV-END'
            }
          }
        ]
      }
    ]
  },
});
