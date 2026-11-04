import { findAdminSession, loginAdmin, logoutAdmin, SESSION_SECONDS } from '@booking/core'
import { adminBody, adminOperation, checkCsrf, cookieOptions, csrfCookie, loginCsrf, sessionCookie } from '../../utils/admin'
import { runtime } from '../../utils/runtime'

export default defineEventHandler(event => adminOperation(async () => {
  if (event.method === 'GET') {
    const session = await findAdminSession(runtime, getCookie(event, sessionCookie))
    return session ? { authenticated: true, username: session.username, csrfToken: session.csrfToken } : { authenticated: false, csrfToken: loginCsrf(event) }
  }
  if (event.method === 'POST') {
    checkCsrf(event, getCookie(event, csrfCookie))
    const session = await loginAdmin(runtime, await adminBody(event))
    const previous = getCookie(event, sessionCookie)
    if (previous) await logoutAdmin(runtime, previous)
    setCookie(event, sessionCookie, session.token, { ...cookieOptions, maxAge: SESSION_SECONDS })
    deleteCookie(event, csrfCookie, cookieOptions)
    return { authenticated: true, username: session.username, csrfToken: session.csrfToken }
  }
  if (event.method === 'DELETE') {
    await logoutAdmin(runtime, getCookie(event, sessionCookie)!)
    deleteCookie(event, sessionCookie, cookieOptions)
    return { ok: true }
  }
  throw createError({ statusCode: 405, statusMessage: 'Method Not Allowed' })
}))
