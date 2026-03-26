const path = require("node:path");
const webpack = require("webpack");

/** @type {import("webpack").Configuration} */
module.exports = {
  mode: "production",
  target: "node18",
  entry: "./dist/cli.js",
  devtool: "source-map",
  externalsPresets: { node: true },
  output: {
    path: path.resolve(__dirname, "dist"),
    filename: "cli.cjs",
    clean: true,
  },
  resolve: {
    extensions: [".js"],
  },
  plugins: [
    new webpack.BannerPlugin({
      banner: "#!/usr/bin/env node",
      raw: true,
    }),
  ],
};
