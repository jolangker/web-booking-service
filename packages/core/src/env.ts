export function readEnvironment(source: NodeJS.ProcessEnv = process.env) {
  const invalid = new Set<string>()
  const required = (name: string) => {
    const value = source[name] ?? ''
    if (!value || value.startsWith('REPLACE')) invalid.add(name)
    return value
  }
  const appEnv = required('APP_ENV')
  if (!['development', 'staging', 'production'].includes(appEnv)) invalid.add('APP_ENV')
  const databaseUrl = required('DATABASE_URL')
  try {
    const url = new URL(databaseUrl)
    if (!['postgres:', 'postgresql:'].includes(url.protocol) || !url.hostname || !url.pathname.slice(1) || decodeURIComponent(url.password).startsWith('REPLACE')) invalid.add('DATABASE_URL')
  } catch { invalid.add('DATABASE_URL') }
  const healthToken = required('HEALTH_TOKEN')
  const wahaApiKey = required('WAHA_API_KEY')
  for (const [name, value] of [['HEALTH_TOKEN', healthToken], ['WAHA_API_KEY', wahaApiKey]]) {
    if (value!.length < 32) invalid.add(name!)
  }
  const wahaBaseUrl = required('WAHA_BASE_URL')
  try {
    const url = new URL(wahaBaseUrl)
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || (appEnv !== 'development' && url.protocol !== 'https:')) invalid.add('WAHA_BASE_URL')
  } catch { invalid.add('WAHA_BASE_URL') }
  const debug = source.DEBUG_RUNTIME ?? 'false'
  if (!['true', 'false'].includes(debug) || (appEnv !== 'development' && debug === 'true')) invalid.add('DEBUG_RUNTIME')
  const healthPort = Number(source.WORKER_HEALTH_PORT ?? 3002)
  if (!Number.isInteger(healthPort) || healthPort < 1 || healthPort > 65535) invalid.add('WORKER_HEALTH_PORT')
  if (invalid.size) throw new Error(`Invalid environment: ${[...invalid].join(', ')}`)
  return {
    appEnv, databaseUrl, healthToken, wahaApiKey, wahaBaseUrl,
    debugRuntime: appEnv === 'development' && debug === 'true',
    workerHealthHost: source.WORKER_HEALTH_HOST ?? '127.0.0.1',
    workerHealthPort: healthPort,
  }
}
export type Environment = ReturnType<typeof readEnvironment>
