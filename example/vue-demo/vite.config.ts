import { defineConfig } from 'vite';
import vue from '@vitejs/plugin-vue';
import path from 'path';

export default defineConfig({
  plugins: [vue()],
  resolve: {
    alias: {
      '@pooder/vue': path.resolve(__dirname, '../../packages/vue/src/index.ts'),
      '@pooder/core': path.resolve(__dirname, '../../packages/core/src/index.ts')
    }
  }
});
