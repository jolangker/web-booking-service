import { createCipheriv, createDecipheriv, createHash, randomBytes, randomUUID } from 'node:crypto'
import QRCode from 'qrcode'
import { BOOKING_QUEUE, drizzle, fromDrizzle, sql } from '@booking/db'
import type { Database } from '@booking/db'
import type { PoolClient } from 'pg'
import type { Runtime } from './index.js'
import type { Environment } from './env.js'
import { tokenHash } from './admin.js'
import { uuid } from './customer.js'
import { addDays, dateString, DomainError, generateSlots, getSlots, lockWorkshop, object, persistSlots, planCalendar, readCalendar, text, today, transaction } from './workshop.js'

export { BOOKING_QUEUE }
export function bookingDate(value: unknown, now = new Date()) {
  const date = dateString(value), day = today(now)
  if (date < addDays(day, 1) || date > addDays(day, 14)) throw new DomainError(422, 'Booking tersedia H+1 sampai H+14 (WIB).')
  return date
}
export function reminderTime(date: string, now = new Date()) {
  const due = new Date(`${addDays(dateString(date), -1)}T16:00:00+07:00`)
  return due > now ? due : null
}
export function bookingCode(date: string, counter: number) {
  if (counter < 1 || counter > 999) throw new DomainError(409, 'Batas 999 kode booking hari ini tercapai. Hubungi bengkel.')
  return `BK-${dateString(date).replaceAll('-', '')}-${String(counter).padStart(3, '0')}`
}
export function bookingInput(value: unknown) {
  const v = object(value)
  if (!Array.isArray(v.serviceIds) || v.serviceIds.length < 1 || v.serviceIds.length > 20) throw new DomainError(422, 'Pilih 1–20 layanan.')
  const serviceIds = v.serviceIds.map(uuid).sort()
  if (new Set(serviceIds).size !== serviceIds.length) throw new DomainError(422, 'Layanan tidak boleh duplikat.')
  return { idempotencyKey: uuid(v.idempotencyKey), vehicleId: uuid(v.vehicleId), slotId: uuid(v.slotId), serviceIds, complaint: text(v.complaint, 'Keluhan', 2000) }
}
export function bookingMutationInput(value: unknown, action: 'reschedule' | 'cancel') {
  const v = object(value)
  if (!Number.isSafeInteger(v.version) || (v.version as number) < 1) throw new DomainError(422, 'Version booking harus bilangan bulat positif.')
  return { version: v.version as number, idempotencyKey: uuid(v.idempotencyKey), ...(action === 'reschedule' ? { slotId: uuid(v.slotId) } : {}) }
}
export function assertBookingMutable(booking: { status: string, reservation_status: string, checked_in_at: Date | null, version: number, scheduled_at: Date }, version: number, now = new Date()) {
  if (booking.version !== version) throw new DomainError(409, 'Booking telah berubah. Muat ulang sebelum melanjutkan.')
  if (booking.reservation_status !== 'active' || booking.status !== 'confirmed' || booking.checked_in_at) throw new DomainError(409, 'Booking sudah dibatalkan atau kendaraan sudah diterima bengkel.')
  if (booking.scheduled_at.getTime() - now.getTime() < 120 * 60 * 1000) throw new DomainError(409, 'Ubah jadwal atau batal hanya tersedia minimal 120 menit sebelum jadwal aktif.')
}
const trackingKey = (env: Environment) => createHash('sha256').update(`booking-tracking:${env.otpSecret}`).digest()
export function sealTrackingToken(env: Environment, id: string, token: string) {
  const iv = randomBytes(12), cipher = createCipheriv('aes-256-gcm', trackingKey(env), iv)
  cipher.setAAD(Buffer.from(id))
  const bytes = Buffer.concat([cipher.update(token, 'utf8'), cipher.final()])
  return Buffer.concat([iv, cipher.getAuthTag(), bytes]).toString('base64')
}
export function openTrackingToken(env: Environment, id: string, value: string) {
  const bytes = Buffer.from(value, 'base64'), cipher = createDecipheriv('aes-256-gcm', trackingKey(env), bytes.subarray(0, 12))
  cipher.setAAD(Buffer.from(id)); cipher.setAuthTag(bytes.subarray(12, 28))
  return Buffer.concat([cipher.update(bytes.subarray(28)), cipher.final()]).toString('utf8')
}

