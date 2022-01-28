const path = require('path');
const NodePolyfillPlugin = require('node-polyfill-webpack-plugin');
const MiniCssExtractPlugin = require('mini-css-extract-plugin');
const { CleanWebpackPlugin } = require('clean-webpack-plugin');

module.exports = {
  baseConfig: {
    devtool: 'inline-source-map',

    entry: {
      background: './src/background.ts',
      popup: './src/ui/popup.tsx',
      manager: './src/ui/manager.tsx',
      icon: './src/dev/icon.tsx',
      devdata: './src/dev/data.tsx',
    },

    resolve: {
      extensions: ['.ts', '.tsx', '.js'],
    },

    plugins: [
      new MiniCssExtractPlugin(),
      new NodePolyfillPlugin(),
      new CleanWebpackPlugin(),
    ],
  },

  getCustomRules: function (options) {
    return [
      {
        test: /\.tsx?$/,
        loader: 'ts-loader',
      },
      {
        test: /\.css$/,
        use: [
          MiniCssExtractPlugin.loader,
          {
            loader: 'css-loader',
            options:
              'css-loader-options' in options
                ? options['css-loader-options']
                : {},
          },
        ],
      },
      {
        test: /\.s[ac]ss$/,
        use: [
          MiniCssExtractPlugin.loader,
          {
            loader: 'css-loader',
            options:
              'css-loader-options' in options
                ? options['css-loader-options']
                : {},
          },
          {
            loader: 'sass-loader',
            options:
              'sass-loader-options' in options
                ? options['sass-loader-options']
                : {},
          },
        ],
      },
    ].concat('extra-rules' in options ? options['extra-rules'] : []);
  },
};
