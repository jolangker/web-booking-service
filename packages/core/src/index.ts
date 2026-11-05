import { randomUUID, timingSafeEqual } from 'node:crypto'
import { createDatabase, createQueue, DEMO_QUEUE, eq, fromDrizzle, runtimeJobs, sql } from '@booking/db'
import type { Environment } from './env.js'
import type { Database, RuntimeJob } from '@booking/db'

export { readEnvironment } from './env.js'
export type { Environment } from './env.js'
export * from './admin.js'
export * from './workshop.js'
export * from './customer.js'
export * from './messaging.js'
export * from './booking.js'
export * from './booking-messaging.js'
export * from './reception.js'

export function authorized(token: string | undefined, expected: string) {
  if (!token) return false
  const actual = Buffer.from(token)
  const target = Buffer.from(expected)
  return actual.length === target.length && timingSafeEqual(actual, target)
}

export interface Runtime extends Database {
  boss: ReturnType<typeof createQueue>
  startQueue(): Promise<unknown>
  enqueueExample(failOnce: boolean, delaySeconds: number): Promise<{ id: string, queueJobId: string }>
  exampleStatus(id: string): Promise<RuntimeJob | undefined>
  close(): Promise<void>
}

export function createRuntime(env: Environment, role: 'producer' | 'worker'): Runtime {
  const database = createDatabase(env.databaseUrl)
  const boss = createQueue(env.databaseUrl, role)
  let starting: Promise<unknown> | undefined
  const startQueue = () => starting ??= boss.start().catch((error: unknown) => {
    starting = undefined
    throw error
  })
  return {
    ...database, boss, startQueue,
    async enqueueExample(failOnce: boolean, delaySeconds: number) {
      await startQueue()
      const runId = randomUUID()
      return database.db.transaction(async (tx) => {
        const queueJobId = await boss.send(DEMO_QUEUE, { runId, failOnce }, {
          db: fromDrizzle(tx, sql), startAfter: delaySeconds,
        })
        if (!queueJobId) throw new Error('Example job was not enqueued')
        await tx.insert(runtimeJobs).values({ id: runId, queueJobId })
        return { id: runId, queueJobId }
      })
    },
    async exampleStatus(id: string) {
      const [row] = await database.db.select().from(runtimeJobs).where(eq(runtimeJobs.id, id))
      return row
    },
    async close() {
      await boss.stop({ graceful: true, timeout: 10000 })
      await database.pool.end()
    },
  }
}
