import { defineConfig, loadEnv, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';

/**
 * Content-Security-Policy for the production build only. (The dev server needs
 * inline scripts for hot reload and talks to the local emulators.)
 */
function cspFor(appCheck: boolean): string {
  // reCAPTCHA (App Check) needs Google's script/frame origins — only when enabled.
  const g = appCheck ? ' https://www.google.com https://www.gstatic.com' : '';
  return [
    "default-src 'self'",
    `script-src 'self'${g}`,
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob:",
    "font-src 'self'",
    `connect-src 'self' https://*.googleapis.com https://*.firebaseio.com${g}`,
    `frame-src https://*.firebaseapp.com${appCheck ? ' https://www.google.com https://recaptcha.google.com' : ''}`,
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
  ].join('; ');
}

const csp = (appCheck: boolean): Plugin => ({
  name: 'csp-meta',
  apply: 'build',
  transformIndexHtml: () => [
    {
      tag: 'meta',
      attrs: { 'http-equiv': 'Content-Security-Policy', content: cspFor(appCheck) },
      injectTo: 'head-prepend',
    },
  ],
});

/**
 * Build id for «new version» detection (src/core/appVersion.ts): embedded in
 * the code and written to version.json beside index.html.
 */
const versionFile = (id: string): Plugin => ({
  name: 'version-json',
  apply: 'build',
  generateBundle() {
    this.emitFile({ type: 'asset', fileName: 'version.json', source: JSON.stringify({ id }) });
  },
});

// GitHub Pages serves the app under /<repo>/.
export default defineConfig(({ mode, command }) => {
  const env = { ...loadEnv(mode, process.cwd(), 'VITE_'), ...process.env };
  const buildId =
    command === 'build' ? (env.GITHUB_SHA?.slice(0, 12) ?? `local-${Date.now()}`) : 'dev';
  const appCheck = !!env.VITE_RECAPTCHA_SITE_KEY?.trim();
  return {
    base: '/supplier-ledger/',
    plugins: [react(), csp(appCheck), versionFile(buildId)],
    define: { __BUILD_ID__: JSON.stringify(buildId) },
    // The Firebase SDK alone is ~600 kB (185 kB gzip); that is expected.
    build: { sourcemap: false, target: 'es2022', chunkSizeWarningLimit: 700 },
  };
});
