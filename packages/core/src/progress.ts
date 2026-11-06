import { randomBytes, randomUUID } from 'node:crypto'
import type { PoolClient } from 'pg'
import { drizzle, fromDrizzle, sql } from '@booking/db'
import type { Database } from '@booking/db'
import type { Runtime } from './index.js'
import type { Environment } from './env.js'
import { tokenHash } from './admin.js'
import { uuid } from './customer.js'
import { BOOKING_QUEUE, openTrackingToken, sealTrackingToken } from './booking.js'
import { receptionInput } from './reception.js'
import { DomainError, integer, object, text, transaction } from './workshop.js'

export interface DraftLine { kind: 'service' | 'part', serviceId: string | null, description: string, quantity: number, unitPrice: number }
export function draftInput(value: unknown): DraftLine[] {
  if (!Array.isArray(value) || value.length > 100) throw new DomainError(422, 'Rincian maksimal 100 baris.')
  const lines = value.map((item): DraftLine => {
    const v = object(item)
    if (v.kind !== 'service' && v.kind !== 'part') throw new DomainError(422, 'Jenis rincian harus jasa atau part.')
    if ('subtotal' in v || 'total' in v) throw new DomainError(422, 'Subtotal dan total dihitung server.')
    if (v.kind === 'part' && v.serviceId != null) throw new DomainError(422, 'Part manual tidak memakai layanan.')
    return { kind: v.kind, serviceId: v.kind === 'service' ? uuid(v.serviceId) : null,
      description: v.kind === 'part' ? text(v.description, 'Deskripsi part', 200) : '',
      quantity: integer(v.quantity, 'Jumlah', 1, 999), unitPrice: integer(v.unitPrice, 'Harga rupiah', 0, 2147483647) }
  })
  const services = lines.filter(l => l.kind === 'service').map(l => l.serviceId)
  if (new Set(services).size !== services.length) throw new DomainError(422, 'Jasa tidak boleh duplikat; gunakan jumlah.')
  draftTotals(lines)
  return lines
}
export function draftTotals(lines: DraftLine[]) {
  const subtotal = (kind: string) => lines.filter(l => l.kind === kind).reduce((sum, l) => sum + l.quantity * l.unitPrice, 0)
  const serviceSubtotal = subtotal('service'), partSubtotal = subtotal('part'), total = serviceSubtotal + partSubtotal
  if (!Number.isSafeInteger(total) || total > 2147483647) throw new DomainError(422, 'Total draft melebihi batas Rp2.147.483.647.')
  return { serviceSubtotal, partSubtotal, total }
}
export function progressInput(value: unknown) {
  const v = object(value)
  if (!['save', 'start', 'complete', 'rotate_tracking', 'revoke_tracking'].includes(v.action as string)) throw new DomainError(422, 'Aksi WO tidak valid. Status final hanya melalui pembayaran.')
  if ('total' in v || 'subtotal' in v || 'estimatedTotal' in v || 'status' in v) throw new DomainError(422, 'Status dan total ditentukan server.')
  const base = { action: v.action as 'save' | 'start' | 'complete' | 'rotate_tracking' | 'revoke_tracking',
    version: integer(v.version, 'Versi WO', 1, 2147483646), expectedStatus: text(v.expectedStatus, 'Status saat dibuka', 30),
    idempotencyKey: uuid(v.idempotencyKey), reason: text(v.reason, 'Alasan / ringkasan perubahan', 500) }
  if (base.action.endsWith('_tracking')) return { ...base, fields: undefined, lines: undefined }
  const fields = { ...receptionInput(v), diagnosis: text(v.diagnosis, 'Diagnosa', 2000, 0), inspection: text(v.inspection, 'Inspeksi', 2000, 0), notes: text(v.notes, 'Catatan pekerjaan', 4000, 0) }
  const lines = draftInput(v.lines)
  if (base.action === 'start' || base.action === 'complete' || base.expectedStatus !== 'received') {
    if (!fields.pit || !fields.assignee || !fields.diagnosis || !fields.inspection) throw new DomainError(422, 'Pit, pelaksana, diagnosa dan inspeksi wajib untuk pengerjaan.')
  }
  if (base.action === 'complete' || base.expectedStatus === 'completed') {
    if (!fields.notes || !lines.some(l => l.kind === 'service')) throw new DomainError(422, 'Isi hasil pekerjaan dan minimal satu jasa sebelum selesai.')
  }
  return { ...base, fields, lines }
}

