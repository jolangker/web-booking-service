import { requireDebug, runtime } from '../../../utils/runtime'

export default defineEventHandler(async (event) => {
  requireDebug(event)
  const id = getRouterParam(event, 'id') ?? ''
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) throw createError({ statusCode: 400, statusMessage: 'Invalid id' })
  let job
  try { job = await runtime.exampleStatus(id) } catch {
    throw createError({ statusCode: 503, statusMessage: 'Database unavailable' })
  }
  if (!job) throw createError({ statusCode: 404, statusMessage: 'Not Found' })
  return job
})