export async function bookingCatalog(database: Database) {
  return { services: (await database.pool.query('SELECT id,name,price,duration_minutes AS "durationMinutes",version FROM app.services WHERE active ORDER BY name,id')).rows,
    from: addDays(today(), 1), to: addDays(today(), 14), timezone: 'Asia/Jakarta' }
}
export async function bookingSlots(database: Database, value: unknown) {
  return getSlots(database, bookingDate(value))
}
export async function reserveBooking(runtime: Runtime, env: Environment, customerId: string, value: unknown) {
  const input = bookingInput(value)
  await runtime.startQueue()
  const result = await transaction(runtime, tx => createBookingReservation(tx, runtime, env, customerId, input))
  return { ...await bookingDetail(runtime, env, customerId, result.id), replayed: result.replayed }
}

// Internal transaction primitive shared by online booking and Admin reception; never take walkIn from an HTTP body.
export async function createBookingReservation(tx: PoolClient, runtime: Runtime, env: Environment, customerId: string, input: ReturnType<typeof bookingInput>, walkIn = false) {
    const requestHash = tokenHash(JSON.stringify(input))
    // Lock ordering is workshop -> customer/vehicle -> slot -> services, also used by Admin calendar/quotas.
    await lockWorkshop(tx)
    const { rows: [retry] } = await tx.query('SELECT id,request_hash FROM app.bookings WHERE customer_id=$1 AND idempotency_key=$2', [customerId, input.idempotencyKey])
    if (retry) {
      if (retry.request_hash !== requestHash) throw new DomainError(409, 'Kunci submit telah dipakai untuk data berbeda. Buat submit baru.')
      return { id: retry.id as string, replayed: true }
    }
    const { rows: [customer] } = await tx.query('SELECT name,verified_at FROM app.customers WHERE id=$1 FOR SHARE', [customerId])
    if (!customer?.name.trim() || (!walkIn && !customer.verified_at)) throw new DomainError(422, 'Lengkapi nama dan verifikasi WhatsApp sebelum booking.')
    const { rows: [vehicle] } = await tx.query('SELECT plate,brand,model,year FROM app.vehicles WHERE id=$1 AND customer_id=$2 FOR SHARE', [input.vehicleId, customerId])
    if (!vehicle) throw new DomainError(404, 'Kendaraan tidak ditemukan.')
    const now = new Date()
    const calendar = await readCalendar(tx), plan = await planCalendar(tx, calendar, today(now))
    if (plan.conflicts.length) throw new DomainError(409, 'Kalender memiliki konflik reservasi.', { conflicts: plan.conflicts })
    await persistSlots(tx, plan)
    const { rows: [slot] } = await tx.query('SELECT *,date::text AS day FROM app.slots WHERE id=$1 FOR UPDATE', [input.slotId])
    if (!slot) throw new DomainError(404, 'Slot tidak ditemukan.')
    if (walkIn) {
      if (slot.day !== today(now) || slot.ends_at <= now) throw new DomainError(409, 'Walk-in hanya pada slot hari ini yang belum berakhir.')
    } else bookingDate(slot.day, now)
    const generated = generateSlots(calendar, slot.day).some(s => s.startMinute === slot.start_minute && s.endMinute === slot.end_minute)
    if (!slot.active || !generated) throw new DomainError(409, 'Slot tidak operasional. Pilih jadwal lain.')
    const { rowCount: duplicates } = await tx.query("SELECT id FROM app.bookings WHERE vehicle_id=$1 AND scheduled_at=$2 AND reservation_status='active'", [input.vehicleId, slot.starts_at])
    if (duplicates) throw new DomainError(409, 'Kendaraan sudah memiliki booking pada jadwal ini.')
    const { rows: services } = await tx.query('SELECT id,name,price,duration_minutes FROM app.services WHERE id=ANY($1::uuid[]) AND active ORDER BY id FOR SHARE', [input.serviceIds])
    if (services.length !== input.serviceIds.length) throw new DomainError(422, 'Layanan tidak aktif atau tidak ditemukan. Muat ulang katalog.')
    const total = services.reduce((sum, s) => sum + s.price, 0), minutes = services.reduce((sum, s) => sum + s.duration_minutes, 0)
    if (total > 2147483647) throw new DomainError(422, 'Total estimasi melampaui batas rupiah yang didukung.')
    const reserved = await tx.query('UPDATE app.slots SET reserved=reserved+1 WHERE id=$1 AND active AND reserved<quota RETURNING id', [input.slotId])
    if (!reserved.rowCount) throw new DomainError(409, 'Slot penuh. Pilih jadwal lain.')
    const issued = today(now)
    const { rows: [counter] } = await tx.query(`INSERT INTO app.booking_counters(date,value) VALUES($1,1)
      ON CONFLICT(date) DO UPDATE SET value=app.booking_counters.value+1 WHERE app.booking_counters.value<999 RETURNING value`, [issued])
    const code = bookingCode(issued, counter?.value ?? 1000)
    const id = randomUUID(), reminderAt = walkIn ? null : reminderTime(slot.day, now), token = randomBytes(32).toString('base64url')
    await tx.query(`INSERT INTO app.bookings(id,customer_id,vehicle_id,slot_id,code,idempotency_key,request_hash,complaint,vehicle_snapshot,estimated_total,estimated_minutes,scheduled_at,reminder_at)
      VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)`, [id, customerId, input.vehicleId, input.slotId, code, input.idempotencyKey, requestHash, input.complaint, JSON.stringify(vehicle), total, minutes, slot.starts_at, reminderAt])
    for (const s of services) await tx.query('INSERT INTO app.booking_services(booking_id,service_id,name,price,duration_minutes) VALUES($1,$2,$3,$4,$5)', [id, s.id, s.name, s.price, s.duration_minutes])
    await tx.query("INSERT INTO app.booking_history(booking_id,version,status,scheduled_at) VALUES($1,1,'confirmed',$2)", [id, slot.starts_at])
    await tx.query("INSERT INTO app.tracking_tokens(booking_id,token_hash,ciphertext,expires_at) VALUES($1,$2,$3,$4::timestamptz+interval '30 days')", [id, tokenHash(token), sealTrackingToken(env, id, token), slot.starts_at])
    // Wrap the SAME PoolClient, inside its open transaction, using pg-boss's public Drizzle adapter.
    const db = fromDrizzle(drizzle(tx), sql)
    for (const kind of walkIn ? [] : ['confirmation', ...(reminderAt ? ['reminder'] : [])]) {
      const notificationId = randomUUID()
      const queueJobId = await runtime.boss.send(BOOKING_QUEUE, { bookingId: id, version: 1, scheduledAt: slot.starts_at.toISOString(), notificationId }, {
        db, priority: 0, ...(kind === 'reminder' ? { startAfter: reminderAt! } : {}),
      })
      if (!queueJobId) throw new Error('Booking enqueue failed')
      await tx.query('INSERT INTO app.notifications(id,booking_id,booking_version,scheduled_at,kind,queue_job_id) VALUES($1,$2,1,$3,$4,$5)', [notificationId, id, slot.starts_at, kind, queueJobId])
    }
    return { id, replayed: false }
}

