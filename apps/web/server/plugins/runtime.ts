import { runtime } from '../utils/runtime'

export default defineNitroPlugin((nitroApp) => {
  nitroApp.hooks.hook('close', () => runtime.close())
})
