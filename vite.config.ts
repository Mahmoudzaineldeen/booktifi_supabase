import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [react()],
  optimizeDeps: {
    exclude: ['lucide-react'],
  },
  server: {
    port: 5173,
    proxy: {
      '/api': {
        // Proxy only used when VITE_API_URL is not set
        // If VITE_API_URL is set, frontend makes direct requests to Railway
        target: process.env.VITE_API_URL?.replace('/api', '') || 'https://booktifisupabase-production.up.railway.app',
        changeOrigin: true,
        secure: true,
        rewrite: (path) => path.replace(/^\/api/, '/api'),
      },
    },
  },
});
