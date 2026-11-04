import { findAdminSession } from '@booking/core'
import { adminOperation, checkCsrf, checkOrigin, sessionCookie } from '../utils/admin'
import { runtime } from '../utils/runtime'

export default defineEventHandler(async (event) => {
  const path = getRequestURL(event).pathname
  const api = path === '/api/admin' || path.startsWith('/api/admin/')
  const page = path === '/admin' || path.startsWith('/admin/')
  if (!api && !page) return
  setHeader(event, 'Cache-Control', 'no-store')
  setHeader(event, 'Referrer-Policy', 'same-origin')
  setHeader(event, 'X-Content-Type-Options', 'nosniff')
  setHeader(event, 'X-Frame-Options', 'DENY')
  if (page && path === '/admin/login') return
  const auth = path === '/api/admin/auth'
  if (api && !['GET', 'HEAD'].includes(event.method)) checkOrigin(event)
  if (auth && ['GET', 'POST'].includes(event.method)) return
  const session = await adminOperation(() => findAdminSession(runtime, getCookie(event, sessionCookie)))
  if (!session) {
    if (page) return sendRedirect(event, '/admin/login', 302)
    throw createError({ statusCode: 401, statusMessage: 'Silakan login sebagai Admin.' })
  }
  event.context.admin = session
  if (api && !['GET', 'HEAD'].includes(event.method)) checkCsrf(event, session.csrfToken)
})
