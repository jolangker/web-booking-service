import { createServer } from 'node:http'
import { authorized, createRuntime, readEnvironment } from '@booking/core'
import { checkDatabase, DEMO_QUEUE } from '@booking/db'

const env = readEnvironment()
const runtime = createRuntime(env, 'worker')
let ready = false
let stopping = false
const log = (event: string, fields = {}) => console.log(JSON.stringify({ event, ...fields }))
const server = createServer(async (request, response) => {
  response.setHeader('Content-Type', 'application/json')
  response.setHeader('Cache-Control', 'no-store')
  if (request.url === '/health/live') return response.end('{"status":"ok"}')
  if (request.url !== '/health/ready') {
    response.statusCode = 404
    return response.end('{"status":"not_found"}')
  }
  if (!authorized(request.headers['x-runtime-token'] as string | undefined, env.healthToken)) {
    response.statusCode = 401
    return response.end('{"status":"unauthorized"}')
  }
  try {
    if (!ready || stopping) throw new Error('Worker not ready')
    await checkDatabase(runtime)
    response.end('{"status":"ready"}')
  } catch {
    response.statusCode = 503
    response.end('{"status":"unavailable"}')
  }
})

async function shutdown(failed = false) {
  if (stopping) return
  stopping = true
  ready = false
  log('worker.stopping')
  const deadline = setTimeout(() => process.exit(1), 20000)
  deadline.unref()
  try {
    await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()))
    await runtime.close()
    log('worker.stopped')
  } catch {
    failed = true
    log('worker.shutdown_failed')
  }
  clearTimeout(deadline)
  process.exitCode = failed ? 1 : 0
}
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => void shutdown())

try {
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject)
    server.listen(env.workerHealthPort, env.workerHealthHost, resolve)
  })
  await checkDatabase(runtime)
  await runtime.startQueue()
  if (env.debugRuntime) {
    await runtime.boss.work<{ runId: string, failOnce: boolean }>(DEMO_QUEUE, { pollingIntervalSeconds: 1 }, async ([job]) => {
      const result = await runtime.pool.query<{ attempts: number }>(
        'UPDATE app.runtime_jobs SET attempts = attempts + 1 WHERE id = $1 AND completed_at IS NULL RETURNING attempts', [job!.data.runId],
      )
      if (!result.rows[0]) return
      const attempt = result.rows[0].attempts
      log('example.attempt', { id: job!.data.runId, queueJobId: job!.id, attempt })
      if (job!.data.failOnce && attempt === 1) throw new Error('Intentional development retry')
      await runtime.pool.query('UPDATE app.runtime_jobs SET completed_at = now() WHERE id = $1 AND completed_at IS NULL', [job!.data.runId])
      log('example.completed', { id: job!.data.runId, queueJobId: job!.id, attempt })
      return { id: job!.data.runId }
    })
  }
  ready = true
  log('worker.ready')
} catch {
  log('worker.start_failed')
  await shutdown(true)
}
