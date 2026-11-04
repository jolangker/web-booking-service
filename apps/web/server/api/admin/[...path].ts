import { changeCalendar, changeSlotQuota, getCalendar, getSlots, saveService } from '@booking/core'
import { adminBody, adminOperation } from '../../utils/admin'
import { runtime } from '../../utils/runtime'

export default defineEventHandler(event => adminOperation(async () => {
  const path = getRouterParam(event, 'path') ?? ''
  const method = event.method
  if (path === 'services' && method === 'GET') return { services: (await runtime.pool.query('SELECT id,name,price,duration_minutes AS "durationMinutes",active,version FROM app.services ORDER BY created_at,id')).rows }
  if (path === 'services' && method === 'POST') { setResponseStatus(event, 201); return saveService(runtime, await adminBody(event)) }
  const service = /^services\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/.exec(path)
  if (service && method === 'PUT') return saveService(runtime, await adminBody(event), service[1])
  if (path === 'calendar' && method === 'GET') return getCalendar(runtime)
  if (path === 'calendar' && method === 'PUT') return changeCalendar(runtime, await adminBody(event))
  if (path === 'calendar/preview' && method === 'POST') return changeCalendar(runtime, await adminBody(event), true)
  if (path === 'slots' && method === 'GET') return getSlots(runtime, getQuery(event).date)
  const slot = /^slots\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\/quota$/.exec(path)
  if (slot && method === 'PUT') return changeSlotQuota(runtime, slot[1]!, await adminBody(event))
  throw createError({ statusCode: 404, statusMessage: 'Not Found' })
}))
