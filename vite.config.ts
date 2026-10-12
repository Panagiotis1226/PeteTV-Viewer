import { defineConfig } from 'vite';
import preact from '@preact/preset-vite';
import { readFileSync } from 'node:fs';

const pkg = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8'));

export default defineConfig({
  base: './',
  plugins: [preact()],
  define: { __APP_VERSION__: JSON.stringify(pkg.version) },
  build: {
    // Old Fire TV / Android TV WebViews: keep the syntax conservative.
    target: ['chrome69', 'safari13'],
    outDir: 'dist',
    assetsInlineLimit: 0,
    chunkSizeWarningLimit: 700,
  },
  // Classic (non-module) workers for older TV WebViews.
  worker: { format: 'iife' },
  server: {
    proxy: { '/api': 'http://localhost:8080' },
  },
  test: {
    include: ['tests/**/*.test.ts'],
  },
});
