import { randomBytes } from 'node:crypto'
import { authorized, DomainError } from '@booking/core'
import type { H3Event } from 'h3'
import { environment } from './runtime'

export const sessionCookie = environment.secureCookies ? '__Host-booking_admin' : 'booking_admin'
export const csrfCookie = environment.secureCookies ? '__Host-booking_login_csrf' : 'booking_login_csrf'
export const cookieOptions = { httpOnly: true, secure: environment.secureCookies, sameSite: 'strict' as const, path: '/' }
export function checkOrigin(event: H3Event) {
  if (getHeader(event, 'origin') !== environment.appOrigin) throw createError({ statusCode: 403, statusMessage: 'Origin ditolak.' })
  if (!getHeader(event, 'content-type')?.startsWith('application/json')) throw createError({ statusCode: 415, statusMessage: 'Gunakan application/json.' })
}
export function checkCsrf(event: H3Event, expected: string | undefined) {
  if (!expected || !authorized(getHeader(event, 'x-csrf-token'), expected)) throw createError({ statusCode: 403, statusMessage: 'Proteksi CSRF tidak valid. Muat ulang halaman.' })
}
export function loginCsrf(event: H3Event) {
  const token = randomBytes(32).toString('hex')
  setCookie(event, csrfCookie, token, { ...cookieOptions, maxAge: 900 })
  return token
}
export async function adminBody(event: H3Event) {
  if (Number(getHeader(event, 'content-length') ?? 0) > 65536) throw createError({ statusCode: 413, statusMessage: 'Data terlalu besar.' })
  const raw = await readRawBody(event)
  if (!raw || Buffer.byteLength(raw) > 65536) throw createError({ statusCode: 413, statusMessage: 'Data kosong atau terlalu besar.' })
  try { return JSON.parse(raw) as unknown }
  catch { throw createError({ statusCode: 400, statusMessage: 'JSON tidak valid.' }) }
}
export async function adminOperation<T>(fn: () => Promise<T>) {
  try { return await fn() }
  catch (error) {
    if (error instanceof DomainError) throw createError({ statusCode: error.status, statusMessage: error.message, data: error.details })
    if (isError(error)) throw error
    console.error(JSON.stringify({ event: 'admin.operation_failed' }))
    throw createError({ statusCode: 503, statusMessage: 'Layanan sementara tidak tersedia. Coba lagi.' })
  }
}
