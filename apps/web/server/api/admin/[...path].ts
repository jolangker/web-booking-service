import { changeCalendar, changeSlotQuota, customerProfile, deliveryLog, gatewayStatus, getCalendar, getSlots, otpStatus, requestOtp, saveCustomer, saveService, saveVehicle, searchCustomers, tokenHash, verifyOtp } from '@booking/core'
import { adminBody, adminOperation, sessionCookie } from '../../utils/admin'
import { environment, runtime } from '../../utils/runtime'

export default defineEventHandler(event => adminOperation(async () => {
  const path = getRouterParam(event, 'path') ?? ''
  const method = event.method
  if (path === 'customers' && method === 'GET') return searchCustomers(runtime, getQuery(event).q)
  if (path === 'customers' && method === 'POST') { setResponseStatus(event, 201); return saveCustomer(runtime, await adminBody(event)) }
  const customer = /^customers\/([0-9a-f-]+)$/.exec(path)
  if (customer && method === 'GET') return customerProfile(runtime, customer[1]!)
  if (customer && method === 'PUT') return saveCustomer(runtime, await adminBody(event), customer[1])
  const vehicle = /^customers\/([0-9a-f-]+)\/vehicles(?:\/([0-9a-f-]+))?$/.exec(path)
  if (vehicle && method === (vehicle[2] ? 'PUT' : 'POST')) {
    if (!vehicle[2]) setResponseStatus(event, 201)
    return saveVehicle(runtime, vehicle[1]!, await adminBody(event), vehicle[2])
  }
  const contact = /^customers\/([0-9a-f-]+)\/contact\/(otp|verify)(?:\/([0-9a-f-]+))?$/.exec(path)
  if (contact) {
    const scope = { binding: tokenHash(getCookie(event, sessionCookie)!), customerId: contact[1]! }
    if (contact[2] === 'otp' && !contact[3] && method === 'POST') return requestOtp(runtime, environment, await adminBody(event), getRequestIP(event, { xForwardedFor: false }) ?? 'unknown', scope)
    if (contact[2] === 'otp' && contact[3] && method === 'GET') return otpStatus(runtime, contact[3], scope)
    if (contact[2] === 'verify' && !contact[3] && method === 'POST') return verifyOtp(runtime, environment, await adminBody(event), scope)
  }
  if (path === 'gateway' && method === 'GET') return gatewayStatus(environment)
  if (path === 'deliveries' && method === 'GET') return deliveryLog(runtime)
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
