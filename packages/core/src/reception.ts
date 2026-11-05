import { randomUUID } from 'node:crypto'
import type { PoolClient } from 'pg'
import { drizzle, fromDrizzle, sql } from '@booking/db'
import type { Database } from '@booking/db'
import type { Runtime } from './index.js'
import type { Environment } from './env.js'
import { tokenHash } from './admin.js'
import { phoneNumber, uuid, vehicleInput } from './customer.js'
import { BOOKING_QUEUE, bookingInput, createBookingReservation } from './booking.js'
import { dateString, DomainError, generateSlots, getSlots, integer, lockWorkshop, object, readCalendar, text, today, transaction } from './workshop.js'
import type { Calendar } from './workshop.js'

export function receptionInput(value: unknown) {
  const v = object(value)
  return { odometer: integer(v.odometer, 'Odometer (km)', 0, 9999999), initialCondition: text(v.initialCondition, 'Kondisi awal', 2000),
    pit: text(v.pit ?? '', 'Pit', 60, 0), assignee: text(v.assignee ?? '', 'Pelaksana', 100, 0) }
}
export function receptionLookup(value: unknown) {
  const query = text(value, 'Kode booking / plat / QR', 40)
  const match = /^BK-(\d{4})(\d{2})(\d{2})-(\d{3})$/.exec(query)
  if (match && match[4] !== '000') {
    dateString(`${match[1]}-${match[2]}-${match[3]}`)
    return { code: query, plate: '' }
  }
  const plate = query.replace(/\s/g, '').toUpperCase()
  if (!/^[A-Z]{1,2}\d{1,4}[A-Z]{0,3}$/.test(plate)) throw new DomainError(422, 'Gunakan kode booking BK-YYYYMMDD-NNN atau plat kendaraan. QR harus berisi kode booking saja.')
  return { code: '', plate }
}
export function walkInInput(value: unknown) {
  const v = object(value)
  if (Boolean(v.customerId) === Boolean(v.customer) || Boolean(v.vehicleId) === Boolean(v.vehicle)) throw new DomainError(422, 'Pilih identitas existing atau isi data baru, masing-masing satu.')
  if (v.customer && v.vehicleId) throw new DomainError(422, 'Kendaraan existing harus memakai pelanggan pemiliknya.')
  const customer = v.customer ? { name: text(object(v.customer).name, 'Nama', 100), phone: phoneNumber(object(v.customer).phone) } : undefined
  const vehicle = v.vehicle ? vehicleInput(v.vehicle) : undefined
  return { ...bookingInput({ ...v, vehicleId: v.vehicleId ?? v.idempotencyKey }), ...receptionInput(v), customerId: v.customerId ? uuid(v.customerId) : undefined,
    vehicleId: v.vehicleId ? uuid(v.vehicleId) : undefined, customer, vehicle }
}
export function assertReceptionEligible(booking: { status: string, reservation_status: string, checked_in_at: Date | null, version: number, scheduled_at: Date }, version: number, calendar: Calendar, now = new Date()) {
  if (booking.version !== version) throw new DomainError(409, 'Booking telah berubah. Muat ulang sebelum menerima kendaraan.')
  if (booking.reservation_status !== 'active' || booking.status !== 'confirmed' || booking.checked_in_at) throw new DomainError(409, 'Booking dibatalkan atau kendaraan sudah diterima.')
  if (today(booking.scheduled_at) !== today(now)) throw new DomainError(409, 'Check-in hanya pada tanggal jadwal WIB. Gunakan walk-in untuk kunjungan hari lain.')
  const minute = (now.getTime() - new Date(`${today(now)}T00:00:00+07:00`).getTime()) / 60000
  if (!generateSlots(calendar, today(now)).some(s => minute >= s.startMinute && minute < s.endMinute)) throw new DomainError(409, 'Reception hanya tersedia selama jam operasional, di luar istirahat/libur.')
}

