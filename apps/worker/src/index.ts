import { createServer } from 'node:http'
import { authorized, BOOKING_QUEUE, createRuntime, dispatchBooking, dispatchInvoice, dispatchOtp, expireOtpPayloads, INVOICE_DELIVERY_QUEUE, INVOICE_QUEUE, issueInvoice, OTP_QUEUE, readEnvironment } from '@booking/core'
import type { BookingMessage } from '@booking/core'
import { checkDatabase, DEMO_QUEUE } from '@booking/db'
import { renderInvoice } from './pdf.ts'

const env = readEnvironment()
const runtime = createRuntime(env, 'worker')
let ready = false
let stopping = false
let heartbeatAt = Date.now()
let maintenance: ReturnType<typeof setInterval> | undefined
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
    if (Date.now() - heartbeatAt > 90000) throw new Error('Worker maintenance stale')
    await checkDatabase(runtime)
    response.end(JSON.stringify({ status: 'ready', heartbeatAt: new Date(heartbeatAt).toISOString() }))
  } catch {
    response.statusCode = 503
    response.end('{"status":"unavailable"}')
  }
})

async function shutdown(failed = false) {
  if (stopping) return
  stopping = true
  clearInterval(maintenance)
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
  await expireOtpPayloads(runtime)
  await runtime.boss.work<{ challengeId: string }>(OTP_QUEUE, { pollingIntervalSeconds: 1, localConcurrency: 1 }, async ([job]) => {
    await dispatchOtp(runtime, env, job!.data.challengeId, job!.id)
  })
  await runtime.boss.work<BookingMessage>(BOOKING_QUEUE, { pollingIntervalSeconds: 1, localConcurrency: 1 }, async ([job]) => {
    await dispatchBooking(runtime, env, job!.data, job!.id)
  })
  await runtime.boss.work<{ invoiceId: string }>(INVOICE_QUEUE, { pollingIntervalSeconds: 1, localConcurrency: 1 }, async ([job]) => {
    await issueInvoice(runtime, env, job!.data.invoiceId, job!.id, renderInvoice)
  })
  await runtime.boss.work<{ notificationId: string }>(INVOICE_DELIVERY_QUEUE, { pollingIntervalSeconds: 1, localConcurrency: 1 }, async ([job]) => {
    await dispatchInvoice(runtime, env, job!.data.notificationId, job!.id)
  })
  let cleaning = false
  maintenance = setInterval(async () => {
    if (cleaning || stopping) return
    cleaning = true
    try { await expireOtpPayloads(runtime); heartbeatAt = Date.now() }
    catch { log('otp.maintenance_failed') }
    finally { cleaning = false }
  }, 30000)
  maintenance.unref()
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
