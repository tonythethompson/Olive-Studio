import typegpu from 'unplugin-typegpu/vite';
import react from '@vitejs/plugin-react-swc';
import tailwindcss from '@tailwindcss/vite';
import path from 'path';
import { defineConfig } from 'vite';
import { visualizer } from 'rollup-plugin-visualizer';
import compression from 'vite-plugin-compression';

export default defineConfig(() => {
  return {
    plugins: [
      react(),
      tailwindcss(),
      typegpu(),
      // Bundle analysis — open http://localhost:1420 to view tree map
      ...(process.env.ANALYZE
        ? [
            visualizer({
              open: true,
              gzipSize: true,
              brotliSize: true,
              filename: 'bundle-analysis.html',
            }),
          ]
        : []),
      // Gzip compression for production deployment (~70% size reduction)
      compression({
        algorithm: 'gzip',
        ext: '.gz',
        threshold: 1024,
      }),
      // Brotli compression (additional ~15-20% over gzip, enabled separately)
      // Disabled by default — uncomment when deploying to a server that
      // prefers .br files and vite-plugin-compression confirms Vite 8/Rolldown
      // compatibility in your Node.js version:
      // compression({
      //   algorithm: 'brotliCompress',
      //   ext: '.br',
      //   threshold: 1024,
      // }),
    ],
    resolve: {
      alias: {
        '@': path.resolve(__dirname, './src'),
      },
    },
    server: {
      // Pre-transform critical files on cold start for faster first load
      warmup: {
        clientFiles: [
          './src/main.tsx',
          './src/App.tsx',
          './src/components/features/InputEnvironmentPanel.tsx',
          './src/components/features/IHVIntegrationPanel.tsx',
          './src/components/features/ExecutionWorkspace.tsx',
        ],
      },
      // HMR is disabled in AI Studio via DISABLE_HMR env var.
      // Do not modify — file watching is disabled when DISABLE_HMR is true.
      hmr: process.env.DISABLE_HMR !== 'true',
      // Do not reload the UI when Olive/pip write into these folders during a run.
      watch: process.env.DISABLE_HMR === 'true'
        ? null
        : {
            ignored: [
              '**/.venv/**',
              '**/node_modules/**',
              '**/models/**',
              '**/.cache/**',
            ],
          },
    },
    build: {
      rollupOptions: {
        output: {
          manualChunks(id: string) {
            // React core — stable, changes infrequently
            if (id.includes('node_modules/react')) {
              return 'vendor-react';
            }
            // Radix UI primitives
            if (id.includes('@radix-ui')) {
              return 'vendor-radix';
            }
            // Charting — heavy, separate from app code
            if (id.includes('recharts')) {
              return 'vendor-charts';
            }
            // Animation engine (handles both POSIX / and Windows \ separators)
            if (id.includes('motion') && (id.includes('node_modules'))) {
              return 'vendor-motion';
            }
            // Icon library — large surface area
            if (id.includes('lucide-react')) {
              return 'vendor-icons';
            }
            // TanStack Query
            if (id.includes('@tanstack/react-query')) {
              return 'vendor-query';
            }
          },
        },
      },
      // Warn when any chunk exceeds this size (after minification)
      chunkSizeWarningLimit: 600,
    },
  };
});
