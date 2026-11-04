import { findCustomerSession } from '@booking/core'
import { adminOperation, checkCsrf, checkOrigin } from '../utils/admin'
import { customerCookie, customerCsrfCookie } from '../utils/customer'
import { runtime } from '../utils/runtime'

export default defineEventHandler(async (event) => {
  const path = getRequestURL(event).pathname
  const api = path === '/api/customer' || path.startsWith('/api/customer/')
  const page = path === '/account' || path.startsWith('/account/') || path === '/bookings' || path.startsWith('/bookings/')
  if (!api && !page && path !== '/login') return
  setHeader(event, 'Cache-Control', 'no-store')
  setHeader(event, 'Referrer-Policy', 'same-origin')
  setHeader(event, 'X-Content-Type-Options', 'nosniff')
  setHeader(event, 'X-Frame-Options', 'DENY')
  if (api && !['GET', 'HEAD'].includes(event.method)) checkOrigin(event)
  const session = await adminOperation(() => findCustomerSession(runtime, getCookie(event, customerCookie)))
  if (session) event.context.customer = session
  const publicAuth = path === '/api/customer/auth' || /^\/api\/customer\/otp(?:\/[0-9a-f-]+)?$/.test(path)
  if (!session && !publicAuth && path !== '/login') {
    if (page) return sendRedirect(event, '/login', 302)
    throw createError({ statusCode: 401, statusMessage: 'Silakan masuk sebagai Pelanggan.' })
  }
  if (api && !['GET', 'HEAD'].includes(event.method)) checkCsrf(event, session?.csrfToken ?? getCookie(event, customerCsrfCookie))
})
