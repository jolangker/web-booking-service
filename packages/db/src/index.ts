import pg from 'pg'
import { drizzle } from 'drizzle-orm/node-postgres'
import { PgBoss } from 'pg-boss'
import * as schema from './schema.js'

export { eq, sql } from 'drizzle-orm'
export { fromDrizzle } from 'pg-boss'
export { runtimeJobs, admins, adminSessions, loginThrottles, services, workshop, weeklyHours, calendarExceptions, slots } from './schema.js'
export { customers, vehicles, customerSessions, otpChallenges, notifications, deliveryAttempts, deliveryEvents, gatewayDispatch } from './schema.js'
export const QUEUE_SCHEMA = 'queue'
export const DEMO_QUEUE = 'development-example'
export const OTP_QUEUE = 'customer-otp'

export function createDatabase(connectionString: string) {
  const pool = new pg.Pool({
    connectionString, max: 5, connectionTimeoutMillis: 3000,
    statement_timeout: 5000, application_name: 'booking-app',
  })
  // Never print driver errors: they may include connection information or SQL data.
  pool.on('error', () => console.error(JSON.stringify({ event: 'database.connection_error' })))
  return { pool, db: drizzle(pool, { schema }) }
}
export type Database = ReturnType<typeof createDatabase>
export type RuntimeJob = typeof schema.runtimeJobs.$inferSelect

export function createQueue(connectionString: string, role: 'producer' | 'worker' | 'migration') {
  const boss = new PgBoss({
    connectionString, schema: QUEUE_SCHEMA, max: 5,
    connectionTimeoutMillis: 3000,
    migrate: role === 'migration',
    createSchema: role === 'migration',
    schedule: role === 'worker',
    supervise: role === 'worker',
  })
  boss.on('error', () => console.error(JSON.stringify({ event: 'queue.connection_error' })))
  return boss
}

export async function checkDatabase(database: Database) {
  await database.pool.query('SELECT id FROM app.runtime_jobs LIMIT 1')
  await database.pool.query('SELECT version FROM queue.version')
}
