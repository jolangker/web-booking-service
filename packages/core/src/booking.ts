import { createCipheriv, createDecipheriv, createHash, randomBytes, randomUUID } from 'node:crypto'
import QRCode from 'qrcode'
import { BOOKING_QUEUE, drizzle, fromDrizzle, sql } from '@booking/db'
import type { Database } from '@booking/db'
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
const trackingKey = (env: Environment) => createHash('sha256').update(`booking-tracking:${env.otpSecret}`).digest()
function sealToken(env: Environment, id: string, token: string) {
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
  const requestHash = tokenHash(JSON.stringify(input))
  await runtime.startQueue()
  const result = await transaction(runtime, async (tx) => {
    // Lock ordering is workshop -> customer/vehicle -> slot -> services, also used by Admin calendar/quotas.
    await lockWorkshop(tx)
    const { rows: [retry] } = await tx.query('SELECT id,request_hash FROM app.bookings WHERE customer_id=$1 AND idempotency_key=$2', [customerId, input.idempotencyKey])
    if (retry) {
      if (retry.request_hash !== requestHash) throw new DomainError(409, 'Kunci submit telah dipakai untuk data berbeda. Buat submit baru.')
      return { id: retry.id as string, replayed: true }
    }
    const { rows: [customer] } = await tx.query('SELECT name,verified_at FROM app.customers WHERE id=$1 FOR SHARE', [customerId])
    if (!customer?.verified_at || !customer.name.trim()) throw new DomainError(422, 'Lengkapi nama dan verifikasi WhatsApp sebelum booking.')
    const { rows: [vehicle] } = await tx.query('SELECT plate,brand,model,year FROM app.vehicles WHERE id=$1 AND customer_id=$2 FOR SHARE', [input.vehicleId, customerId])
    if (!vehicle) throw new DomainError(404, 'Kendaraan tidak ditemukan.')
    const now = new Date()
    const calendar = await readCalendar(tx), plan = await planCalendar(tx, calendar, today(now))
    if (plan.conflicts.length) throw new DomainError(409, 'Kalender memiliki konflik reservasi.', { conflicts: plan.conflicts })
    await persistSlots(tx, plan)
    const { rows: [slot] } = await tx.query('SELECT *,date::text AS day FROM app.slots WHERE id=$1 FOR UPDATE', [input.slotId])
    if (!slot) throw new DomainError(404, 'Slot tidak ditemukan.')
    bookingDate(slot.day, now)
    const generated = generateSlots(calendar, slot.day).some(s => s.startMinute === slot.start_minute && s.endMinute === slot.end_minute)
    if (!slot.active || !generated) throw new DomainError(409, 'Slot tidak operasional. Pilih jadwal lain.')
    const { rowCount: duplicates } = await tx.query("SELECT id FROM app.bookings WHERE vehicle_id=$1 AND scheduled_at=$2 AND status<>'cancelled'", [input.vehicleId, slot.starts_at])
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
    const id = randomUUID(), reminderAt = reminderTime(slot.day, now), token = randomBytes(32).toString('base64url')
    await tx.query(`INSERT INTO app.bookings(id,customer_id,vehicle_id,slot_id,code,idempotency_key,request_hash,complaint,vehicle_snapshot,estimated_total,estimated_minutes,scheduled_at,reminder_at)
      VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)`, [id, customerId, input.vehicleId, input.slotId, code, input.idempotencyKey, requestHash, input.complaint, JSON.stringify(vehicle), total, minutes, slot.starts_at, reminderAt])
    for (const s of services) await tx.query('INSERT INTO app.booking_services(booking_id,service_id,name,price,duration_minutes) VALUES($1,$2,$3,$4,$5)', [id, s.id, s.name, s.price, s.duration_minutes])
    await tx.query("INSERT INTO app.booking_history(booking_id,version,status) VALUES($1,1,'confirmed')", [id])
    await tx.query("INSERT INTO app.tracking_tokens(booking_id,token_hash,ciphertext,expires_at) VALUES($1,$2,$3,$4::timestamptz+interval '30 days')", [id, tokenHash(token), sealToken(env, id, token), slot.starts_at])
    // Wrap the SAME PoolClient, inside its open transaction, using pg-boss's public Drizzle adapter.
    const db = fromDrizzle(drizzle(tx), sql)
    for (const kind of ['confirmation', ...(reminderAt ? ['reminder'] : [])]) {
      const notificationId = randomUUID()
      const queueJobId = await runtime.boss.send(BOOKING_QUEUE, { bookingId: id, version: 1, scheduledAt: slot.starts_at.toISOString(), notificationId }, {
        db, priority: 0, ...(kind === 'reminder' ? { startAfter: reminderAt! } : {}),
      })
      if (!queueJobId) throw new Error('Booking enqueue failed')
      await tx.query('INSERT INTO app.notifications(id,booking_id,booking_version,scheduled_at,kind,queue_job_id) VALUES($1,$2,1,$3,$4,$5)', [notificationId, id, slot.starts_at, kind, queueJobId])
    }
    return { id, replayed: false }
  })
  return { ...await bookingDetail(runtime, env, customerId, result.id), replayed: result.replayed }
}

