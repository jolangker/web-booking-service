import { requireDebug, runtime } from '../../utils/runtime'

export default defineEventHandler(async (event) => {
  requireDebug(event)
  const body: unknown = await readBody(event)
  if (!body || typeof body !== 'object' || Array.isArray(body)) throw createError({ statusCode: 400, statusMessage: 'Invalid request' })
  const { failOnce = false, delaySeconds = 0 } = body as Record<string, unknown>
  if (typeof failOnce !== 'boolean' || typeof delaySeconds !== 'number' || !Number.isInteger(delaySeconds) || delaySeconds < 0 || delaySeconds > 120) {
    throw createError({ statusCode: 400, statusMessage: 'Invalid request' })
  }
  try {
    const job = await runtime.enqueueExample(failOnce, delaySeconds)
    setResponseStatus(event, 202)
    return job
  } catch {
    throw createError({ statusCode: 503, statusMessage: 'Queue unavailable' })
  }
})
