import { checkDatabase } from '@booking/db'
import { requireRuntimeToken, runtime } from '../../utils/runtime'

export default defineEventHandler(async (event) => {
  requireRuntimeToken(event)
  try {
    await checkDatabase(runtime)
    return { status: 'ready' }
  } catch {
    setResponseStatus(event, 503)
    return { status: 'unavailable' }
  }
})
