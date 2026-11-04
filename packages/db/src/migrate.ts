import { fileURLToPath } from 'node:url'
import { migrate } from 'drizzle-orm/node-postgres/migrator'
import { createDatabase, createQueue, DEMO_QUEUE } from './index.js'

const connectionString = process.env.DATABASE_URL
if (!connectionString || !/^postgres(ql)?:\/\//.test(connectionString)) {
  console.error('Invalid environment: DATABASE_URL')
  process.exit(1)
}
const database = createDatabase(connectionString)
const boss = createQueue(connectionString, 'migration')
try {
  await migrate(database.db, {
    migrationsFolder: fileURLToPath(new URL('../drizzle', import.meta.url)),
    migrationsSchema: 'app_migrations',
  })
  await boss.start()
  await boss.createQueue(DEMO_QUEUE, {
    retryLimit: 2, retryDelay: 2, retryBackoff: true,
    expireInSeconds: 30, retentionSeconds: 604800,
  })
  console.log(JSON.stringify({ event: 'migration.completed' }))
} catch {
  console.error(JSON.stringify({ event: 'migration.failed' }))
  process.exitCode = 1
} finally {
  await boss.stop()
  await database.pool.end()
}