export async function mutateBooking(runtime: Runtime, env: Environment, customerId: string, id: unknown, action: 'reschedule' | 'cancel', value: unknown) {
  const bookingId = uuid(id), input = bookingMutationInput(value, action)
  const requestHash = tokenHash(JSON.stringify({ action, ...input }))
  await runtime.startQueue()
  const result = await transaction(runtime, async (tx) => {
    // Reception must follow this order too. Worker holds only the booking advisory lock and booking/notification rows.
    await lockWorkshop(tx)
    await tx.query('SELECT pg_advisory_xact_lock(hashtext($1))', [`booking:${bookingId}`])
    const { rows: [booking] } = await tx.query('SELECT * FROM app.bookings WHERE id=$1 AND customer_id=$2 FOR UPDATE', [bookingId, customerId])
    if (!booking) throw new DomainError(404, 'Booking tidak ditemukan.')
    const { rows: [retry] } = await tx.query('SELECT request_hash FROM app.booking_history WHERE booking_id=$1 AND idempotency_key=$2', [bookingId, input.idempotencyKey])
    if (retry) {
      if (retry.request_hash !== requestHash) throw new DomainError(409, 'Kunci perubahan telah dipakai untuk data berbeda.')
      return { replayed: true, unchanged: true }
    }
    if (action === 'cancel' && booking.reservation_status === 'cancelled') return { replayed: true, unchanged: true }
    const slotIds = action === 'reschedule' ? [booking.slot_id, input.slotId!] : [booking.slot_id]
    const { rows: slots } = await tx.query('SELECT *,date::text AS day FROM app.slots WHERE id=ANY($1::uuid[]) ORDER BY id FOR UPDATE', [slotIds])
    const now = new Date()
    assertBookingMutable(booking, input.version, now)
    if (action === 'reschedule' && input.slotId === booking.slot_id) return { replayed: false, unchanged: true }
    const target = action === 'reschedule' ? slots.find(s => s.id === input.slotId) : null
    if (action === 'reschedule') {
      if (!target) throw new DomainError(404, 'Slot tidak ditemukan.')
      bookingDate(target.day, now)
      const calendar = await readCalendar(tx)
      if (!target.active || !generateSlots(calendar, target.day).some(s => s.startMinute === target.start_minute && s.endMinute === target.end_minute)) throw new DomainError(409, 'Slot tidak operasional. Pilih jadwal lain.')
      const duplicate = await tx.query("SELECT id FROM app.bookings WHERE vehicle_id=$1 AND scheduled_at=$2 AND reservation_status='active' AND id<>$3", [booking.vehicle_id, target.starts_at, bookingId])
      if (duplicate.rowCount) throw new DomainError(409, 'Kendaraan sudah memiliki booking pada jadwal ini.')
      const reserved = await tx.query('UPDATE app.slots SET reserved=reserved+1 WHERE id=$1 AND active AND reserved<quota RETURNING id', [target.id])
      if (!reserved.rowCount) throw new DomainError(409, 'Slot penuh. Pilih jadwal lain.')
    }
    // Recheck time after validation/locks, against the original active schedule rather than the requested target.
    const committedAt = new Date()
    assertBookingMutable(booking, input.version, committedAt)
    if (target) bookingDate(target.day, committedAt)
    const released = await tx.query('UPDATE app.slots SET reserved=reserved-1 WHERE id=$1 AND reserved>0 RETURNING id', [booking.slot_id])
    if (!released.rowCount) throw new Error('Booking reservation invariant violated')
    const reservationStatus = target ? 'active' : 'cancelled'
    const scheduledAt = target?.starts_at ?? booking.scheduled_at
    const reminderAt = target ? reminderTime(target.day, committedAt) : null
    const version = booking.version + 1
    await tx.query('UPDATE app.bookings SET slot_id=$2,scheduled_at=$3,reservation_status=$4,reminder_at=$5,version=$6 WHERE id=$1', [bookingId, target?.id ?? booking.slot_id, scheduledAt, reservationStatus, reminderAt, version])
    await tx.query(`INSERT INTO app.booking_history(booking_id,version,status,reservation_status,action,scheduled_at,previous_scheduled_at,idempotency_key,request_hash)
      VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)`, [bookingId, version, booking.status, reservationStatus, target ? 'rescheduled' : 'cancelled', scheduledAt, booking.scheduled_at, input.idempotencyKey, requestHash])
    await tx.query("UPDATE app.notifications SET status='stale' WHERE booking_id=$1 AND status IN ('queued','retrying','sending')", [bookingId])
    if (target) {
      await tx.query("UPDATE app.tracking_tokens SET expires_at=$2::timestamptz+interval '30 days' WHERE booking_id=$1", [bookingId, scheduledAt])
      if (reminderAt) {
        const notificationId = randomUUID()
        const queueJobId = await runtime.boss.send(BOOKING_QUEUE, { bookingId, version, scheduledAt: scheduledAt.toISOString(), notificationId }, { db: fromDrizzle(drizzle(tx), sql), priority: 0, startAfter: reminderAt })
        if (!queueJobId) throw new Error('Booking reminder enqueue failed')
        await tx.query("INSERT INTO app.notifications(id,booking_id,booking_version,scheduled_at,kind,queue_job_id) VALUES($1,$2,$3,$4,'reminder',$5)", [notificationId, bookingId, version, scheduledAt, queueJobId])
      }
    }
    return { replayed: false, unchanged: false }
  })
  return { ...await bookingDetail(runtime, env, customerId, bookingId), ...result }
}

