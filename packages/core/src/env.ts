import { isAbsolute, resolve } from 'node:path'

export function readEnvironment(source: NodeJS.ProcessEnv = process.env) {
  const invalid = new Set<string>()
  const required = (name: string) => {
    const value = source[name] ?? ''
    if (!value || value.startsWith('REPLACE')) invalid.add(name)
    return value
  }
  const appEnv = required('APP_ENV')
  if (!['development', 'staging', 'production'].includes(appEnv)) invalid.add('APP_ENV')
  const appOrigin = source.APP_ORIGIN ?? (appEnv === 'development' ? 'http://127.0.0.1:3000' : '')
  try {
    const url = new URL(appOrigin)
    if (url.origin !== appOrigin || url.username || url.password || (appEnv !== 'development' && url.protocol !== 'https:') || !['http:', 'https:'].includes(url.protocol)) invalid.add('APP_ORIGIN')
  } catch { invalid.add('APP_ORIGIN') }
  const databaseUrl = required('DATABASE_URL')
  try {
    const url = new URL(databaseUrl)
    if (!['postgres:', 'postgresql:'].includes(url.protocol) || !url.hostname || !url.pathname.slice(1) || decodeURIComponent(url.password).startsWith('REPLACE')) invalid.add('DATABASE_URL')
  } catch { invalid.add('DATABASE_URL') }
  const healthToken = required('HEALTH_TOKEN')
  const wahaApiKey = required('WAHA_API_KEY')
  const otpSecret = required('OTP_SECRET')
  const wahaWebhookSecret = required('WAHA_WEBHOOK_SECRET')
  for (const [name, value] of [['HEALTH_TOKEN', healthToken], ['WAHA_API_KEY', wahaApiKey], ['OTP_SECRET', otpSecret], ['WAHA_WEBHOOK_SECRET', wahaWebhookSecret]]) {
    if (value!.length < 32) invalid.add(name!)
  }
  if (new Set([healthToken, wahaApiKey, otpSecret, wahaWebhookSecret]).size !== 4) invalid.add('SECRETS_MUST_DIFFER')
  const wahaBaseUrl = required('WAHA_BASE_URL')
  try {
    const url = new URL(wahaBaseUrl)
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.search || url.hash || (url.pathname !== '/' && url.pathname !== '') || (url.protocol === 'http:' && (appEnv !== 'development' || !['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname)))) invalid.add('WAHA_BASE_URL')
  } catch { invalid.add('WAHA_BASE_URL') }
  const debug = source.DEBUG_RUNTIME ?? 'false'
  if (!['true', 'false'].includes(debug) || (appEnv !== 'development' && debug === 'true')) invalid.add('DEBUG_RUNTIME')
  const healthPort = Number(source.WORKER_HEALTH_PORT ?? 3002)
  if (!Number.isInteger(healthPort) || healthPort < 1 || healthPort > 65535) invalid.add('WORKER_HEALTH_PORT')
  const invoiceStoragePath = source.INVOICE_STORAGE_PATH ?? resolve('storage/invoices')
  if (!isAbsolute(invoiceStoragePath)) invalid.add('INVOICE_STORAGE_PATH')
  if (invalid.size) throw new Error(`Invalid environment: ${[...invalid].join(', ')}`)
  return {
    appEnv, appOrigin, databaseUrl, healthToken, wahaApiKey, wahaBaseUrl, otpSecret, wahaWebhookSecret,
    debugRuntime: appEnv === 'development' && debug === 'true',
    workerHealthHost: source.WORKER_HEALTH_HOST ?? '127.0.0.1',
    workerHealthPort: healthPort,
    invoiceStoragePath,
    workshopName: source.WORKSHOP_NAME?.trim() ?? '',
    workshopAddress: source.WORKSHOP_ADDRESS?.trim() ?? '',
    workshopPhone: source.WORKSHOP_PHONE?.trim() ?? '',
  }
}
export type Environment = ReturnType<typeof readEnvironment>
