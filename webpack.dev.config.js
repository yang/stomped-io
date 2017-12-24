const MinifyPlugin = require("babel-minify-webpack-plugin");
const merge = require('webpack-merge');
const webpack = require('webpack');
const BundleAnalyzerPlugin = require('webpack-bundle-analyzer').BundleAnalyzerPlugin;
const baseConfig = require('./webpack.base.config');
const CopyWebpackPlugin = require('copy-webpack-plugin');
module.exports = merge(baseConfig, {
  name: 'dev',
  entry: {
    'admin-client': './src/admin-client-or-worker.ts',
    client: './src/client-runner.ts'
  },
  plugins: [
    new CopyWebpackPlugin([{
      from: 'src/main.proto',
      to: '../dist/main.proto'
    }])
  ],
  output: {
    filename: '[name].js',
    path: __dirname + '/build',
    sourceMapFilename: 'maps/[file].map'
  },
  devServer: {
    contentBase: '.',
    host: '0.0.0.0',
    openPage: 'admin.html?debug=1&authKey=SECRET',
    publicPath: '/build/',
    disableHostCheck: true,
    proxy: {
      '/stats': 'http://localhost:3000',
      '/debug': 'http://localhost:3000'
    }
  }
});