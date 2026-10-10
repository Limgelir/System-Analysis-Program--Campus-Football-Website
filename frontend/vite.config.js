import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'

export default defineConfig(({ command, isPreview }) => ({
  // NODE_ENV=test can make import.meta.env.DEV true even during a build.
  define: { __APPEARANCE_DEV_SERVER__: JSON.stringify(command === 'serve' && !isPreview) },
  plugins: [vue()], resolve: { dedupe: ['vue', 'vue-router'] },
  server: {
    port: 5174,
    strictPort: true,
    proxy: {
      '/api': {
        target: 'http://127.0.0.1:3000',
        changeOrigin: true
      }
    }
  }
}))
