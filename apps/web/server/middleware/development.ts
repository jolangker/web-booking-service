import { environment } from '../utils/runtime'

export default defineEventHandler((event) => {
  if (event.path.split('?')[0]?.startsWith('/dev') && !environment.debugRuntime) {
    throw createError({ statusCode: 404, statusMessage: 'Not Found' })
  }
})
