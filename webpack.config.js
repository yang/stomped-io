const MinifyPlugin = require("babel-minify-webpack-plugin");
const merge = require('webpack-merge');
const baseConfig = {
  entry: {
    client: './src/admin-client-or-worker.ts'
  },
  output: {
    filename: '[name].js',
    path: __dirname + '/dist'
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
      path: __dirname + '/build'
    }
  }),
  merge(baseConfig, {
    name: 'prod',
    plugins: [
      new MinifyPlugin({}, {})
    ],
    output: {
      filename: 'bundle.js',
      path: __dirname + '/dist'
    }
  })
];
