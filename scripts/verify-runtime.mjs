// Directed integration smoke check. Run dev:web first, with no other dev worker.
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { once } from 'node:events'
import { randomUUID } from 'node:crypto'
import { setTimeout as delay } from 'node:timers/promises'
import { readEnvironment, createRuntime } from '../packages/core/dist/index.js'
import { DEMO_QUEUE, fromDrizzle, runtimeJobs, sql } from '../packages/db/dist/index.js'

const env = readEnvironment()
assert(env.debugRuntime, 'Smoke check requires development and DEBUG_RUNTIME=true')
const base = 'http://127.0.0.1:3000'
const headers = { 'x-runtime-token': env.healthToken }
const runtime = createRuntime(env, 'producer')
let worker
let workerOutput = ''
async function request(path, options = {}) {
  return fetch(`${base}${path}`, { headers, ...options, signal: AbortSignal.timeout(10000) })
}
async function eventually(check, message) {
  for (let attempt = 0; attempt < 45; attempt++) {
    if (await check()) return
    await delay(1000)
  }
  throw new Error(message)
}
async function startWorker() {
  workerOutput = ''
  worker = spawn(process.execPath, ['apps/worker/dist/index.js'], {
    env: { ...process.env, WORKER_HEALTH_PORT: '3102' }, stdio: ['ignore', 'pipe', 'pipe'],
  })
  worker.stdout.on('data', chunk => { workerOutput += chunk })
  worker.stderr.on('data', () => {})
  await eventually(async () => {
    if (worker.exitCode !== null) throw new Error('Smoke worker exited at startup')
    return workerOutput.includes('worker.ready')
  }, 'Worker did not become ready')
}
async function stopWorker() {
  if (!worker || worker.exitCode !== null) return
  const exited = once(worker, 'exit')
  worker.kill('SIGTERM')
  await exited
  worker = undefined
}
async function compose(...args) {
  const child = spawn('docker', ['compose', '--env-file', '.env', '-f', 'infra/compose.dev.yml', ...args], { stdio: 'ignore' })
  const [code] = await once(child, 'exit')
  assert.equal(code, 0, `Compose ${args[0]} failed`)
}

try {
  assert.equal((await request('/health/live', { headers: {} })).status, 200)
  assert.equal((await request('/health/ready', { headers: {} })).status, 401)
  assert.equal((await request('/health/ready')).status, 200)
  assert.equal((await request('/api/dev/jobs', { method: 'POST', headers: { ...headers, 'Content-Type': 'application/json' }, body: '{"delaySeconds":-1}' })).status, 400)
  console.log('PASS liveness, protected readiness, input validation')

  await runtime.startQueue()
  const rolledBackId = randomUUID()
  let rolledBackQueueId
  await assert.rejects(runtime.db.transaction(async (tx) => {
    rolledBackQueueId = await runtime.boss.send(DEMO_QUEUE, { runId: rolledBackId }, { db: fromDrizzle(tx, sql) })
    await tx.insert(runtimeJobs).values({ id: rolledBackId, queueJobId: rolledBackQueueId })
    throw new Error('Smoke rollback')
  }), /Smoke rollback/)
  assert.equal(await runtime.exampleStatus(rolledBackId), undefined)
  const rolledBackQueue = await runtime.boss.getJobById(DEMO_QUEUE, rolledBackQueueId)
  assert.equal(rolledBackQueue, null)
  console.log('PASS Drizzle/pg-boss atomic rollback')

  await startWorker()
  const response = await request('/api/dev/jobs', {
    method: 'POST', headers: { ...headers, 'Content-Type': 'application/json' },
    body: JSON.stringify({ failOnce: true, delaySeconds: 10 }),
  })
  assert.equal(response.status, 202)
  const job = await response.json()
  await stopWorker()
  const pending = await (await request(`/api/dev/jobs/${job.id}`)).json()
  assert.equal(pending.attempts, 0, 'Another worker may be running; stop dev:worker before this check')
  assert.equal(pending.completedAt, null)
  await startWorker()
  await eventually(async () => {
    const result = await (await request(`/api/dev/jobs/${job.id}`)).json()
    if (!result.completedAt) return false
    assert.equal(result.id, job.id)
    assert.equal(result.queueJobId, job.queueJobId)
    assert.equal(result.attempts, 2)
    const queued = await runtime.boss.getJobById(DEMO_QUEUE, job.queueJobId)
    return queued?.state === 'completed'
  }, 'Job did not complete after restart and retry')
  console.log('PASS persistent identity, worker restart, retry, queue completion')

  if (process.argv.includes('--recovery')) {
    try {
      await compose('stop', 'postgres')
      assert.equal((await request('/health/ready')).status, 503)
      assert.deepEqual(await (await request('/health/live')).json(), { status: 'ok' })
      const workerReady = await fetch('http://127.0.0.1:3102/health/ready', { headers })
      assert.equal(workerReady.status, 503)
    } finally { await compose('up', '-d', '--wait', 'postgres') }
    await eventually(async () => (await request('/health/ready')).status === 200, 'Web did not recover')
    const restored = await (await request(`/api/dev/jobs/${job.id}`)).json()
    assert.equal(restored.queueJobId, job.queueJobId)
    assert(restored.completedAt)
    const recoveryJob = await runtime.enqueueExample(false, 0)
    await eventually(async () => Boolean((await runtime.exampleStatus(recoveryJob.id))?.completedAt), 'Worker did not recover')
    await compose('up', '-d', '--wait', '--force-recreate', 'postgres', 'waha')
    await eventually(async () => (await request('/health/ready')).status === 200, 'Readiness failed after container replacement')
    assert((await runtime.exampleStatus(job.id))?.completedAt)
    console.log('PASS DB outage/recovery, worker resumes, DB persistence after container replacement')
  }
} finally {
  await stopWorker()
  await runtime.close()
}
