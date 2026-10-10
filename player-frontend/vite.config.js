import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
export default defineConfig(({ command, isPreview }) => ({ define: { __APPEARANCE_DEV_SERVER__: JSON.stringify(command === 'serve' && !isPreview) }, plugins: [vue()], resolve: { dedupe: ['vue', 'vue-router'] }, server: { host: '127.0.0.1', port: 5175, strictPort: true, proxy: { '/api': { target: 'http://127.0.0.1:3000', changeOrigin: true } } } }))
