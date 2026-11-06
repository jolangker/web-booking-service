import { changeCalendar, changeSlotQuota, checkInBooking, customerProfile, deliveryLog, gatewayPairingQr, gatewayStatus, getCalendar, getInvoice, getPayment, getSlots, getWorkOrder, invoiceDeliveries, invoiceFile, listCashier, listWorkOrders, operationalReport, otpStatus, receptionDashboard, receiveWalkIn, requestOtp, retryInvoice, saveCustomer, saveService, saveVehicle, searchCustomers, sendInvoice, settlePayment, startGatewayPairing, tokenHash, updateWorkOrder, verifyOtp } from '@booking/core'
import { adminBody, adminOperation, sessionCookie } from '../../utils/admin'
import { environment, runtime } from '../../utils/runtime'

export default defineEventHandler(event => adminOperation(async () => {
  const path = getRouterParam(event, 'path') ?? ''
  const method = event.method
  if (path === 'reports' && method === 'GET') return operationalReport(runtime, getQuery(event))
  if (path === 'cashier' && method === 'GET') return listCashier(runtime)
  const payment = /^work-orders\/([0-9a-f-]+)\/payment$/.exec(path)
  if (payment && method === 'GET') return { payment: await getPayment(runtime, payment[1]) }
  if (payment && method === 'POST') return settlePayment(runtime, environment, event.context.admin.id, payment[1], await adminBody(event))
  const delivery = /^invoices\/([0-9a-f-]+)\/deliveries$/.exec(path)
  if (delivery && method === 'GET') return invoiceDeliveries(runtime, delivery[1])
  if (delivery && method === 'POST') return sendInvoice(runtime, environment, event.context.admin.id, delivery[1], await adminBody(event))
  const invoice = /^invoices\/([0-9a-f-]+)(?:\/(file|retry))?$/.exec(path)
  if (invoice && !invoice[2] && method === 'GET') return getInvoice(runtime, invoice[1])
  if (invoice && invoice[2] === 'retry' && method === 'POST') { await adminBody(event); return retryInvoice(runtime, environment, invoice[1]) }
  if (invoice && invoice[2] === 'file' && method === 'GET') {
    const file = await invoiceFile(runtime, environment, invoice[1])
    setHeader(event, 'Content-Type', 'application/pdf')
    setHeader(event, 'Content-Disposition', `${getQuery(event).download === '1' ? 'attachment' : 'inline'}; filename="${file.number}.pdf"`)
    setHeader(event, 'Content-Length', file.data.length)
    return send(event, file.data)
  }
  if (path === 'work-orders' && method === 'GET') return listWorkOrders(runtime)
  const workOrder = /^work-orders\/([0-9a-f-]+)$/.exec(path)
  if (workOrder && method === 'GET') return getWorkOrder(runtime, environment, workOrder[1])
  if (workOrder && method === 'POST') return updateWorkOrder(runtime, environment, event.context.admin.id, workOrder[1], await adminBody(event))
  if (path === 'reception' && method === 'GET') return receptionDashboard(runtime, getQuery(event).q)
  if (path === 'reception/walk-in' && method === 'POST') return receiveWalkIn(runtime, environment, event.context.admin.id, await adminBody(event))
  const reception = /^reception\/([0-9a-f-]+)\/check-in$/.exec(path)
  if (reception && method === 'POST') return checkInBooking(runtime, event.context.admin.id, reception[1], await adminBody(event))
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
  if (path === 'gateway/pair' && method === 'POST') { await adminBody(event); return startGatewayPairing(environment) }
  if (path === 'gateway/qr' && method === 'GET') {
    const image = await gatewayPairingQr(environment)
    setHeader(event, 'Content-Type', 'image/png')
    setHeader(event, 'Cache-Control', 'private, no-store, max-age=0')
    setHeader(event, 'Content-Length', image.length)
    return send(event, image)
  }
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
