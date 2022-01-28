const path = require('path');
const { merge } = require('webpack-merge');
const { baseConfig, getCustomRules } = require('./webpack.base.config.js');
const MiniCssExtractPlugin = require('mini-css-extract-plugin');

module.exports = merge(baseConfig, {
  devtool: 'hidden-source-map',

  output: {
    path: path.resolve(__dirname, 'dist/generated/prod'),
    filename: '[name].js',
    publicPath: '',
  },

  module: {
    rules: getCustomRules({
      'css-loader-options': {
        modules: {
          localIdentName: '[hash:base64:8]',
        },
      },
      'sass-loader-options': {
        sassOptions: {
          includePaths: [path.resolve(__dirname, 'node_modules')],
        },
      },
      'extra-rules': [
        {
          test: /\.(j|t)s$/,
          enforce: 'pre',
          exclude: /(node_modules|bower_components|\.spec\.js)/,
          use: [
            {
              loader: 'webpack-strip-block',
              options: {
                start: 'DEV-START',
                end: 'DEV-END',
              },
            },
          ],
        },
      ],
    }),
  },
});
