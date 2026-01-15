import { defineConfig } from "vite";
import vue from "@vitejs/plugin-vue";
import dts from "vite-plugin-dts";
import { resolve } from "path";

export default defineConfig({
  resolve: {
    alias: {
      "@pooder/core": resolve(__dirname, "../core/src/index.ts"),
    },
  },
  plugins: [
    vue(),
    dts({
      insertTypesEntry: true,
    }),
  ],
  build: {
    lib: {
      entry: resolve(__dirname, "src/index.ts"),
      name: "PooderVue",
      fileName: (format) => `index.${format}.js`,
    },
    rollupOptions: {
      external: ["vue", "@pooder/core", "@pooder/kit"],
      output: {
        globals: {
          vue: "Vue",
          "@pooder/core": "PooderCore",
          "@pooder/kit": "PooderKit",
        },
      },
    },
  },
});
