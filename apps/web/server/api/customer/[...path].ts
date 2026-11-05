import { randomBytes } from 'node:crypto'
import { bookingCatalog, bookingDetail, bookingSlots, customerInvoice, customerInvoiceFile, customerProfile, customerReturnPath, customerVehicle, historyVehicles, listBookings, logoutCustomer, mutateBooking, object, otpStatus, requestOtp, reserveBooking, saveCustomer, saveVehicle, vehicleHistory, verifyOtp } from '@booking/core'
import { adminBody, adminOperation, cookieOptions } from '../../utils/admin'
import { customerCookie, customerCookieOptions, customerCsrfCookie, customerScope } from '../../utils/customer'
import { environment, runtime } from '../../utils/runtime'

export default defineEventHandler(event => adminOperation(async () => {
  const path = getRouterParam(event, 'path') ?? '', method = event.method
  const session = event.context.customer as { id: string, csrfToken: string, binding: string } | undefined
  if (path === 'auth' && method === 'GET') {
    const returnPath = customerReturnPath(getQuery(event).returnTo)
    if (session) return { authenticated: true, csrfToken: session.csrfToken, returnPath }
    // Retain the binding across reloads so a pending challenge can still be verified.
    let csrf = getCookie(event, customerCsrfCookie)
    if (!csrf || !/^[a-f0-9]{64}$/.test(csrf)) csrf = randomBytes(32).toString('hex')
    setCookie(event, customerCsrfCookie, csrf, { ...cookieOptions, maxAge: 900 })
    return { authenticated: false, csrfToken: csrf, returnPath }
  }
  if (path === 'auth' && method === 'POST') {
    const result = await verifyOtp(runtime, environment, await adminBody(event), customerScope(event))
    if (!('token' in result) || typeof result.token !== 'string') throw createError({ statusCode: 401, statusMessage: 'Login tidak valid.' })
    const previous = getCookie(event, customerCookie)
    if (previous) await logoutCustomer(runtime, previous)
    setCookie(event, customerCookie, result.token, customerCookieOptions)
    deleteCookie(event, customerCsrfCookie, cookieOptions)
    return { authenticated: true, csrfToken: result.csrfToken }
  }
  if (path === 'auth' && method === 'DELETE' && session) {
    await logoutCustomer(runtime, getCookie(event, customerCookie)!)
    deleteCookie(event, customerCookie, cookieOptions)
    return { ok: true }
  }
  const ip = getRequestIP(event, { xForwardedFor: false }) ?? 'unknown'
  if (path === 'otp' && method === 'POST') return requestOtp(runtime, environment, await adminBody(event), ip, customerScope(event))
  const otp = /^otp\/([0-9a-f-]+)$/.exec(path)
  if (otp && method === 'GET') return otpStatus(runtime, otp[1], customerScope(event))
  if (!session) throw createError({ statusCode: 401, statusMessage: 'Silakan masuk.' })
  if (path === 'history' && method === 'GET') return historyVehicles(runtime, session.id)
  const history = /^history\/([0-9a-f-]+)$/.exec(path)
  if (history && method === 'GET') return vehicleHistory(runtime, session.id, history[1], getQuery(event).page ?? 1)
  const invoice = /^invoices\/([0-9a-f-]+)(?:\/(file))?$/.exec(path)
  if (invoice && method === 'GET') {
    if (!invoice[2]) return customerInvoice(runtime, session.id, invoice[1])
    const file = await customerInvoiceFile(runtime, environment, session.id, invoice[1])
    setHeader(event, 'Content-Type', 'application/pdf')
    setHeader(event, 'Content-Disposition', `${getQuery(event).download === '1' ? 'attachment' : 'inline'}; filename="${file.number}.pdf"`)
    setHeader(event, 'Content-Length', file.data.length)
    return send(event, file.data)
  }
  if (path === 'catalog' && method === 'GET') return bookingCatalog(runtime)
  if (path === 'slots' && method === 'GET') return bookingSlots(runtime, getQuery(event).date)
  if (path === 'bookings' && method === 'GET') return listBookings(runtime, session.id)
  if (path === 'bookings' && method === 'POST') {
    const result = await reserveBooking(runtime, environment, session.id, await adminBody(event))
    setResponseStatus(event, result.replayed ? 200 : 201)
    return result
  }
  const booking = /^bookings\/([0-9a-f-]+)$/.exec(path)
  if (booking && method === 'GET') return bookingDetail(runtime, environment, session.id, booking[1])
  const mutation = /^bookings\/([0-9a-f-]+)\/(reschedule|cancel)$/.exec(path)
  if (mutation && method === 'POST') return mutateBooking(runtime, environment, session.id, mutation[1], mutation[2] as 'reschedule' | 'cancel', await adminBody(event))
  if (path === 'profile' && method === 'GET') return customerProfile(runtime, session.id)
  if (path === 'profile' && method === 'PUT') return saveCustomer(runtime, await adminBody(event), session.id)
  if (path === 'contact/otp' && method === 'POST') return requestOtp(runtime, environment, await adminBody(event), ip, { binding: session.binding, customerId: session.id })
  const contactOtp = /^contact\/otp\/([0-9a-f-]+)$/.exec(path)
  if (contactOtp && method === 'GET') return otpStatus(runtime, contactOtp[1], { binding: session.binding, customerId: session.id })
  if (path === 'contact/verify' && method === 'POST') {
    const result = await verifyOtp(runtime, environment, object(await adminBody(event)), { binding: session.binding, customerId: session.id })
    deleteCookie(event, customerCookie, cookieOptions)
    return result
  }
  if (path === 'vehicles' && method === 'POST') { setResponseStatus(event, 201); return saveVehicle(runtime, session.id, await adminBody(event)) }
  const vehicle = /^vehicles\/([0-9a-f-]+)$/.exec(path)
  if (vehicle && method === 'GET') return customerVehicle(runtime, session.id, vehicle[1]!)
  if (vehicle && method === 'PUT') return saveVehicle(runtime, session.id, await adminBody(event), vehicle[1])
  // A customer cannot select a different profile/owner through URL or request body.
  throw createError({ statusCode: 404, statusMessage: 'Not Found' })
}))
