import { authorized, createRuntime, readEnvironment } from '@booking/core'
import type { H3Event } from 'h3'

export const environment = readEnvironment()
export const runtime = createRuntime(environment, 'producer')

export function requireRuntimeToken(event: H3Event) {
  setHeader(event, 'Cache-Control', 'no-store')
  if (!authorized(getHeader(event, 'x-runtime-token'), environment.healthToken)) {
    throw createError({ statusCode: 401, statusMessage: 'Unauthorized' })
  }
}
export function requireDebug(event: H3Event) {
  if (!environment.debugRuntime) throw createError({ statusCode: 404, statusMessage: 'Not Found' })
  requireRuntimeToken(event)
}
