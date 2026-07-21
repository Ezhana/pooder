import { defineConfig } from "vite";
import vue from "@vitejs/plugin-vue";
import dts from "vite-plugin-dts";
import { resolve } from "path";

export default defineConfig({
  resolve: {
    alias: [
      {
        find: /^@pooder\/core$/,
        replacement: resolve(__dirname, "../core/src/index.ts"),
      },
      {
        find: /^@pooder\/platform-browser$/,
        replacement: resolve(__dirname, "../platform-browser/src/index.ts"),
      },
    ],
  },
  plugins: [
    vue(),
    dts({
      insertTypesEntry: true,
      pathsToAliases: false,
    }),
  ],
  build: {
    minify: false,
    lib: {
      entry: resolve(__dirname, "src/index.ts"),
      name: "PooderVue",
      fileName: (format) => `index.${format}.js`,
    },
    rollupOptions: {
      external: [
        "vue",
        "@pooder/core",
        "@pooder/core/internal/legacy-extension",
        "@pooder/document-core",
        "@pooder/platform-browser",
      ],
      output: {
        globals: {
          vue: "Vue",
          "@pooder/core": "PooderCore",
          "@pooder/core/internal/legacy-extension": "PooderCoreLegacyExtension",
          "@pooder/document-core": "PooderDocumentCore",
          "@pooder/platform-browser": "PooderPlatformBrowser",
        },
      },
    },
  },
});
