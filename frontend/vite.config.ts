import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const previewAllowedHostsEnv = process.env.PREVIEW_ALLOWED_HOSTS?.trim();

function resolvePreviewAllowedHosts(): true | string[] {
  if (!previewAllowedHostsEnv || previewAllowedHostsEnv === '*') {
    return true;
  }

  const hosts = previewAllowedHostsEnv
    .split(',')
    .map((host) => host.trim())
    .filter(Boolean);

  return hosts.length > 0 ? hosts : true;
}

export default defineConfig({
  plugins: [
    tailwindcss(),
    react(),
  ],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  server: {
    port: 5173,
    proxy: {
      '/api': {
        target: 'http://localhost:3001',
        changeOrigin: true,
      },
    },
  },
  preview: {
    host: '0.0.0.0',
    port: 5173,
    allowedHosts: resolvePreviewAllowedHosts(),
  },
  build: {
    outDir: 'dist',
    sourcemap: true,
  },
});
