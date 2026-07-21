import { defineConfig } from "vite";
import vue from "@vitejs/plugin-vue";
import dts from "vite-plugin-dts";
import { resolve } from "path";

export default defineConfig({
  root: __dirname,
  plugins: [
    vue(),
    dts({
      entryRoot: "src",
      include: ["src"],
      insertTypesEntry: true,
      pathsToAliases: false,
    }),
  ],
  build: {
    minify: false,
    lib: {
      entry: {
        index: resolve(__dirname, "src/index.ts"),
        editor: resolve(__dirname, "src/editor.ts"),
      },
      cssFileName: "vue",
      formats: ["es", "cjs"],
      name: "PooderVue",
      fileName: (format, entryName) =>
        format === "es" ? `${entryName}.mjs` : `${entryName}.cjs`,
    },
    rollupOptions: {
      external: [
        "vue",
        "@pooder/core",
        "@pooder/core/internal/legacy-extension",
        "@pooder/document",
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
