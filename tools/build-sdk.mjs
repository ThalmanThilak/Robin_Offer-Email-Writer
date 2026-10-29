// Bundles the official Anthropic SDK into one browser file: site/vendor/anthropic-sdk.js
// Run with: npm run build-sdk
// The site loads this local file, so no script comes from another server.
import { build } from "esbuild";

await build({
  stdin: {
    contents: 'export { default } from "@anthropic-ai/sdk";',
    resolveDir: process.cwd(),
    loader: "js",
  },
  bundle: true,
  format: "esm",
  platform: "browser",
  target: ["chrome110", "edge110"],
  minify: true,
  legalComments: "eof",
  outfile: "site/vendor/anthropic-sdk.js",
  banner: {
    js: "/* Anthropic TypeScript SDK 1.3.0 (MIT License), bundled for the browser. Source: https://github.com/anthropics/anthropic-sdk-typescript */",
  },
});

console.log("Wrote site/vendor/anthropic-sdk.js");
