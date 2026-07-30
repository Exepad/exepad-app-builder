import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import path from 'path';

export default defineConfig({
  plugins: [react()],
  test: {
    reporters: ['default', 'json'],
    outputFile: {
      json: path.resolve(__dirname, 'test-results.json'),
    },
    pool: 'forks',
    testTimeout: 15000,
    teardownTimeout: 5000,
    globals: true,
    environment: 'happy-dom',
    setupFiles: ['./tests/setup.ts'],
    // Inline the workspace packages (esp. the source-entry app-backend +
    // local-adapters) so vite transforms them and honors their package
    // `exports`/symlinks — instead of externalizing them to Node's loader,
    // which trips on deep subpath imports under symlinks.
    server: {
      deps: {
        inline: [/^@exepad\/(app-backend|local-adapters|deploy-utils)/],
      },
    },
    include: ['tests/**/*.test.{ts,tsx}'],
    exclude: [
      '**/node_modules/**',
    ],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html'],
      exclude: [
        'node_modules/',
        'tests/',
        'e2e/',
        '**/*.test.ts',
        '**/*.test.tsx',
        '**/*.spec.ts',
        '**/*.spec.tsx',
      ],
    },
  },
  resolve: {
    alias: {
      // Match client tsconfig paths
      '@/runtime': path.resolve(__dirname, './client/src/app_runtime/runtime'),
      '@/interfaces': path.resolve(__dirname, './client/src/app_runtime/interfaces'),
      '@/types': path.resolve(__dirname, './client/src/app_runtime/interfaces'),
      '@/app_runtime': path.resolve(__dirname, './client/src/app_runtime'),
      '@': path.resolve(__dirname, './client/src'),
      '@tests': path.resolve(__dirname, './tests'),
      // Worker dependencies for admin route tests
      'hono/cors': path.resolve(__dirname, './worker/node_modules/hono/dist/middleware/cors/index.js'),
      'hono/body-limit': path.resolve(__dirname, './worker/node_modules/hono/dist/middleware/body-limit/index.js'),
      'hono/compress': path.resolve(__dirname, './worker/node_modules/hono/dist/middleware/compress/index.js'),
      'hono/factory': path.resolve(__dirname, './worker/node_modules/hono/dist/helper/factory/index.js'),
      'hono': path.resolve(__dirname, './worker/node_modules/hono'),
    },
  },
});
