/// <reference types="vitest" />
import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '');
  const apiTarget = env.VITE_API_PROXY ?? 'http://localhost:3000';
  return {
    plugins: [
      react(),
      VitePWA({
        registerType: 'autoUpdate',
        injectRegister: false,
        includeAssets: ['favicon.svg', 'robots.txt'],
        manifest: {
          name: 'RecallFarm — administration',
          short_name: 'RecallFarm',
          description: "Console d'administration RecallFarm : rappels, alertes, exploitations et paramétrage.",
          lang: 'fr',
          start_url: '/admin',
          scope: '/',
          display: 'standalone',
          background_color: '#062B4F',
          theme_color: '#04477F',
          icons: [
            { src: '/icon-192.png', sizes: '192x192', type: 'image/png' },
            { src: '/icon-512.png', sizes: '512x512', type: 'image/png' },
            { src: '/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
            { src: '/favicon.svg', sizes: 'any', type: 'image/svg+xml' },
          ],
        },
        workbox: {
          navigateFallback: '/index.html',
          navigateFallbackDenylist: [/^\/v1\//],
          globPatterns: ['**/*.{js,css,html,svg,png,woff2}'],
          runtimeCaching: [],
        },
      }),
    ],
    server: {
      port: 5173,
      proxy: { '/v1': { target: apiTarget, changeOrigin: true } },
    },
    preview: { port: 4173 },
    build: { sourcemap: false, target: 'es2020' },
    test: {
      environment: 'jsdom',
      globals: true,
      setupFiles: ['./src/test/setup.ts'],
      css: false,
      include: ['src/**/*.test.{ts,tsx}'],
      // `npm run test:coverage` : mesure sur tout src/ (pas seulement les fichiers importes par un test).
      // Seuils = valeurs mesurees le 2026-11-10 (non-regression) ; plan de remontee dans docs/plan/etat.md.
      coverage: {
        provider: 'v8',
        include: ['src/**/*.{ts,tsx}'],
        exclude: ['src/**/*.test.{ts,tsx}', 'src/test/**', 'src/mocks/**', 'src/**/*.d.ts'],
        reporter: ['text-summary', 'json-summary', 'lcov'],
        reportsDirectory: 'coverage',
        thresholds: {
          lines: 48,
          statements: 48,
          functions: 48,
          branches: 73,
          // Moteur d'expressions (copie web du moteur partage) : ne doit pas regresser.
          'src/lib/expr.ts': { lines: 93, branches: 81 },
        },
      },
    },
  };
});
