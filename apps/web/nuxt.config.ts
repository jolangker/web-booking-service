export default defineNuxtConfig({
  compatibilityDate: '2026-11-03',
  devtools: { enabled: false },
  vite: { server: { allowedHosts: ['host.docker.internal', 'dev.160203.xyz'] } },
  css: ['~/assets/main.css', '~/assets/admin.css'],
  nitro: { preset: 'node-server' },
  typescript: { strict: true },
  app: { head: { htmlAttrs: { lang: 'id' }, title: 'Booking bengkel' } },
})
