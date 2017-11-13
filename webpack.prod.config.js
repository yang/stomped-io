const MinifyPlugin = require("babel-minify-webpack-plugin");
const merge = require('webpack-merge');
const webpack = require('webpack');
const BundleAnalyzerPlugin = require('webpack-bundle-analyzer').BundleAnalyzerPlugin;
const baseConfig = require('./webpack.base.config');
module.exports = merge(baseConfig, {
  name: 'prod',
  entry: {
    client: './src/client-runner.ts'
  },
  plugins: [
    // 5.8M -> 5.1M
    new webpack.DefinePlugin({
      'process.env': {
        'NODE_ENV': JSON.stringify('production')
      }
    }),

    // No gain
    // new webpack.optimize.DedupePlugin(),

    // 5.1M -> 1.5M (.4M gz)
    new webpack.optimize.UglifyJsPlugin({
      sourceMap: true
    })

    // 5.1M -> 1.5M, breaks Planck import, and runs many times slower!
    // new MinifyPlugin({}, {})

    // new BundleAnalyzerPlugin()
  ],
  output: {
    filename: 'bundle.js',
    path: __dirname + '/dist',
    sourceMapFilename: 'maps/[file].map'
  }
});