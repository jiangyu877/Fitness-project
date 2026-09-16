import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

const localApiPort = process.env.P11_LOCAL_API_PORT ?? '3000';
const localRuntime = process.env.VITE_P11_LOCAL_RUNTIME === 'true';

export default defineConfig({
  plugins: [react()],
  server: {
    host: '127.0.0.1',
    port: 5173,
    strictPort: localRuntime,
    proxy: {
      '/api': `http://127.0.0.1:${localApiPort}`,
      '/p11-local': `http://127.0.0.1:${localApiPort}`,
    },
  },
  preview: {
    host: '127.0.0.1',
    port: 4173,
  },
});
