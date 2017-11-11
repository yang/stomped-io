const MinifyPlugin = require("babel-minify-webpack-plugin");
const merge = require('webpack-merge');
const webpack = require('webpack');
const BundleAnalyzerPlugin = require('webpack-bundle-analyzer').BundleAnalyzerPlugin;
const baseConfig = {
  entry: {
    client: './src/admin-client-or-worker.ts'
  },
  output: {
    filename: '[name].js',
    path: __dirname + '/dist',
    sourceMapFilename: 'maps/[file].map'
  },
  // Enable sourcemaps for debugging webpack's output.
  devtool: "source-map",
  resolve: {
    extensions: ['.ts','.tsx','.js','.json']
  },
  module: {
    rules: [
      // All files with a '.ts' or '.tsx' extension will be handled by 'awesome-typescript-loader'.
      { test: /\.tsx?$/, loader: "awesome-typescript-loader" },
      // All output '.js' files will have any sourcemaps re-processed by 'source-map-loader'.
      { enforce: "pre", test: /\.js$/, loader: "source-map-loader" }
    ]
  }
};
module.exports = [
  merge(baseConfig, {
    name: 'dev',
    entry: {
      'admin-client': './src/admin-client-or-worker.ts',
      client: './src/client-runner.ts'
    },
    output: {
      filename: '[name].js',
      path: __dirname + '/build',
      sourceMapFilename: 'maps/[file].map'
    },
    devServer: {
      contentBase: '.',
      host: '0.0.0.0',
      openPage: '/admin.html?debug=1&authKey=SECRET',
      publicPath: '/build/',
    }
  }),
  merge(baseConfig, {
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
  })
];