async function readDraft(tx: PoolClient, workOrderId: string) {
  const { rows } = await tx.query<DraftLine>(`SELECT kind,service_id AS "serviceId",description,quantity,unit_price AS "unitPrice"
    FROM app.work_order_lines WHERE work_order_id=$1 ORDER BY position`, [workOrderId])
  return { lines: rows, ...draftTotals(rows) }
}
async function readProgress(tx: PoolClient, env: Environment, bookingId: string) {
  const { rows: [workOrder] } = await tx.query(`SELECT w.id,w.booking_id AS "bookingId",w.version,w.odometer,w.initial_condition AS "initialCondition",w.pit,w.assignee,
    w.diagnosis,w.inspection,w.notes,w.origin,w.received_by AS "receivedBy",w.received_at AS "receivedAt",w.updated_by AS "updatedBy",w.updated_at AS "updatedAt",
    b.code,b.status,b.complaint,b.vehicle_snapshot AS vehicle,c.name AS "customerName",c.phone
    FROM app.work_orders w JOIN app.bookings b ON b.id=w.booking_id JOIN app.customers c ON c.id=b.customer_id WHERE b.id=$1`, [bookingId])
  if (!workOrder) throw new DomainError(404, 'WO tidak ditemukan.')
  const draft = await readDraft(tx, workOrder.id)
  const { rows: history } = await tx.query(`SELECT version,status,action,actor_id AS "actorId",occurred_at AS "occurredAt",estimate
    FROM app.booking_history WHERE booking_id=$1 ORDER BY version`, [bookingId])
  const { rows: changes } = await tx.query(`SELECT version,action,actor_id AS "actorId",reason,"before","after",occurred_at AS "occurredAt"
    FROM app.work_order_changes WHERE work_order_id=$1 ORDER BY version DESC`, [workOrder.id])
  const { rows: [token] } = await tx.query('SELECT ciphertext,expires_at AS "expiresAt",revoked_at AS "revokedAt",expires_at>now() AND revoked_at IS NULL AS valid FROM app.tracking_tokens WHERE booking_id=$1', [bookingId])
  return { workOrder, draft, history, changes, tracking: { expiresAt: token?.expiresAt, revokedAt: token?.revokedAt,
    url: token?.valid ? `${env.appOrigin}/tracking#${openTrackingToken(env, bookingId, token.ciphertext)}` : null } }
}
export async function getWorkOrder(database: Database, env: Environment, id: unknown) {
  const bookingId = uuid(id)
  return transaction(database, async tx => {
    await tx.query('SELECT pg_advisory_xact_lock_shared(hashtext($1))', [`booking:${bookingId}`])
    return readProgress(tx, env, bookingId)
  })
}
export async function listWorkOrders(database: Database) {
  return { workOrders: (await database.pool.query(`SELECT b.id,b.code,b.status,b.vehicle_snapshot AS vehicle,w.pit,w.assignee,w.version,w.received_at AS "receivedAt"
    FROM app.work_orders w JOIN app.bookings b ON b.id=w.booking_id WHERE b.status IN ('received','in_progress','completed')
    ORDER BY w.received_at,b.code`)).rows }
}

