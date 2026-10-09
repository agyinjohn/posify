import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';

export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      manifest: {
        name: 'Posify',
        short_name: 'Posify',
        start_url: '/',
        display: 'standalone',
        background_color: '#EDF0F3',
        theme_color: '#17212B',
        icons: [
          { src: 'icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any maskable' },
        ],
      },
      // Caches the app shell so the screen still opens offline. API calls are never cached.
      workbox: { globPatterns: ['**/*.{js,css,html,svg,png,woff2}'], navigateFallbackDenylist: [/^\/api/] },
    }),
  ],
  server: { proxy: { '/api': 'http://localhost:4000' } },
});
