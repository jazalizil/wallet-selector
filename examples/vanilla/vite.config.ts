/// <reference types="vitest" />
import { defineConfig } from "vite";

import { nxViteTsPaths } from "@nx/vite/plugins/nx-tsconfig-paths.plugin";
import { nodePolyfills } from "vite-plugin-node-polyfills";
import path from "path";

export default defineConfig({
  root: __dirname,
  cacheDir: "../../node_modules/.vite/apps/vanilla",
  server: {
    port: 4200,
    host: "localhost",
  },
  preview: {
    port: 4300,
    host: "localhost",
  },
  plugins: [
    nxViteTsPaths(),
    nodePolyfills({
      // To exclude specific polyfills, add them to this list
      exclude: [
        // Example: 'fs', // Excludes the polyfill for 'fs' and 'node:fs'
      ],
      // Whether to polyfill specific globals
      globals: {
        Buffer: true,
        global: true,
        process: true,
      },
      // Whether to polyfill Node.js builtins
      protocolImports: true,
    }),
  ],
  resolve: {
    alias: {
      // ...existing code...
      http: "vite-plugin-node-polyfills/polyfills/http",
      https: "vite-plugin-node-polyfills/polyfills/http",
      stream: "vite-plugin-node-polyfills/polyfills/stream",
      "@near-wallet-selector/bitte-wallet": path.resolve(
        __dirname,
        "../../dist/packages/bitte-wallet"
      ),
      "@near-wallet-selector/here-wallet": path.resolve(
        __dirname,
        "../../dist/packages/here-wallet"
      ),
      "@near-wallet-selector/ledger": path.resolve(
        __dirname,
        "../../dist/packages/ledger"
      ),
      "@near-wallet-selector/meteor-wallet": path.resolve(
        __dirname,
        "../../dist/packages/meteor-wallet"
      ),
      "@near-wallet-selector/ethereum-wallets": path.resolve(
        __dirname,
        "../../dist/packages/ethereum-wallets"
      ),
      "@near-wallet-selector/intear-wallet": path.resolve(
        __dirname,
        "../../dist/packages/intear-wallet"
      ),
      "@near-wallet-selector/my-near-wallet": path.resolve(
        __dirname,
        "../../dist/packages/my-near-wallet"
      ),
      "@near-wallet-selector/near-mobile-wallet": path.resolve(
        __dirname,
        "../../dist/packages/near-mobile-wallet"
      ),
      "@near-wallet-selector/welldone-wallet": path.resolve(
        __dirname,
        "../../dist/packages/welldone-wallet"
      ),
      "@near-wallet-selector/modal-ui-js": path.resolve(
        __dirname,
        "../../dist/packages/modal-ui-js"
      ),
      "@near-wallet-selector/sender": path.resolve(
        __dirname,
        "../../dist/packages/sender"
      ),
      "@near-wallet-selector/wallet-utils": path.resolve(
        __dirname,
        "../../dist/packages/wallet-utils"
      ),
      "@near-wallet-selector/core": path.resolve(
        __dirname,
        "../../dist/packages/core"
      ),
    },
  },
  test: {
    globals: true,
    cache: {
      dir: "../../node_modules/.vitest",
    },
    environment: "jsdom",
    include: ["src/**/*.{test,spec}.{js,mjs,cjs,ts,mts,cts,jsx,tsx}"],
  },
});
