import type { H3Event } from 'h3'
import { tokenHash } from '@booking/core'
import { cookieOptions } from './admin'
import { environment } from './runtime'

export const customerCookie = environment.secureCookies ? '__Host-booking_customer' : 'booking_customer'
export const customerCsrfCookie = environment.secureCookies ? '__Host-booking_customer_csrf' : 'booking_customer_csrf'
export function customerScope(event: H3Event) {
  const session = event.context.customer as { id: string, binding: string } | undefined
  return { binding: session?.binding ?? tokenHash(getCookie(event, customerCsrfCookie) ?? '') }
}
export const customerCookieOptions = { ...cookieOptions, maxAge: 7 * 24 * 60 * 60 }
