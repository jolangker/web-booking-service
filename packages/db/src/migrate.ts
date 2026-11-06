import { fileURLToPath } from 'node:url'
import { migrate } from 'drizzle-orm/node-postgres/migrator'
import type { PoolClient } from 'pg'
import { BOOKING_QUEUE, createDatabase, createQueue, DEMO_QUEUE, INVOICE_DELIVERY_QUEUE, INVOICE_QUEUE, OTP_QUEUE } from './index.js'

const connectionString = process.env.DATABASE_URL
if (!connectionString || !/^postgres(ql)?:\/\//.test(connectionString)) {
  console.error('Invalid environment: DATABASE_URL')
  process.exit(1)
}
const database = createDatabase(connectionString)
const boss = createQueue(connectionString, 'migration')
let lock: PoolClient | undefined
try {
  lock = await database.pool.connect()
  const { rows: [result] } = await lock.query('SELECT pg_try_advisory_lock(731101, 12) AS acquired')
  if (!result.acquired) throw new Error('Another migrator is active')
  await migrate(database.db, {
    migrationsFolder: fileURLToPath(new URL('../drizzle', import.meta.url)),
    migrationsSchema: 'app_migrations',
  })
  await boss.start()
  await boss.createQueue(DEMO_QUEUE, {
    retryLimit: 2, retryDelay: 2, retryBackoff: true,
    expireInSeconds: 30, retentionSeconds: 604800,
  })
  await boss.createQueue(OTP_QUEUE, {
    retryLimit: 5, retryDelay: 5, retryBackoff: true,
    expireInSeconds: 30, retentionSeconds: 600,
  })
  await boss.createQueue(BOOKING_QUEUE, {
    retryLimit: 12, retryDelay: 10, retryBackoff: true, retryDelayMax: 60,
    expireInSeconds: 30, retentionSeconds: 604800,
  })
  await boss.createQueue(INVOICE_QUEUE, {
    retryLimit: 4, retryDelay: 10, retryBackoff: true, retryDelayMax: 120,
    expireInSeconds: 120, retentionSeconds: 604800,
  })
  await boss.createQueue(INVOICE_DELIVERY_QUEUE, {
    retryLimit: 12, retryDelay: 10, retryBackoff: true, retryDelayMax: 60,
    expireInSeconds: 30, retentionSeconds: 604800,
  })
  console.log(JSON.stringify({ event: 'migration.completed' }))
} catch {
  console.error(JSON.stringify({ event: 'migration.failed' }))
  process.exitCode = 1
} finally {
  if (lock) {
    await lock.query('SELECT pg_advisory_unlock(731101, 12)')
    lock.release()
  }
  await boss.stop()
  await database.pool.end()
}