async function readOrder(database: Database, bookingId: string, replayed: boolean) {
  const { rows: [workOrder] } = await database.pool.query(`SELECT w.id,w.booking_id AS "bookingId",w.odometer,w.initial_condition AS "initialCondition",w.pit,w.assignee,w.origin,
    w.received_at AS "receivedAt",w.received_by AS "receivedBy",w.version,b.code,b.status,b.version AS "bookingVersion",b.customer_id AS "customerId"
    FROM app.work_orders w JOIN app.bookings b ON b.id=w.booking_id WHERE w.booking_id=$1`, [bookingId])
  return { workOrder, replayed }
}
async function retryOrder(tx: PoolClient, key: string, hash: string) {
  const { rows: [retry] } = await tx.query('SELECT booking_id,request_hash FROM app.work_orders WHERE idempotency_key=$1', [key])
  if (retry && retry.request_hash !== hash) throw new DomainError(409, 'Kunci reception telah dipakai untuk data berbeda.')
  return retry?.booking_id as string | undefined
}
async function receive(tx: PoolClient, runtime: Runtime, adminId: string, bookingId: string, version: number, physical: ReturnType<typeof receptionInput>, key: string, hash: string, origin: 'online' | 'walk_in') {
  await tx.query('SELECT pg_advisory_xact_lock(hashtext($1))', [`booking:${bookingId}`])
  const { rows: [booking] } = await tx.query('SELECT * FROM app.bookings WHERE id=$1 FOR UPDATE', [bookingId])
  if (!booking) throw new DomainError(404, 'Booking tidak ditemukan.')
  const { rows: [existing] } = await tx.query('SELECT odometer,initial_condition,pit,assignee FROM app.work_orders WHERE booking_id=$1', [bookingId])
  if (existing) {
    if (origin !== 'online' || existing.odometer !== physical.odometer || existing.initial_condition !== physical.initialCondition || existing.pit !== physical.pit || existing.assignee !== physical.assignee) throw new DomainError(409, 'Kendaraan sudah diterima dengan data berbeda. Muat ulang WO.')
    return true
  }
  if ((await tx.query('SELECT id FROM app.booking_history WHERE booking_id=$1 AND idempotency_key=$2', [bookingId, key])).rowCount) throw new DomainError(409, 'Kunci sudah dipakai untuk perubahan booking lain.')
  const { rows: [slot] } = await tx.query('SELECT * FROM app.slots WHERE id=$1 FOR UPDATE', [booking.slot_id])
  const calendar = await readCalendar(tx), now = new Date()
  assertReceptionEligible(booking, version, calendar, now)
  if (!slot.active || !generateSlots(calendar, today(booking.scheduled_at)).some(s => s.startMinute === slot.start_minute && s.endMinute === slot.end_minute)) throw new DomainError(409, 'Slot booking tidak operasional.')
  await tx.query(`INSERT INTO app.work_orders(booking_id,odometer,initial_condition,pit,assignee,origin,received_by,received_at,idempotency_key,request_hash,updated_by,updated_at)
    VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$7,$8)`, [bookingId, physical.odometer, physical.initialCondition, physical.pit, physical.assignee, origin, adminId, now, key, hash])
  await tx.query(`INSERT INTO app.work_order_lines(work_order_id,position,kind,service_id,description,quantity,unit_price)
    SELECT w.id,(row_number() OVER(ORDER BY bs.service_id)-1)::int,'service',bs.service_id,bs.name,1,bs.price
    FROM app.work_orders w JOIN app.booking_services bs ON bs.booking_id=w.booking_id WHERE w.booking_id=$1`, [bookingId])
  await tx.query("UPDATE app.bookings SET status='received',checked_in_at=$2,reminder_at=NULL,version=version+1 WHERE id=$1", [bookingId, now])
  await tx.query(`INSERT INTO app.booking_history(booking_id,version,status,reservation_status,action,scheduled_at,idempotency_key,request_hash,occurred_at,actor_id)
    VALUES($1,$2,'received','active','received',$3,$4,$5,$6,$7)`, [bookingId, version + 1, booking.scheduled_at, key, hash, now, adminId])
  await tx.query("UPDATE app.notifications SET status='stale' WHERE booking_id=$1 AND status IN ('queued','retrying','sending')", [bookingId])
  const notificationId = randomUUID()
  const job = await runtime.boss.send(BOOKING_QUEUE, { bookingId, version: version + 1, scheduledAt: booking.scheduled_at.toISOString(), notificationId }, { db: fromDrizzle(drizzle(tx), sql), priority: 0 })
  if (!job) throw new Error('Reception enqueue failed')
  await tx.query("INSERT INTO app.notifications(id,booking_id,booking_version,scheduled_at,kind,queue_job_id) VALUES($1,$2,$3,$4,'received',$5)", [notificationId, bookingId, version + 1, booking.scheduled_at, job])
  return false
}
export async function checkInBooking(runtime: Runtime, adminId: string, id: unknown, value: unknown) {
  const bookingId = uuid(id), v = object(value), physical = receptionInput(v), key = uuid(v.idempotencyKey), version = integer(v.version, 'Versi booking', 1, 2147483647)
  const hash = tokenHash(JSON.stringify({ action: 'check_in', bookingId, version, ...physical }))
  await runtime.startQueue()
  const replayed = await transaction(runtime, async (tx) => {
    await lockWorkshop(tx)
    const retry = await retryOrder(tx, key, hash)
    if (retry) return true
    return receive(tx, runtime, uuid(adminId), bookingId, version, physical, key, hash, 'online')
  })
  return readOrder(runtime, bookingId, replayed)
}
export async function receiveWalkIn(runtime: Runtime, env: Environment, adminId: string, value: unknown) {
  const input = walkInInput(value), hash = tokenHash(JSON.stringify({ action: 'walk_in', ...input }))
  await runtime.startQueue()
  const result = await transaction(runtime, async (tx) => {
    await lockWorkshop(tx)
    const retry = await retryOrder(tx, input.idempotencyKey, hash)
    if (retry) return { id: retry, replayed: true }
    let customerId = input.customerId, vehicleId = input.vehicleId
    if (customerId && !(await tx.query('SELECT id FROM app.customers WHERE id=$1 FOR SHARE', [customerId])).rowCount) throw new DomainError(404, 'Pelanggan tidak ditemukan.')
    if (input.customer) {
      const { rows: [customer] } = await tx.query('INSERT INTO app.customers(name,phone) VALUES($1,$2) ON CONFLICT(phone) DO NOTHING RETURNING id', [input.customer.name, input.customer.phone])
      if (!customer) throw new DomainError(409, 'Nomor sudah terdaftar. Cari dan pilih pelanggan existing.')
      customerId = customer.id
    }
    if (input.vehicle) {
      const { rows: [vehicle] } = await tx.query('INSERT INTO app.vehicles(customer_id,plate,brand,model,year) VALUES($1,$2,$3,$4,$5) ON CONFLICT(plate) DO NOTHING RETURNING id', [customerId, input.vehicle.plate, input.vehicle.brand, input.vehicle.model, input.vehicle.year])
      if (!vehicle) throw new DomainError(409, 'Plat sudah terdaftar. Pilih kendaraan existing; kepemilikan tidak dipindahkan.')
      vehicleId = vehicle.id
    }
    const reservation = await createBookingReservation(tx, runtime, env, customerId!, bookingInput({ ...input, vehicleId }), true)
    await receive(tx, runtime, uuid(adminId), reservation.id, 1, receptionInput(input), input.idempotencyKey, hash, 'walk_in')
    return { id: reservation.id, replayed: false }
  })
  return readOrder(runtime, result.id, result.replayed)
}

