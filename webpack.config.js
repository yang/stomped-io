const MinifyPlugin = require("babel-minify-webpack-plugin");
const merge = require('webpack-merge');
const baseConfig = {
  entry: './src/client-or-worker.ts',
  output: {
    filename: 'bundle.js',
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
    name: 'dev'
  }),
  merge(baseConfig, {
    name: 'prod',
    output: {
      filename: 'bundle.min.js',
      path: __dirname + '/dist'
    },
    plugins: [
      new MinifyPlugin({}, {})
    ]
  })
];
