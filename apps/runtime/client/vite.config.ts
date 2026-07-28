import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'path';
import { extImportMapPlugin } from './vite-plugin-ext-importmap';

// The version the SPA displays comes from `VITE_EXEPAD_VERSION` (stamped by the
// release build; `dev` when unset) — see `src/pages/AboutPage.tsx`. This package's
// package.json version is deliberately NOT injected: it is a private, unpublished
// workspace package, and an AGPL section 13 source offer must not name a release
// the running binary was not built from.

export default defineConfig({
  plugins: [extImportMapPlugin(), react()],
  resolve: {
    alias: [
      { find: '@/components', replacement: path.resolve(__dirname, 'src/components') },
      { find: '@/services', replacement: path.resolve(__dirname, 'src/services') },
      { find: '@/stores', replacement: path.resolve(__dirname, 'src/stores') },
      { find: '@/hooks', replacement: path.resolve(__dirname, 'src/hooks') },
      { find: '@/utils', replacement: path.resolve(__dirname, 'src/utils') },
      { find: '@/core', replacement: path.resolve(__dirname, 'src/core') },
      { find: '@/lib', replacement: path.resolve(__dirname, 'src/lib') },
      { find: '@/context', replacement: path.resolve(__dirname, 'src/context') },
      { find: '@/registry', replacement: path.resolve(__dirname, 'src/registry') },
      { find: '@/app_runtime', replacement: path.resolve(__dirname, 'src/app_runtime') },
      { find: '@/runtime', replacement: path.resolve(__dirname, 'src/app_runtime/runtime') },
      { find: '@/types', replacement: path.resolve(__dirname, 'src/app_runtime/interfaces') },
      { find: '@/interfaces', replacement: path.resolve(__dirname, 'src/app_runtime/interfaces') },
      { find: '@/schemas', replacement: path.resolve(__dirname, 'src/app_runtime/schemas') },
      { find: '@', replacement: path.resolve(__dirname, 'src') },
    ],
  },
  server: {
    port: 3001,
    host: true,
    allowedHosts: ['exepad.local'],
    proxy: {
      // The runtime worker owns these prefixes and serves HTTPS by default (it
      // 302-redirects plain HTTP up to TLS), so target its TLS port and accept
      // the local dev cert (secure:false). `pnpm dev` binds the worker on 8443;
      // override the port here if you set EXEPAD_HTTPS_PORT. Hitting :3001 over
      // plain HTTP means no browser cert prompt for day-to-day dev.
      '/api': { target: 'https://localhost:8443', changeOrigin: true, secure: false },
      '/auth': { target: 'https://localhost:8443', changeOrigin: true, secure: false },
      '/published': { target: 'https://localhost:8443', changeOrigin: true, secure: false },
    },
  },
  build: {
    outDir: 'dist',
    sourcemap: false,
    rollupOptions: {
      external: [
        /^\/runtime_assets\//,
      ],
    },
  },
});
