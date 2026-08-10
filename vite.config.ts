import typegpuPlugin from 'unplugin-typegpu/vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import path from 'path';
import { defineConfig, type Plugin } from 'vite';
import { visualizer } from 'rollup-plugin-visualizer';
import compression from 'vite-plugin-compression';
import { ANY_DOT_VENV_DIR } from './src/server/shared/anyDotVenvDir.ts';

/**
 * onnxruntime-web's wasm binaries are never loaded from our own origin — every
 * call site (ArenaPanel, InBrowserValidation, WebGpuBenchmarkPanel) points
 * `env.wasm.wasmPaths` at the jsdelivr CDN so the browser fetches them from
 * there instead. Vite still copies the ~50MB of .wasm into dist as an asset
 * because ort's JS references them; drop them from the bundle so they never
 * ship — and never get compressed, unlike a post-hoc delete would allow.
 *
 * Removes them in `generateBundle`, not `closeBundle`: closeBundle is a
 * parallel hook, so a file-based delete there could race with
 * vite-plugin-compression's own closeBundle and either miss files it hasn't
 * written yet or delete files out from under it mid-write.
 * `generateBundle` runs before anything is written to disk, so pulling the
 * assets out of the in-memory bundle here means compression's later hook
 * never sees them to begin with — no race possible.
 */
function stripUnusedOrtWasm(): Plugin {
  return {
    name: 'strip-unused-ort-wasm',
    apply: 'build',
    generateBundle(_options, bundle) {
      for (const fileName of Object.keys(bundle)) {
        if (fileName.endsWith('.wasm')) {
          delete bundle[fileName];
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
      // TypeGPU plugin: WGSL transpilation for dev DX only.
      // In production, typegpu is externalized (loaded from CDN on-demand).
      { ...typegpuPlugin(), apply: 'serve' },
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
        filter: /\.(js|css|html|svg|json)$/i,
      }),
      stripUnusedOrtWasm(),
      // Brotli compression (additional ~15-20% over gzip)
      compression({
        algorithm: 'brotliCompress',
        ext: '.br',
        threshold: 1024,
        filter: /\.(js|css|html|svg|json)$/i,
      }),
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
          './src/components/features/input/InputEnvironmentPanel.tsx',
          './src/components/features/ihv/IHVIntegrationPanel.tsx',
          './src/components/features/execute/ExecutionWorkspace.tsx',
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
        // Externalize heavy optional dependencies — they're only used in
        // Playground panels behind dynamic imports with graceful fallbacks.
        // The app works fully offline without them (Arena tokenizer falls back
        // to prompt-derived encoding, Playground panels show loading state,
        // WebGPU benchmark gracefully degrades without TypeGPU).
        // Users who open those panels load them from CDN on-demand.
        external: [
          '@huggingface/transformers',
          'onnxruntime-web',
          'typegpu',
        ],
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