export async function listBookings(database: Database, customerId: string) {
  return { bookings: (await database.pool.query(`SELECT id,code,status,reservation_status AS "reservationStatus",version,scheduled_at AS "scheduledAt",created_at AS "createdAt",vehicle_snapshot AS vehicle,
    (reservation_status='active' AND status='confirmed' AND checked_in_at IS NULL AND scheduled_at>=clock_timestamp()+interval '120 minutes') AS "canManage",
    estimated_total AS "estimatedTotal" FROM app.bookings WHERE customer_id=$1 ORDER BY created_at DESC,id DESC LIMIT 100`, [customerId])).rows }
}
export async function bookingDetail(database: Database, env: Environment, customerId: string, id: unknown) {
  const { rows: [booking] } = await database.pool.query(`SELECT id,slot_id AS "slotId",code,status,reservation_status AS "reservationStatus",version,complaint,vehicle_snapshot AS vehicle,estimated_total AS "estimatedTotal",
    (reservation_status='active' AND status='confirmed' AND checked_in_at IS NULL AND scheduled_at>=clock_timestamp()+interval '120 minutes') AS "canManage",
    estimated_minutes AS "estimatedMinutes",scheduled_at AS "scheduledAt",reminder_at AS "reminderAt",created_at AS "createdAt" FROM app.bookings WHERE id=$1 AND customer_id=$2`, [uuid(id), customerId])
  if (!booking) throw new DomainError(404, 'Booking tidak ditemukan.')
  const services = (await database.pool.query('SELECT name,price,duration_minutes AS "durationMinutes" FROM app.booking_services WHERE booking_id=$1 ORDER BY name', [booking.id])).rows
  const notifications = (await database.pool.query('SELECT id,kind,status,booking_version AS version FROM app.notifications WHERE booking_id=$1 ORDER BY created_at,id', [booking.id])).rows
  const history = (await database.pool.query('SELECT version,status,reservation_status AS "reservationStatus",action,scheduled_at AS "scheduledAt",previous_scheduled_at AS "previousScheduledAt",occurred_at AS "occurredAt" FROM app.booking_history WHERE booking_id=$1 ORDER BY version', [booking.id])).rows
  const { rows: [token] } = await database.pool.query('SELECT ciphertext FROM app.tracking_tokens WHERE booking_id=$1 AND expires_at>now() AND revoked_at IS NULL', [booking.id])
  const trackingUrl = token ? `${env.appOrigin}/tracking#${openTrackingToken(env, booking.id, token.ciphertext)}` : null
  return { booking: { ...booking, services, notifications, history, trackingUrl, qrPayload: booking.code, qrDataUrl: await QRCode.toDataURL(booking.code, { width: 256, margin: 4, errorCorrectionLevel: 'M' }) } }
}
export async function trackBooking(database: Database, value: unknown) {
  const token = object(value).token
  if (typeof token !== 'string' || !/^[A-Za-z0-9_-]{43}$/.test(token)) throw new DomainError(404, 'Tautan tracking tidak berlaku.')
  const { rows: [booking] } = await database.pool.query(`SELECT b.status,b.reservation_status AS "reservationStatus",b.scheduled_at AS "scheduledAt",
    b.code,CASE WHEN length(b.vehicle_snapshot->>'plate')>3 THEN '***' || right(b.vehicle_snapshot->>'plate',3) ELSE '***' END AS "maskedPlate",
    clock_timestamp() AS "fetchedAt",t.expires_at AS "expiresAt",
    (SELECT max(h.occurred_at) FROM app.booking_history h WHERE h.booking_id=b.id) AS "updatedAt",
    (b.status='collected' OR b.reservation_status='cancelled') AS terminal,
    (SELECT json_agg(json_build_object('status',h.status,'reservationStatus',h.reservation_status,'action',h.action,'scheduledAt',h.scheduled_at,'occurredAt',h.occurred_at) ORDER BY h.version) FROM app.booking_history h WHERE h.booking_id=b.id) AS history
    FROM app.bookings b JOIN app.tracking_tokens t ON t.booking_id=b.id WHERE t.token_hash=$1 AND t.expires_at>now() AND t.revoked_at IS NULL`, [tokenHash(token)])
  if (!booking) throw new DomainError(404, 'Tautan tracking tidak berlaku.')
  return booking
}