export async function listBookings(database: Database, customerId: string) {
  return { bookings: (await database.pool.query(`SELECT id,code,status,version,scheduled_at AS "scheduledAt",created_at AS "createdAt",vehicle_snapshot AS vehicle,
    estimated_total AS "estimatedTotal" FROM app.bookings WHERE customer_id=$1 ORDER BY created_at DESC,id DESC LIMIT 100`, [customerId])).rows }
}
export async function bookingDetail(database: Database, env: Environment, customerId: string, id: unknown) {
  const { rows: [booking] } = await database.pool.query(`SELECT id,code,status,version,complaint,vehicle_snapshot AS vehicle,estimated_total AS "estimatedTotal",
    estimated_minutes AS "estimatedMinutes",scheduled_at AS "scheduledAt",reminder_at AS "reminderAt",created_at AS "createdAt" FROM app.bookings WHERE id=$1 AND customer_id=$2`, [uuid(id), customerId])
  if (!booking) throw new DomainError(404, 'Booking tidak ditemukan.')
  const services = (await database.pool.query('SELECT name,price,duration_minutes AS "durationMinutes" FROM app.booking_services WHERE booking_id=$1 ORDER BY name', [booking.id])).rows
  const notifications = (await database.pool.query('SELECT kind,status FROM app.notifications WHERE booking_id=$1 ORDER BY created_at', [booking.id])).rows
  const { rows: [token] } = await database.pool.query('SELECT ciphertext FROM app.tracking_tokens WHERE booking_id=$1 AND expires_at>now() AND revoked_at IS NULL', [booking.id])
  const trackingUrl = token ? `${env.appOrigin}/tracking#${openTrackingToken(env, booking.id, token.ciphertext)}` : null
  return { booking: { ...booking, services, notifications, trackingUrl, qrPayload: booking.code, qrDataUrl: await QRCode.toDataURL(booking.code, { width: 256, margin: 4, errorCorrectionLevel: 'M' }) } }
}
export async function trackBooking(database: Database, value: unknown) {
  const token = object(value).token
  if (typeof token !== 'string' || !/^[A-Za-z0-9_-]{43}$/.test(token)) throw new DomainError(404, 'Tautan tracking tidak berlaku.')
  const { rows: [booking] } = await database.pool.query(`SELECT b.status,b.scheduled_at AS "scheduledAt",
    (SELECT json_agg(json_build_object('status',h.status,'occurredAt',h.occurred_at) ORDER BY h.version) FROM app.booking_history h WHERE h.booking_id=b.id) AS history
    FROM app.bookings b JOIN app.tracking_tokens t ON t.booking_id=b.id WHERE t.token_hash=$1 AND t.expires_at>now() AND t.revoked_at IS NULL`, [tokenHash(token)])
  if (!booking) throw new DomainError(404, 'Tautan tracking tidak berlaku.')
  return booking
}
