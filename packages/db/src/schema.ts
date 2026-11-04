import { integer, pgSchema, timestamp, uuid } from 'drizzle-orm/pg-core'

export const appSchema = pgSchema('app')
export const runtimeJobs = appSchema.table('runtime_jobs', {
  id: uuid('id').primaryKey(),
  queueJobId: uuid('queue_job_id').notNull().unique(),
  attempts: integer('attempts').notNull().default(0),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  completedAt: timestamp('completed_at', { withTimezone: true }),
})
