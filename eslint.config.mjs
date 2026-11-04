import { createConfigForNuxt } from '@nuxt/eslint-config/flat'

export default createConfigForNuxt({
  features: { stylistic: false },
  dirs: { src: ['apps/web/app', 'apps/web/server'] },
}).append({
  ignores: ['**/dist/**', '**/.nuxt/**', '**/.output/**', 'packages/db/drizzle/**'],
}, {
  rules: { 'vue/multi-word-component-names': 'off' },
})
