import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';

/**
 * Content-Security-Policy for the production build only. (The dev server needs
 * inline scripts for hot reload and talks to the local emulators.)
 */
const CSP = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "font-src 'self'",
  "connect-src 'self' https://*.googleapis.com https://*.firebaseio.com",
  'frame-src https://*.firebaseapp.com',
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
].join('; ');

const csp = (): Plugin => ({
  name: 'csp-meta',
  apply: 'build',
  transformIndexHtml: () => [
    {
      tag: 'meta',
      attrs: { 'http-equiv': 'Content-Security-Policy', content: CSP },
      injectTo: 'head-prepend',
    },
  ],
});

// GitHub Pages serves the app under /<repo>/.
export default defineConfig({
  base: '/supplier-ledger/',
  plugins: [react(), csp()],
  // The Firebase SDK alone is ~600 kB (185 kB gzip); that is expected.
  build: { sourcemap: false, target: 'es2022', chunkSizeWarningLimit: 700 },
});
