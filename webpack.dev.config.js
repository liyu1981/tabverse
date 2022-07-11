const path = require('path');
const { merge } = require('webpack-merge');
const { baseConfig, getCustomRules } = require('./webpack.base.config.js');
const ESLintPlugin = require('eslint-webpack-plugin');

module.exports = merge(baseConfig, {
  output: {
    path: path.resolve(__dirname, 'dist/generated/dev'),
    filename: '[name].js',
    publicPath: '',
  },

  module: {
    rules: getCustomRules({
      'css-loader-options': {
        modules: {
          localIdentName: '[path][name]__[local]--[hash:base64:5]',
        },
      },
      'sass-loader-options': {
        sassOptions: {
          includePaths: [path.resolve(__dirname, 'node_modules')],
        },
      },
    }),
  },

  plugins: [new ESLintPlugin()],
});
