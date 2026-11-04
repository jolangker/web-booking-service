import { sql } from 'drizzle-orm'
import { boolean, check, date, index, integer, jsonb, pgSchema, text, timestamp, unique, uuid } from 'drizzle-orm/pg-core'

export const appSchema = pgSchema('app')
export const runtimeJobs = appSchema.table('runtime_jobs', {
  id: uuid('id').primaryKey(),
  queueJobId: uuid('queue_job_id').notNull().unique(),
  attempts: integer('attempts').notNull().default(0),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  completedAt: timestamp('completed_at', { withTimezone: true }),
})

export const admins = appSchema.table('admins', {
  id: uuid('id').primaryKey().defaultRandom(),
  username: text('username').notNull().unique(),
  passwordHash: text('password_hash').notNull(),
  role: text('role').notNull().default('admin'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, t => [check('admin_role', sql`${t.role} = 'admin'`)])

export const adminSessions = appSchema.table('admin_sessions', {
  tokenHash: text('token_hash').primaryKey(),
  adminId: uuid('admin_id').notNull().references(() => admins.id, { onDelete: 'cascade' }),
  csrfToken: text('csrf_token').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  lastSeenAt: timestamp('last_seen_at', { withTimezone: true }).notNull().defaultNow(),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
}, t => [index('admin_session_expiry').on(t.expiresAt)])

export const loginThrottles = appSchema.table('login_throttles', {
  key: text('key').primaryKey(),
  attempts: integer('attempts').notNull(),
  resetsAt: timestamp('resets_at', { withTimezone: true }).notNull(),
})

export const services = appSchema.table('services', {
  id: uuid('id').primaryKey().defaultRandom(),
  name: text('name').notNull(),
  price: integer('price').notNull(),
  durationMinutes: integer('duration_minutes').notNull(),
  active: boolean('active').notNull().default(true),
  version: integer('version').notNull().default(1),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, t => [check('service_values', sql`length(trim(${t.name})) BETWEEN 1 AND 100 AND ${t.price} >= 0 AND ${t.durationMinutes} BETWEEN 1 AND 1440`)])

export const workshop = appSchema.table('workshop', {
  id: integer('id').primaryKey().default(1),
  timezone: text('timezone').notNull().default('Asia/Jakarta'),
  slotMinutes: integer('slot_minutes').notNull().default(60),
  defaultQuota: integer('default_quota').notNull().default(1),
  version: integer('version').notNull().default(1),
}, t => [check('single_workshop', sql`${t.id} = 1 AND ${t.timezone} = 'Asia/Jakarta'`), check('workshop_values', sql`${t.slotMinutes} BETWEEN 5 AND 240 AND ${t.defaultQuota} BETWEEN 0 AND 1000`)])

export const weeklyHours = appSchema.table('weekly_hours', {
  day: integer('day').primaryKey(),
  open: jsonb('open').notNull().$type<{ start: string, end: string }[]>(),
  breaks: jsonb('breaks').notNull().$type<{ start: string, end: string }[]>(),
}, t => [check('weekday', sql`${t.day} BETWEEN 0 AND 6`)])

export const calendarExceptions = appSchema.table('calendar_exceptions', {
  date: date('date').primaryKey(),
  closed: boolean('closed').notNull().default(true),
  quota: integer('quota'),
  reason: text('reason').notNull().default(''),
}, t => [check('exception_quota', sql`${t.quota} IS NULL OR ${t.quota} BETWEEN 0 AND 1000`)])

export const slots = appSchema.table('slots', {
  id: uuid('id').primaryKey().defaultRandom(),
  date: date('date').notNull(),
  startMinute: integer('start_minute').notNull(),
  endMinute: integer('end_minute').notNull(),
  startsAt: timestamp('starts_at', { withTimezone: true }).notNull(),
  endsAt: timestamp('ends_at', { withTimezone: true }).notNull(),
  quota: integer('quota').notNull(),
  quotaOverride: integer('quota_override'),
  reserved: integer('reserved').notNull().default(0),
  active: boolean('active').notNull().default(true),
}, t => [unique('slot_date_interval').on(t.date, t.startMinute, t.endMinute), index('slot_date').on(t.date),
  check('slot_time', sql`${t.startMinute} >= 0 AND ${t.startMinute} < ${t.endMinute} AND ${t.endMinute} <= 1440 AND ${t.startsAt} < ${t.endsAt}`),
  check('slot_capacity', sql`${t.reserved} >= 0 AND ${t.quota} >= ${t.reserved} AND ${t.quota} <= 1000 AND (${t.quotaOverride} IS NULL OR ${t.quotaOverride} BETWEEN 0 AND 1000) AND (${t.active} OR ${t.reserved} = 0)`),
])

export const customers = appSchema.table('customers', {
  id: uuid('id').primaryKey().defaultRandom(),
  name: text('name').notNull().default(''),
  phone: text('phone').notNull().unique(),
  verifiedAt: timestamp('verified_at', { withTimezone: true }),
  version: integer('version').notNull().default(1),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, t => [check('customer_values', sql`${t.phone} ~ '^[+]628[0-9]{8,11}$' AND length(${t.name}) <= 100 AND ${t.version} > 0`)])

export const vehicles = appSchema.table('vehicles', {
  id: uuid('id').primaryKey().defaultRandom(),
  customerId: uuid('customer_id').notNull().references(() => customers.id),
  plate: text('plate').notNull().unique(),
  brand: text('brand').notNull(),
  model: text('model').notNull(),
  year: integer('year').notNull(),
  version: integer('version').notNull().default(1),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, t => [index('vehicle_owner').on(t.customerId), check('vehicle_values', sql`${t.plate} ~ '^[A-Z]{1,2}[0-9]{1,4}[A-Z]{0,3}$' AND length(trim(${t.brand})) BETWEEN 1 AND 60 AND length(trim(${t.model})) BETWEEN 1 AND 80 AND ${t.year} BETWEEN 1900 AND 2200 AND ${t.version} > 0`)])

export const customerSessions = appSchema.table('customer_sessions', {
  tokenHash: text('token_hash').primaryKey(),
  customerId: uuid('customer_id').notNull().references(() => customers.id),
  csrfToken: text('csrf_token').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  lastSeenAt: timestamp('last_seen_at', { withTimezone: true }).notNull().defaultNow(),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
}, t => [index('customer_session_expiry').on(t.expiresAt)])

export const otpChallenges = appSchema.table('otp_challenges', {
  id: uuid('id').primaryKey(),
  phone: text('phone').notNull(),
  purpose: text('purpose').notNull(),
  customerId: uuid('customer_id').references(() => customers.id),
  binding: text('binding').notNull(),
  verifier: text('verifier'),
  ciphertext: text('ciphertext'),
  attempts: integer('attempts').notNull().default(0),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  invalidatedAt: timestamp('invalidated_at', { withTimezone: true }),
  consumedAt: timestamp('consumed_at', { withTimezone: true }),
}, t => [index('otp_phone_created').on(t.phone, t.createdAt), check('otp_values', sql`${t.purpose} IN ('login','contact') AND (${t.purpose} = 'login' OR ${t.customerId} IS NOT NULL) AND ${t.attempts} BETWEEN 0 AND 3 AND ${t.expiresAt} <= ${t.createdAt} + interval '5 minutes'`)])

export const notifications = appSchema.table('notifications', {
  id: uuid('id').primaryKey().defaultRandom(),
  challengeId: uuid('challenge_id').notNull().unique().references(() => otpChallenges.id),
  queueJobId: uuid('queue_job_id').notNull().unique(),
  status: text('status').notNull().default('queued'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, t => [check('notification_status', sql`${t.status} IN ('queued','retrying','sending','accepted','sent','delivered','read','failed','unknown','stale')`)])

export const deliveryAttempts = appSchema.table('delivery_attempts', {
  id: uuid('id').primaryKey().defaultRandom(),
  notificationId: uuid('notification_id').notNull().references(() => notifications.id),
  outcome: text('outcome').notNull(),
  httpStatus: integer('http_status'),
  messageId: text('message_id').unique(),
  startedAt: timestamp('started_at', { withTimezone: true }).notNull().defaultNow(),
  finishedAt: timestamp('finished_at', { withTimezone: true }),
}, t => [index('delivery_notification').on(t.notificationId)])

// Only the correlation fields are retained; never persist the webhook's raw payload.
export const deliveryEvents = appSchema.table('delivery_events', {
  messageId: text('message_id').notNull(),
  ack: integer('ack').notNull(),
  receivedAt: timestamp('received_at', { withTimezone: true }).notNull().defaultNow(),
}, t => [unique('delivery_event_dedup').on(t.messageId, t.ack), check('delivery_ack', sql`${t.ack} BETWEEN -1 AND 4`)])

export const gatewayDispatch = appSchema.table('gateway_dispatch', {
  id: integer('id').primaryKey().default(1),
  nextAt: timestamp('next_at', { withTimezone: true }).notNull().defaultNow(),
}, t => [check('single_gateway_dispatch', sql`${t.id} = 1`)])
