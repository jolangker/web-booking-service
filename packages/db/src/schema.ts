import { sql } from 'drizzle-orm'
import { boolean, check, date, index, integer, jsonb, pgSchema, text, timestamp, unique, uniqueIndex, uuid } from 'drizzle-orm/pg-core'

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

export const bookingCounters = appSchema.table('booking_counters', {
  date: date('date').primaryKey(),
  value: integer('value').notNull(),
}, t => [check('booking_counter_range', sql`${t.value} BETWEEN 1 AND 999`)])

export const bookings = appSchema.table('bookings', {
  id: uuid('id').primaryKey().defaultRandom(),
  customerId: uuid('customer_id').notNull().references(() => customers.id),
  vehicleId: uuid('vehicle_id').notNull().references(() => vehicles.id),
  slotId: uuid('slot_id').notNull().references(() => slots.id),
  code: text('code').notNull().unique(),
  idempotencyKey: uuid('idempotency_key').notNull(),
  requestHash: text('request_hash').notNull(),
  complaint: text('complaint').notNull(),
  vehicleSnapshot: jsonb('vehicle_snapshot').notNull().$type<{ plate: string, brand: string, model: string, year: number }>(),
  estimatedTotal: integer('estimated_total').notNull(),
  estimatedMinutes: integer('estimated_minutes').notNull(),
  status: text('status').notNull().default('confirmed'),
  reservationStatus: text('reservation_status').notNull().default('active'),
  checkedInAt: timestamp('checked_in_at', { withTimezone: true }),
  version: integer('version').notNull().default(1),
  scheduledAt: timestamp('scheduled_at', { withTimezone: true }).notNull(),
  reminderAt: timestamp('reminder_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, t => [unique('booking_customer_retry').on(t.customerId, t.idempotencyKey),
  index('booking_customer_created').on(t.customerId, t.createdAt),
  unique('booking_id_owner').on(t.id, t.customerId),
  index('booking_slot').on(t.slotId),
  uniqueIndex('booking_vehicle_slot_active').on(t.vehicleId, t.scheduledAt).where(sql`${t.reservationStatus} = 'active'`),
  check('booking_values', sql`${t.code} ~ '^BK-[0-9]{8}-[0-9]{3}$' AND length(trim(${t.complaint})) BETWEEN 1 AND 2000 AND ${t.estimatedTotal} >= 0 AND ${t.estimatedMinutes} > 0 AND ${t.version} > 0`),
  check('booking_status', sql`${t.status} IN ('confirmed','received','in_progress','completed','collected')`),
  check('booking_reservation_status', sql`${t.reservationStatus} IN ('active','cancelled') AND (${t.reservationStatus} <> 'cancelled' OR (${t.status} = 'confirmed' AND ${t.checkedInAt} IS NULL))`),
])

export const bookingServices = appSchema.table('booking_services', {
  bookingId: uuid('booking_id').notNull().references(() => bookings.id),
  serviceId: uuid('service_id').notNull().references(() => services.id),
  name: text('name').notNull(),
  price: integer('price').notNull(),
  durationMinutes: integer('duration_minutes').notNull(),
}, t => [unique('booking_service').on(t.bookingId, t.serviceId), check('booking_service_values', sql`${t.price} >= 0 AND ${t.durationMinutes} > 0`)])

export const bookingHistory = appSchema.table('booking_history', {
  id: uuid('id').primaryKey().defaultRandom(),
  bookingId: uuid('booking_id').notNull().references(() => bookings.id),
  version: integer('version').notNull(),
  status: text('status').notNull(),
  reservationStatus: text('reservation_status').notNull().default('active'),
  action: text('action').notNull().default('created'),
  scheduledAt: timestamp('scheduled_at', { withTimezone: true }).notNull(),
  previousScheduledAt: timestamp('previous_scheduled_at', { withTimezone: true }),
  idempotencyKey: uuid('idempotency_key'),
  requestHash: text('request_hash'),
  actorId: uuid('actor_id').references(() => admins.id),
  estimate: jsonb('estimate').$type<{ currency: 'IDR', workOrderVersion: number, lines: { kind: string, description: string, quantity: number, unitPrice: number }[], serviceSubtotal: number, partSubtotal: number, total: number }>(),
  occurredAt: timestamp('occurred_at', { withTimezone: true }).notNull().defaultNow(),
}, t => [unique('booking_history_version').on(t.bookingId, t.version), unique('booking_mutation_retry').on(t.bookingId, t.idempotencyKey),
  check('booking_history_reservation', sql`${t.reservationStatus} IN ('active','cancelled')`)])

export const workOrders = appSchema.table('work_orders', {
  id: uuid('id').primaryKey().defaultRandom(),
  bookingId: uuid('booking_id').notNull().unique().references(() => bookings.id),
  odometer: integer('odometer').notNull(),
  initialCondition: text('initial_condition').notNull(),
  pit: text('pit').notNull().default(''),
  assignee: text('assignee').notNull().default(''),
  diagnosis: text('diagnosis').notNull().default(''),
  inspection: text('inspection').notNull().default(''),
  notes: text('notes').notNull().default(''),
  updatedBy: uuid('updated_by').references(() => admins.id),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  origin: text('origin').notNull(),
  receivedBy: uuid('received_by').notNull().references(() => admins.id),
  receivedAt: timestamp('received_at', { withTimezone: true }).notNull(),
  version: integer('version').notNull().default(1),
  idempotencyKey: uuid('idempotency_key').notNull().unique(),
  requestHash: text('request_hash').notNull(),
}, t => [check('work_order_values', sql`${t.odometer} BETWEEN 0 AND 9999999 AND length(trim(${t.initialCondition})) BETWEEN 1 AND 2000 AND length(${t.pit}) <= 60 AND length(${t.assignee}) <= 100 AND ${t.version} > 0 AND ${t.origin} IN ('online','walk_in')`),
  check('work_order_notes', sql`length(${t.diagnosis}) <= 2000 AND length(${t.inspection}) <= 2000 AND length(${t.notes}) <= 4000`)])

export const workOrderLines = appSchema.table('work_order_lines', {
  workOrderId: uuid('work_order_id').notNull().references(() => workOrders.id),
  position: integer('position').notNull(),
  kind: text('kind').notNull(),
  serviceId: uuid('service_id').references(() => services.id),
  description: text('description').notNull(),
  quantity: integer('quantity').notNull(),
  unitPrice: integer('unit_price').notNull(),
}, t => [unique('work_order_line_position').on(t.workOrderId, t.position),
  check('work_order_line_values', sql`${t.position} BETWEEN 0 AND 99 AND ${t.kind} IN ('service','part') AND (${t.kind}='service')=(${t.serviceId} IS NOT NULL) AND length(trim(${t.description})) BETWEEN 1 AND 200 AND ${t.quantity} BETWEEN 1 AND 999 AND ${t.unitPrice} BETWEEN 0 AND 2147483647 AND ${t.quantity}::bigint*${t.unitPrice} <= 2147483647`)])

export const workOrderChanges = appSchema.table('work_order_changes', {
  id: uuid('id').primaryKey().defaultRandom(),
  workOrderId: uuid('work_order_id').notNull().references(() => workOrders.id),
  version: integer('version').notNull(),
  action: text('action').notNull(),
  actorId: uuid('actor_id').notNull().references(() => admins.id),
  reason: text('reason').notNull(),
  before: jsonb('before').notNull(),
  after: jsonb('after').notNull(),
  idempotencyKey: uuid('idempotency_key').notNull().unique(),
  requestHash: text('request_hash').notNull(),
  occurredAt: timestamp('occurred_at', { withTimezone: true }).notNull().defaultNow(),
}, t => [unique('work_order_change_version').on(t.workOrderId, t.version),
  check('work_order_change_values', sql`${t.version} > 1 AND ${t.action} IN ('save','start','complete','rotate_tracking','revoke_tracking') AND length(trim(${t.reason})) BETWEEN 1 AND 500`)])

export const invoiceCounters = appSchema.table('invoice_counters', {
  date: date('date').primaryKey(),
  value: integer('value').notNull(),
}, t => [check('invoice_counter_range', sql`${t.value} BETWEEN 1 AND 999999`)])

export const payments = appSchema.table('payments', {
  id: uuid('id').primaryKey(),
  bookingId: uuid('booking_id').notNull().unique().references(() => bookings.id),
  workOrderId: uuid('work_order_id').notNull().unique().references(() => workOrders.id),
  method: text('method').notNull(),
  reference: text('reference').notNull(),
  status: text('status').notNull().default('paid'),
  total: integer('total').notNull(),
  received: integer('received').notNull(),
  change: integer('change').notNull(),
  paidBy: uuid('paid_by').notNull().references(() => admins.id),
  paidAt: timestamp('paid_at', { withTimezone: true }).notNull(),
  idempotencyKey: uuid('idempotency_key').notNull().unique(),
  requestHash: text('request_hash').notNull(),
}, t => [check('payment_values', sql`${t.status}='paid' AND ${t.total} BETWEEN 1 AND 2147483647 AND ${t.received} >= ${t.total} AND ${t.change}=${t.received}-${t.total} AND ((${t.method}='cash' AND ${t.reference}='') OR (${t.method} IN ('qris','edc') AND ${t.received}=${t.total} AND length(trim(${t.reference})) BETWEEN 1 AND 100))`)])

export const invoices = appSchema.table('invoices', {
  id: uuid('id').primaryKey(),
  paymentId: uuid('payment_id').notNull().unique().references(() => payments.id),
  number: text('number').notNull().unique(),
  snapshot: jsonb('snapshot').notNull(),
  status: text('status').notNull().default('pending'),
  queueJobId: uuid('queue_job_id').notNull(),
  attempts: integer('attempts').notNull().default(0),
  lastError: text('last_error'),
  fileHash: text('file_hash'),
  fileSize: integer('file_size'),
  readyAt: timestamp('ready_at', { withTimezone: true }),
}, t => [check('invoice_number', sql`${t.number} ~ '^INV-[0-9]{8}-[0-9]{6}$'`),
  check('invoice_issuance', sql`${t.status} IN ('pending','ready','failed') AND ${t.attempts}>=0 AND (${t.status}<>'ready' OR (${t.fileHash} IS NOT NULL AND ${t.fileSize}>0 AND ${t.readyAt} IS NOT NULL))`)])

export const invoiceLines = appSchema.table('invoice_lines', {
  invoiceId: uuid('invoice_id').notNull().references(() => invoices.id),
  position: integer('position').notNull(),
  kind: text('kind').notNull(),
  description: text('description').notNull(),
  quantity: integer('quantity').notNull(),
  unitPrice: integer('unit_price').notNull(),
}, t => [unique('invoice_line_position').on(t.invoiceId, t.position),
  check('invoice_line_values', sql`${t.position} BETWEEN 0 AND 99 AND ${t.kind} IN ('service','part') AND length(trim(${t.description})) BETWEEN 1 AND 200 AND ${t.quantity} BETWEEN 1 AND 999 AND ${t.unitPrice}>=0 AND ${t.quantity}::bigint*${t.unitPrice}<=2147483647`)])

export const serviceArchives = appSchema.table('service_archives', {
  id: uuid('id').primaryKey(),
  bookingId: uuid('booking_id').notNull().unique().references(() => bookings.id),
  invoiceId: uuid('invoice_id').notNull().unique().references(() => invoices.id),
  customerId: uuid('customer_id').notNull().references(() => customers.id),
  vehicleId: uuid('vehicle_id').notNull().references(() => vehicles.id),
  snapshot: jsonb('snapshot').notNull(),
  archivedAt: timestamp('archived_at', { withTimezone: true }).notNull(),
}, t => [index('service_archive_owner').on(t.customerId, t.vehicleId, t.archivedAt)])

export const trackingTokens = appSchema.table('tracking_tokens', {
  bookingId: uuid('booking_id').primaryKey().references(() => bookings.id),
  tokenHash: text('token_hash').notNull().unique(),
  ciphertext: text('ciphertext').notNull(),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  revokedAt: timestamp('revoked_at', { withTimezone: true }),
})

export const notifications = appSchema.table('notifications', {
  id: uuid('id').primaryKey().defaultRandom(),
  challengeId: uuid('challenge_id').unique().references(() => otpChallenges.id),
  invoiceId: uuid('invoice_id').references(() => invoices.id),
  requestKey: uuid('request_key').unique(),
  requestedBy: uuid('requested_by').references(() => admins.id),
  recipientPhone: text('recipient_phone'),
  bookingId: uuid('booking_id').references(() => bookings.id),
  bookingVersion: integer('booking_version'),
  scheduledAt: timestamp('scheduled_at', { withTimezone: true }),
  kind: text('kind').notNull().default('otp'),
  queueJobId: uuid('queue_job_id').notNull().unique(),
  status: text('status').notNull().default('queued'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, t => [unique('booking_notification_version').on(t.bookingId, t.bookingVersion, t.kind),
  index('invoice_delivery_created').on(t.invoiceId, t.createdAt),
  check('notification_target', sql`((${t.kind} = 'otp' AND ${t.challengeId} IS NOT NULL AND ${t.bookingId} IS NULL AND ${t.bookingVersion} IS NULL AND ${t.scheduledAt} IS NULL) OR (${t.kind} IN ('confirmation','reminder','received','in_progress','completed') AND ${t.challengeId} IS NULL AND ${t.bookingId} IS NOT NULL AND ${t.bookingVersion} IS NOT NULL AND ${t.bookingVersion} > 0 AND ${t.scheduledAt} IS NOT NULL)) AND ${t.invoiceId} IS NULL AND ${t.requestKey} IS NULL AND ${t.requestedBy} IS NULL AND ${t.recipientPhone} IS NULL OR (${t.kind}='invoice' AND ${t.invoiceId} IS NOT NULL AND ${t.requestKey} IS NOT NULL AND ${t.requestedBy} IS NOT NULL AND ${t.recipientPhone} ~ '^[+]628[0-9]{8,11}$' AND ${t.recipientPhone} IS NOT NULL AND ${t.challengeId} IS NULL AND ${t.bookingId} IS NULL AND ${t.bookingVersion} IS NULL AND ${t.scheduledAt} IS NULL)`),
  check('notification_status', sql`${t.status} IN ('queued','retrying','sending','accepted','sent','delivered','read','failed','unknown','stale')`)])

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
