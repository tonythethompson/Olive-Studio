import typegpu from 'unplugin-typegpu/vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import path from 'path';
import fs from 'fs';
import { defineConfig, type Plugin } from 'vite';
import { visualizer } from 'rollup-plugin-visualizer';
import compression from 'vite-plugin-compression';
import { ANY_DOT_VENV_DIR } from './src/server/shared/anyDotVenvDir';

/**
 * onnxruntime-web's wasm binaries are never loaded from our own origin — every
 * call site (ArenaPanel, InBrowserValidation, WebGpuBenchmarkPanel) points
 * `env.wasm.wasmPaths` at the jsdelivr CDN so the browser fetches them from
 * there instead. Vite still copies the ~50MB of .wasm into dist as an asset
 * because ort's JS references them; strip them post-build so they don't ship.
 */
function stripUnusedOrtWasm(): Plugin {
  return {
    name: 'strip-unused-ort-wasm',
    apply: 'build',
    closeBundle() {
      const assetsDir = path.resolve(import.meta.dirname, 'dist/assets');
      if (!fs.existsSync(assetsDir)) return;
      for (const file of fs.readdirSync(assetsDir)) {
        if (file.endsWith('.wasm') || file.endsWith('.wasm.gz')) {
          fs.rmSync(path.join(assetsDir, file));
        }
      }
    },
  };
}

/**
 * The shared regex from `src/server/shared/anyDotVenvDir.ts` matches both
 * here and in `server.ts` so a rename/back-up of the venv directory
 * (`.venv.bak`, `.venv.old`, `.venv-rename`) is filtered out by both
 * Vite watchlists in lockstep.
 */
void ANY_DOT_VENV_DIR;

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
      stripUnusedOrtWasm(),
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
        '@': path.resolve(import.meta.dirname, './src'),
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
              ANY_DOT_VENV_DIR,
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
