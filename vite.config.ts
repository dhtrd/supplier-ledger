import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// GitHub Pages serves the app under /<repo>/.
export default defineConfig({
  base: '/supplier-ledger/',
  plugins: [react()],
  build: { sourcemap: false, target: 'es2022' },
});
