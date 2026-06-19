import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import path from 'path';
import {defineConfig} from 'vite';

export default defineConfig(() => {
  return {
    plugins: [react(), tailwindcss()],
    resolve: {
      alias: {
        '@': path.resolve(__dirname, './src'),
      },
    },
    server: {
      // HMR is disabled in AI Studio via DISABLE_HMR env var.
      // Do not modify — file watching is disabled when DISABLE_HMR is true.
      hmr: process.env.DISABLE_HMR !== 'true',
      // Do not reload the UI when Olive/pip write into these folders during a run.
      watch: process.env.DISABLE_HMR === 'true' ? null : {
        ignored: ['**/.venv/**', '**/node_modules/**', '**/models/**', '**/.cache/**'],
      },
    },
  };
});