// Shared by WO and the forthcoming cashier: one guarded transaction replaces the draft and audits the change.
export async function updateWorkOrder(runtime: Runtime, env: Environment, admin: string, id: unknown, value: unknown) {
  const bookingId = uuid(id), adminId = uuid(admin), input = progressInput(value)
  const hash = tokenHash(JSON.stringify({ bookingId, ...input }))
  await runtime.startQueue()
  return transaction(runtime, async tx => {
    await tx.query('SELECT pg_advisory_xact_lock(hashtext($1))', [`booking:${bookingId}`])
    const { rows: [b] } = await tx.query('SELECT * FROM app.bookings WHERE id=$1 FOR UPDATE', [bookingId])
    const { rows: [w] } = await tx.query('SELECT * FROM app.work_orders WHERE booking_id=$1 FOR UPDATE', [bookingId])
    if (!b || !w) throw new DomainError(404, 'WO tidak ditemukan.')
    const { rows: [retry] } = await tx.query('SELECT request_hash FROM app.work_order_changes WHERE idempotency_key=$1', [input.idempotencyKey])
    if (retry) {
      if (retry.request_hash !== hash) throw new DomainError(409, 'Kunci perubahan sudah dipakai untuk data berbeda.')
      return { ...await readProgress(tx, env, bookingId), replayed: true }
    }
    if (w.version !== input.version || b.status !== input.expectedStatus) throw new DomainError(409, 'WO telah berubah. Muat ulang dan tinjau data terbaru.')
    if (b.reservation_status !== 'active' || (!['received', 'in_progress', 'completed'].includes(b.status) && input.action !== 'revoke_tracking')) throw new DomainError(409, 'WO tidak dapat diubah setelah pembayaran atau pembatalan.')
    if ((input.action === 'start' && b.status !== 'received') || (input.action === 'complete' && b.status !== 'in_progress')) throw new DomainError(409, 'Urutan wajib: diterima → sedang dikerjakan → selesai dikerjakan.')
    const previous = await readDraft(tx, w.id), version = w.version + 1, now = new Date()
    if (input.fields && input.lines) {
      const lines: DraftLine[] = []
      for (const line of input.lines) {
        if (line.kind === 'part') { lines.push(line); continue }
        const { rows: [service] } = await tx.query(`SELECT COALESCE(bs.name,s.name) AS name FROM app.services s
          LEFT JOIN app.booking_services bs ON bs.service_id=s.id AND bs.booking_id=$2
          WHERE s.id=$1 AND (s.active OR bs.service_id IS NOT NULL) FOR SHARE OF s`, [line.serviceId, bookingId])
        if (!service) throw new DomainError(422, 'Jasa tidak tersedia. Pilih layanan aktif atau snapshot booking.')
        lines.push({ ...line, description: service.name })
      }
      await tx.query('DELETE FROM app.work_order_lines WHERE work_order_id=$1', [w.id])
      for (const [position, line] of lines.entries()) await tx.query(`INSERT INTO app.work_order_lines(work_order_id,position,kind,service_id,description,quantity,unit_price)
        VALUES($1,$2,$3,$4,$5,$6,$7)`, [w.id, position, line.kind, line.serviceId, line.description, line.quantity, line.unitPrice])
      const f = input.fields
      await tx.query(`UPDATE app.work_orders SET odometer=$2,initial_condition=$3,pit=$4,assignee=$5,diagnosis=$6,inspection=$7,notes=$8 WHERE id=$1`,
        [w.id, f.odometer, f.initialCondition, f.pit, f.assignee, f.diagnosis, f.inspection, f.notes])
    }
    await tx.query('UPDATE app.work_orders SET version=$2,updated_by=$3,updated_at=$4 WHERE id=$1', [w.id, version, adminId, now])
    if (input.action === 'rotate_tracking') {
      const token = randomBytes(32).toString('base64url')
      await tx.query(`UPDATE app.tracking_tokens SET token_hash=$2,ciphertext=$3,expires_at=$4::timestamptz+interval '30 days',revoked_at=NULL WHERE booking_id=$1`,
        [bookingId, tokenHash(token), sealTrackingToken(env, bookingId, token), now])
    } else if (input.action === 'revoke_tracking') {
      await tx.query('UPDATE app.tracking_tokens SET revoked_at=$2 WHERE booking_id=$1', [bookingId, now])
    }
    const draft = await readDraft(tx, w.id)
    if (input.action === 'start' || input.action === 'complete') {
      const status = input.action === 'start' ? 'in_progress' : 'completed', bookingVersion = b.version + 1
      const estimate = status === 'completed' ? { currency: 'IDR', workOrderVersion: version, ...draft } : null
      await tx.query('UPDATE app.bookings SET status=$2,version=$3 WHERE id=$1', [bookingId, status, bookingVersion])
      await tx.query(`INSERT INTO app.booking_history(booking_id,version,status,action,scheduled_at,actor_id,estimate,occurred_at)
        VALUES($1,$2,$3,$3,$4,$5,$6,$7)`, [bookingId, bookingVersion, status, b.scheduled_at, adminId, estimate, now])
      await tx.query("UPDATE app.notifications SET status='stale' WHERE booking_id=$1 AND status IN ('queued','retrying','sending')", [bookingId])
      const notificationId = randomUUID()
      const job = await runtime.boss.send(BOOKING_QUEUE, { bookingId, version: bookingVersion, scheduledAt: b.scheduled_at.toISOString(), notificationId }, { db: fromDrizzle(drizzle(tx), sql), priority: 0 })
      if (!job) throw new Error('Progress enqueue failed')
      await tx.query(`INSERT INTO app.notifications(id,booking_id,booking_version,scheduled_at,kind,queue_job_id) VALUES($1,$2,$3,$4,$5,$6)`, [notificationId, bookingId, bookingVersion, b.scheduled_at, status, job])
    }
    const after = (await tx.query('SELECT * FROM app.work_orders WHERE id=$1', [w.id])).rows[0]
    await tx.query(`INSERT INTO app.work_order_changes(work_order_id,version,action,actor_id,reason,"before","after",idempotency_key,request_hash,occurred_at)
      VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`, [w.id, version, input.action, adminId, input.reason, { workOrder: w, draft: previous, status: b.status },
      { workOrder: after, draft, status: input.action === 'start' ? 'in_progress' : input.action === 'complete' ? 'completed' : b.status }, input.idempotencyKey, hash, now])
    return { ...await readProgress(tx, env, bookingId), replayed: false }
  })
}