export async function receptionDashboard(database: Database, query?: unknown) {
  // Materialize today's slots through the same calendar/quotas guard as booking.
  const slots = await getSlots(database, today())
  const lookup = query === undefined || query === '' ? null : receptionLookup(query)
  return transaction(database, async (tx) => {
    await lockWorkshop(tx)
    const date = today()
    const { rows: bookings } = await tx.query(`SELECT b.id,b.code,b.version,b.status,b.reservation_status AS "reservationStatus",b.scheduled_at AS "scheduledAt",
      b.vehicle_snapshot AS vehicle,b.complaint,c.name AS "customerName",c.phone,b.customer_id AS "customerId",
      w.id AS "workOrderId",w.odometer,w.initial_condition AS "initialCondition",w.pit,w.assignee,w.origin,w.received_at AS "receivedAt",
      (SELECT json_agg(json_build_object('name',bs.name,'price',bs.price) ORDER BY bs.name) FROM app.booking_services bs WHERE bs.booking_id=b.id) AS services
      FROM app.bookings b JOIN app.customers c ON c.id=b.customer_id LEFT JOIN app.work_orders w ON w.booking_id=b.id
      WHERE ${lookup ? '(b.code=$1 OR b.vehicle_snapshot->>\'plate\'=$2 OR EXISTS(SELECT 1 FROM app.vehicles v WHERE v.id=b.vehicle_id AND v.plate=$2))' : "b.reservation_status='active' AND (b.scheduled_at AT TIME ZONE 'Asia/Jakarta')::date=$1::date"}
      ORDER BY b.scheduled_at DESC,b.code DESC`, lookup ? [lookup.code, lookup.plate] : [date])
    const { rows: carryover } = await tx.query(`SELECT b.id,b.code,b.status,b.scheduled_at AS "scheduledAt",b.vehicle_snapshot AS vehicle,w.id AS "workOrderId"
      FROM app.bookings b JOIN app.work_orders w ON w.booking_id=b.id WHERE b.reservation_status='active' AND b.status IN ('received','in_progress','completed')
      AND (b.scheduled_at AT TIME ZONE 'Asia/Jakarta')::date<$1::date ORDER BY b.scheduled_at,b.code`, [date])
    const { rows: [summary] } = await tx.query(`SELECT count(*)::int AS vehicles,count(*) FILTER(WHERE status='confirmed')::int AS waiting,
      count(*) FILTER(WHERE checked_in_at IS NOT NULL)::int AS received FROM app.bookings
      WHERE reservation_status='active' AND (scheduled_at AT TIME ZONE 'Asia/Jakarta')::date=$1::date`, [date])
    const { rows: currentSlots } = await tx.query(`SELECT id,start_minute AS "startMinute",end_minute AS "endMinute",quota,reserved,quota-reserved AS remaining,
      ends_at>clock_timestamp() AS "canWalkIn" FROM app.slots WHERE date=$1 AND active ORDER BY start_minute`, [date])
    return { date, timezone: slots.timezone, bookings, carryover, slots: currentSlots,
      summary: { ...summary, remaining: currentSlots.filter(s => s.canWalkIn).reduce((n, s) => n + s.remaining, 0) }, searched: Boolean(lookup) }
  })
}
