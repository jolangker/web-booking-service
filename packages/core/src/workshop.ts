import type { Database } from '@booking/db'
import type { PoolClient } from 'pg'

export const TIMEZONE = 'Asia/Jakarta'
export class DomainError extends Error {
  constructor(public status: number, message: string, public details: unknown = undefined) { super(message) }
}
export function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new DomainError(422, 'Data harus berupa objek.')
  return value as Record<string, unknown>
}
export function integer(value: unknown, field: string, min: number, max: number) {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < min || value > max) throw new DomainError(422, `${field}: masukkan bilangan bulat ${min}–${max}.`)
  return value
}
export function text(value: unknown, field: string, max: number, min = 1) {
  if (typeof value !== 'string' || value.trim().length < min || value.trim().length > max) throw new DomainError(422, `${field}: panjang harus ${min}–${max} karakter.`)
  return value.trim()
}
export function dateString(value: unknown) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value) || !Number.isFinite(Date.parse(`${value}T00:00:00Z`)) || new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) !== value) throw new DomainError(422, 'Tanggal tidak valid.')
  return value
}
export function today(now = new Date()) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: TIMEZONE, year: 'numeric', month: '2-digit', day: '2-digit' }).format(now)
}
export function addDays(date: string, days: number) {
  const value = new Date(`${date}T00:00:00Z`)
  value.setUTCDate(value.getUTCDate() + days)
  return value.toISOString().slice(0, 10)
}
export interface Range { start: string, end: string }
export interface DayHours { day: number, open: Range[], breaks: Range[] }
export interface Exception { date: string, closed: boolean, quota: number | null, reason: string }
export interface Calendar { version: number, timezone: string, slotMinutes: number, defaultQuota: number, days: DayHours[], exceptions: Exception[] }
export interface Slot { id: string, date: string, startMinute: number, endMinute: number, quota: number, quotaOverride: number | null, reserved: number, active: boolean }
export function minute(time: string) {
  if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(time) && time !== '24:00') throw new DomainError(422, 'Jam harus HH:mm (00:00–24:00).')
  return Number(time.slice(0, 2)) * 60 + Number(time.slice(3))
}
function ranges(value: unknown, label: string): Range[] {
  if (!Array.isArray(value) || value.length > 12) throw new DomainError(422, `${label}: maksimal 12 rentang.`)
  const result = value.map((item) => {
    const v = object(item)
    const start = text(v.start, label, 5), end = text(v.end, label, 5)
    if (minute(start) >= minute(end)) throw new DomainError(422, `${label}: jam mulai harus sebelum selesai.`)
    return { start, end }
  }).sort((a, b) => minute(a.start) - minute(b.start))
  if (result.some((v, i) => i > 0 && minute(v.start) < minute(result[i - 1]!.end))) throw new DomainError(422, `${label}: rentang bertumpuk.`)
  return result
}
export function validateCalendar(value: unknown): Calendar {
  const v = object(value)
  if (v.timezone !== TIMEZONE) throw new DomainError(422, `Timezone bengkel adalah ${TIMEZONE}.`)
  if (!Array.isArray(v.days) || v.days.length !== 7) throw new DomainError(422, 'Isi tujuh hari operasional.')
  const days = v.days.map((item) => {
    const d = object(item), day = integer(d.day, 'Hari', 0, 6)
    const open = ranges(d.open, 'Jam buka'), breaks = ranges(d.breaks, 'Istirahat')
    if (breaks.some(b => !open.some(o => minute(b.start) >= minute(o.start) && minute(b.end) <= minute(o.end)))) throw new DomainError(422, 'Istirahat harus berada dalam jam buka.')
    return { day, open, breaks }
  })
  if (new Set(days.map(d => d.day)).size !== 7) throw new DomainError(422, 'Hari tidak boleh duplikat.')
  if (!Array.isArray(v.exceptions) || v.exceptions.length > 366) throw new DomainError(422, 'Maksimal 366 pengecualian tanggal.')
  const exceptions = v.exceptions.map((item) => {
    const e = object(item)
    if (typeof e.closed !== 'boolean') throw new DomainError(422, 'Status libur tidak valid.')
    return { date: dateString(e.date), closed: e.closed, quota: e.quota === null ? null : integer(e.quota, 'Kuota tanggal', 0, 1000), reason: text(e.reason, 'Keterangan', 200, 0) }
  })
  if (new Set(exceptions.map(e => e.date)).size !== exceptions.length) throw new DomainError(422, 'Tanggal pengecualian tidak boleh duplikat.')
  return { version: integer(v.version, 'Versi', 1, 2147483647), timezone: TIMEZONE, slotMinutes: integer(v.slotMinutes, 'Durasi slot', 5, 240), defaultQuota: integer(v.defaultQuota, 'Kuota standar', 0, 1000), days, exceptions }
}
export function generateSlots(calendar: Calendar, date: string) {
  const exception = calendar.exceptions.find(e => e.date === date)
  if (exception?.closed) return []
  const day = calendar.days.find(d => d.day === new Date(`${date}T00:00:00Z`).getUTCDay())!
  const result: { date: string, startMinute: number, endMinute: number, quota: number }[] = []
  for (const open of day.open) {
    for (let start = minute(open.start); start + calendar.slotMinutes <= minute(open.end); start += calendar.slotMinutes) {
      const end = start + calendar.slotMinutes
      if (!day.breaks.some(b => start < minute(b.end) && end > minute(b.start))) result.push({ date, startMinute: start, endMinute: end, quota: exception?.quota ?? calendar.defaultQuota })
    }
  }
  return result
}
export async function transaction<T>(database: Database, fn: (tx: PoolClient) => Promise<T>) {
  const tx = await database.pool.connect()
  try { await tx.query('BEGIN'); const result = await fn(tx); await tx.query('COMMIT'); return result }
  catch (error) { await tx.query('ROLLBACK'); throw error }
  finally { tx.release() }
}
// Booking/cancel/reschedule must acquire this SAME lock before changing slots/reserved.
export async function lockWorkshop(tx: PoolClient) { await tx.query('SELECT id FROM app.workshop WHERE id=1 FOR UPDATE') }
export async function readCalendar(tx: PoolClient): Promise<Calendar> {
  const { rows: [settings] } = await tx.query('SELECT version, timezone, slot_minutes AS "slotMinutes", default_quota AS "defaultQuota" FROM app.workshop WHERE id=1')
  const { rows: days } = await tx.query('SELECT day, open, breaks FROM app.weekly_hours ORDER BY day')
  const { rows: exceptions } = await tx.query('SELECT date::text, closed, quota, reason FROM app.calendar_exceptions ORDER BY date')
  return { ...settings, days, exceptions }
}
export async function readSlots(tx: PoolClient, from: string, to: string): Promise<Slot[]> {
  return (await tx.query('SELECT id,date::text,start_minute AS "startMinute",end_minute AS "endMinute",quota,quota_override AS "quotaOverride",reserved,active FROM app.slots WHERE date BETWEEN $1 AND $2 ORDER BY date,start_minute,end_minute', [from, to])).rows
}
export async function planCalendar(tx: PoolClient, calendar: Calendar, from = today()) {
  const horizon = addDays(from, 14)
  const { rows: [{ end }] } = await tx.query('SELECT GREATEST(COALESCE(MAX(date), $1::date), $1::date)::text AS end FROM app.slots WHERE date >= $2', [horizon, from])
  const existing = await readSlots(tx, from, end)
  const proposed = []
  for (let date = from; date <= end; date = addDays(date, 1)) proposed.push(...generateSlots(calendar, date))
  const byKey = new Map(proposed.map(s => [`${s.date}/${s.startMinute}`, s]))
  const conflicts = existing.filter(s => s.reserved > 0).flatMap((s) => {
    const target = byKey.get(`${s.date}/${s.startMinute}`)
    const quota = s.quotaOverride ?? target?.quota ?? 0
    const reason = !target || target.endMinute !== s.endMinute ? 'Slot berisi reservasi akan ditutup/diubah.' : quota < s.reserved ? 'Kuota di bawah reservasi aktif.' : null
    return reason ? [{ slotId: s.id, date: s.date, startMinute: s.startMinute, reserved: s.reserved, reason }] : []
  })
  const bookings = conflicts.length ? (await tx.query("SELECT slot_id,code,status FROM app.bookings WHERE slot_id=ANY($1::uuid[]) AND reservation_status='active' ORDER BY code", [conflicts.map(c => c.slotId)])).rows : []
  return { from, to: end as string, proposed, existing, conflicts: conflicts.map(c => ({ ...c, bookings: bookings.filter(b => b.slot_id === c.slotId).map(b => ({ code: b.code, status: b.status })) })) }
}
export async function persistSlots(tx: PoolClient, plan: Awaited<ReturnType<typeof planCalendar>>) {
  await tx.query('UPDATE app.slots SET active=false WHERE date BETWEEN $1 AND $2 AND reserved=0', [plan.from, plan.to])
  // Batch upsert keeps stable IDs and per-slot quota overrides across horizon extension.
  if (plan.proposed.length) await tx.query(`INSERT INTO app.slots(date,start_minute,end_minute,starts_at,ends_at,quota)
    SELECT x.date,x.start,x.finish,(x.date::timestamp + x.start * interval '1 minute') AT TIME ZONE 'Asia/Jakarta',
      (x.date::timestamp + x.finish * interval '1 minute') AT TIME ZONE 'Asia/Jakarta',x.quota
    FROM jsonb_to_recordset($1::jsonb) AS x(date date,start int,finish int,quota int)
    ON CONFLICT(date,start_minute,end_minute) DO UPDATE SET quota=COALESCE(app.slots.quota_override,EXCLUDED.quota),active=true`,
  [JSON.stringify(plan.proposed.map(s => ({ date: s.date, start: s.startMinute, finish: s.endMinute, quota: s.quota })))])
}
export async function getCalendar(database: Database) {
  return transaction(database, async (tx) => { await lockWorkshop(tx); return readCalendar(tx) })
}
export async function changeCalendar(database: Database, value: unknown, preview = false) {
  const calendar = validateCalendar(value)
  return transaction(database, async (tx) => {
    await lockWorkshop(tx)
    const current = await readCalendar(tx)
    if (calendar.version !== current.version) throw new DomainError(409, 'Kalender berubah. Muat ulang sebelum menyimpan.')
    const plan = await planCalendar(tx, calendar)
    if (preview) return { conflicts: plan.conflicts, slots: plan.proposed, from: plan.from, to: plan.to }
    if (plan.conflicts.length) throw new DomainError(409, 'Perubahan ditolak karena konflik reservasi.', { conflicts: plan.conflicts })
    await tx.query('UPDATE app.workshop SET slot_minutes=$1,default_quota=$2,version=version+1 WHERE id=1', [calendar.slotMinutes, calendar.defaultQuota])
    await tx.query('DELETE FROM app.weekly_hours')
    for (const day of calendar.days) await tx.query('INSERT INTO app.weekly_hours VALUES($1,$2,$3)', [day.day, JSON.stringify(day.open), JSON.stringify(day.breaks)])
    await tx.query('DELETE FROM app.calendar_exceptions')
    for (const e of calendar.exceptions) await tx.query('INSERT INTO app.calendar_exceptions VALUES($1,$2,$3,$4)', [e.date, e.closed, e.quota, e.reason])
    await persistSlots(tx, plan)
    return { calendar: await readCalendar(tx) }
  })
}
export async function getSlots(database: Database, value: unknown) {
  const date = dateString(value), start = today()
  if (date < start || date > addDays(start, 14)) throw new DomainError(422, 'Preview tersedia hari ini sampai H+14.')
  return transaction(database, async (tx) => {
    await lockWorkshop(tx)
    const calendar = await readCalendar(tx), plan = await planCalendar(tx, calendar, start)
    if (plan.conflicts.length) throw new DomainError(409, 'Kalender memiliki konflik reservasi.', { conflicts: plan.conflicts })
    await persistSlots(tx, plan)
    return { date, timezone: TIMEZONE, version: calendar.version, slots: (await readSlots(tx, date, date)).filter(s => s.active).map(s => ({ ...s, remaining: s.quota - s.reserved })) }
  })
}
export async function changeSlotQuota(database: Database, id: string, value: unknown) {
  const v = object(value)
  const quota = v.quota === null ? null : integer(v.quota, 'Kuota slot', 0, 1000)
  const version = integer(v.version, 'Versi kalender', 1, 2147483647)
  return transaction(database, async (tx) => {
    await lockWorkshop(tx)
    const { rows: [slot] } = await tx.query('SELECT date::text, start_minute AS "startMinute",reserved,active FROM app.slots WHERE id=$1 FOR UPDATE', [id])
    if (!slot || !slot.active || slot.date < today()) throw new DomainError(404, 'Slot tidak tersedia.')
    const calendar = await readCalendar(tx)
    if (calendar.version !== version) throw new DomainError(409, 'Kalender atau kuota berubah. Muat ulang slot sebelum menyimpan.')
    const standard = generateSlots(calendar, slot.date).find(s => s.startMinute === slot.startMinute)?.quota
    const actual = quota ?? standard
    if (actual === undefined || actual < slot.reserved) {
      const bookings = (await tx.query("SELECT code,status FROM app.bookings WHERE slot_id=$1 AND reservation_status='active' ORDER BY code", [id])).rows
      throw new DomainError(409, 'Kuota di bawah reservasi aktif.', { conflicts: [{ slotId: id, reserved: slot.reserved, bookings }] })
    }
    await tx.query('UPDATE app.slots SET quota=$2,quota_override=$3 WHERE id=$1', [id, actual, quota])
    // Invalidate open calendar editors as well as concurrent quota forms.
    await tx.query('UPDATE app.workshop SET version=version+1 WHERE id=1')
    return { ok: true }
  })
}
export function validateService(value: unknown) {
  const v = object(value)
  if (typeof v.active !== 'boolean') throw new DomainError(422, 'Status layanan tidak valid.')
  return { name: text(v.name, 'Nama layanan', 100), price: integer(v.price, 'Tarif (Rp)', 0, 2147483647), durationMinutes: integer(v.durationMinutes, 'Estimasi menit', 1, 1440), active: v.active }
}
export async function saveService(database: Database, value: unknown, id?: string) {
  const s = validateService(value)
  if (!id) return (await database.pool.query('INSERT INTO app.services(name,price,duration_minutes,active) VALUES($1,$2,$3,$4) RETURNING id', [s.name, s.price, s.durationMinutes, s.active])).rows[0]
  const version = integer(object(value).version, 'Versi', 1, 2147483647)
  const result = await database.pool.query('UPDATE app.services SET name=$2,price=$3,duration_minutes=$4,active=$5,version=version+1,updated_at=now() WHERE id=$1 AND version=$6 RETURNING id', [id, s.name, s.price, s.durationMinutes, s.active, version])
  if (!result.rowCount) throw new DomainError(409, 'Layanan berubah atau tidak ditemukan. Muat ulang.')
  return result.rows[0]
}
