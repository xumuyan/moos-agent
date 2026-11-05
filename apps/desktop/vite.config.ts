import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    host: '127.0.0.1', port: 1420, strictPort: true,
    proxy: { '/api': { target: 'http://127.0.0.1:4318', changeOrigin: true } },
  },
  test: {
    include: ['src/**/*.test.{ts,tsx}'], testTimeout: 20000,
    environment: 'jsdom', setupFiles: ['./src/test-setup.ts'], css: false,
    alias: { '@ant-design/x': decodeURIComponent(new URL('./node_modules/@ant-design/x/es/index.js', import.meta.url).pathname) },
    server: { deps: { inline: [/@ant-design\/x/, /antd/, /@ant-design\/icons/] } },
  },
});
