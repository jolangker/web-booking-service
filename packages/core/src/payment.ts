import { randomUUID } from 'node:crypto'
import type { PoolClient } from 'pg'
import { drizzle, fromDrizzle, INVOICE_QUEUE, sql } from '@booking/db'
import type { Database } from '@booking/db'
import type { Runtime } from './index.js'
import type { Environment } from './env.js'
import { tokenHash } from './admin.js'
import { uuid } from './customer.js'
import { draftInput, draftTotals } from './progress.js'
import { DomainError, integer, object, text, today, transaction } from './workshop.js'

export function paymentInput(value: unknown) {
  const v = object(value)
  if (['total', 'subtotal', 'change', 'status', 'paidAt', 'number'].some(key => key in v)) throw new DomainError(422, 'Total, kembalian, status dan nomor ditentukan server.')
  if (!['cash', 'qris', 'edc'].includes(v.method as string)) throw new DomainError(422, 'Metode harus tunai, QRIS statis atau EDC.')
  const lines = draftInput(v.lines)
  if (!lines.some(l => l.kind === 'service') || draftTotals(lines).total <= 0) throw new DomainError(422, 'Minimal satu jasa dan total tagihan positif wajib untuk pelunasan.')
  const method = v.method as 'cash' | 'qris' | 'edc'
  const reference = text(v.reference ?? '', 'Referensi transaksi', 100, method === 'cash' ? 0 : 1)
  if (method === 'cash' && reference) throw new DomainError(422, 'Pembayaran tunai tidak memakai referensi non-tunai.')
  const received = integer(v.received, 'Nominal diterima', 1, 2147483647), total = draftTotals(lines).total
  if (received < total) throw new DomainError(422, 'Nominal diterima kurang dari total tagihan.')
  if (method !== 'cash' && received !== total) throw new DomainError(422, 'Nominal QRIS/EDC harus tepat sebesar tagihan; tidak ada kembalian non-tunai.')
  return { version: integer(v.version, 'Versi WO', 1, 2147483646), idempotencyKey: uuid(v.idempotencyKey),
    reason: text(v.reason, 'Ringkasan finalisasi', 500), method, reference, received, lines }
}

async function readPayment(tx: PoolClient, bookingId: string) {
  const { rows: [payment] } = await tx.query(`SELECT p.id,p.method,p.reference,p.status,p.total,p.received,p.change,p.paid_by AS "paidBy",p.paid_at AS "paidAt",
    i.id AS "invoiceId",i.number,i.status AS "pdfStatus",i.attempts,i.last_error AS "lastError",i.ready_at AS "readyAt"
    FROM app.payments p JOIN app.invoices i ON i.payment_id=p.id WHERE p.booking_id=$1`, [bookingId])
  return payment ?? null
}
export async function getPayment(database: Database, id: unknown) {
  return transaction(database, tx => readPayment(tx, uuid(id)))
}
export async function listCashier(database: Database) {
  return { workOrders: (await database.pool.query(`SELECT b.id,b.code,b.status,COALESCE(i.snapshot->'vehicle',b.vehicle_snapshot) AS vehicle,COALESCE(i.snapshot->'customer'->>'name',c.name) AS "customerName",
    p.total,p.paid_at AS "paidAt",i.id AS "invoiceId",i.number,i.status AS "pdfStatus"
    FROM app.bookings b JOIN app.work_orders w ON w.booking_id=b.id JOIN app.customers c ON c.id=b.customer_id
    LEFT JOIN app.payments p ON p.booking_id=b.id LEFT JOIN app.invoices i ON i.payment_id=p.id
    WHERE b.status IN ('completed','collected') ORDER BY (b.status='completed') DESC,p.paid_at DESC NULLS LAST,w.received_at DESC LIMIT 100`)).rows }
}

export async function settlePayment(runtime: Runtime, env: Environment, admin: string, id: unknown, value: unknown) {
  const bookingId = uuid(id), adminId = uuid(admin), input = paymentInput(value)
  const hash = tokenHash(JSON.stringify({ bookingId, ...input }))
  await runtime.startQueue()
  return transaction(runtime, async tx => {
    await tx.query('SELECT pg_advisory_xact_lock(hashtext($1))', [`booking:${bookingId}`])
    const { rows: [b] } = await tx.query('SELECT * FROM app.bookings WHERE id=$1 FOR UPDATE', [bookingId])
    const { rows: [w] } = await tx.query('SELECT * FROM app.work_orders WHERE booking_id=$1 FOR UPDATE', [bookingId])
    if (!b || !w) throw new DomainError(404, 'WO tidak ditemukan.')
    const { rows: [retry] } = await tx.query('SELECT booking_id,request_hash FROM app.payments WHERE idempotency_key=$1', [input.idempotencyKey])
    if (retry && (retry.booking_id !== bookingId || retry.request_hash !== hash)) throw new DomainError(409, 'Kunci pembayaran sudah dipakai untuk data berbeda.')
    const existing = await readPayment(tx, bookingId)
    if (existing) return { payment: existing, replayed: true }
    if (b.status !== 'completed' || b.reservation_status !== 'active' || w.version !== input.version) throw new DomainError(409, 'WO harus selesai dan versinya harus terbaru. Muat ulang dan tinjau rincian.')
    if (!w.pit || !w.assignee || !w.diagnosis || !w.inspection || !w.notes) throw new DomainError(422, 'Lengkapi hasil pengerjaan sebelum pembayaran.')
    if (!env.workshopName || env.workshopName.length > 100 || !env.workshopAddress || env.workshopAddress.length > 500 || !env.workshopPhone || env.workshopPhone.length > 60) throw new DomainError(503, 'Identitas bengkel untuk invoice belum dikonfigurasi dengan benar.')
    const { rows: [customer] } = await tx.query('SELECT name,phone FROM app.customers WHERE id=$1 FOR SHARE', [b.customer_id])
    if (!customer?.name) throw new DomainError(422, 'Nama pelanggan wajib sebelum pembayaran.')
    const lines = []
    for (const line of input.lines) {
      if (line.kind === 'part') { lines.push(line); continue }
      const { rows: [service] } = await tx.query(`SELECT COALESCE(wl.description,bs.name,s.name) AS name FROM app.services s
        LEFT JOIN app.work_order_lines wl ON wl.work_order_id=$2 AND wl.service_id=s.id
        LEFT JOIN app.booking_services bs ON bs.booking_id=$3 AND bs.service_id=s.id
        WHERE s.id=$1 AND (s.active OR wl.service_id IS NOT NULL OR bs.service_id IS NOT NULL) FOR SHARE OF s`, [line.serviceId, w.id, bookingId])
      if (!service) throw new DomainError(422, 'Jasa tidak tersedia. Pilih layanan aktif atau rincian WO.')
      lines.push({ ...line, description: service.name })
    }
    const totals = draftTotals(lines), now = new Date(), date = today(now), paymentId = randomUUID(), invoiceId = randomUUID(), version = w.version + 1
    const { rows: [counter] } = await tx.query(`INSERT INTO app.invoice_counters(date,value) VALUES($1,1)
      ON CONFLICT(date) DO UPDATE SET value=app.invoice_counters.value+1 WHERE app.invoice_counters.value<999999 RETURNING value`, [date])
    if (!counter) throw new DomainError(409, 'Nomor invoice hari ini habis.')
    const number = `INV-${date.replaceAll('-', '')}-${String(counter.value).padStart(6, '0')}`
    const snapshot = { schemaVersion: 1, number, bookingCode: b.code, currency: 'IDR', status: 'LUNAS', paidAt: now.toISOString(),
      workshop: { name: env.workshopName, address: env.workshopAddress, phone: env.workshopPhone }, customer,
      vehicle: b.vehicle_snapshot, odometer: w.odometer, notes: w.notes, method: input.method, reference: input.reference,
      received: input.received, change: input.received - totals.total, ...totals }
    const beforeLines = (await tx.query('SELECT * FROM app.work_order_lines WHERE work_order_id=$1 ORDER BY position', [w.id])).rows
    await tx.query('DELETE FROM app.work_order_lines WHERE work_order_id=$1', [w.id])
    for (const [position, line] of lines.entries()) await tx.query(`INSERT INTO app.work_order_lines(work_order_id,position,kind,service_id,description,quantity,unit_price) VALUES($1,$2,$3,$4,$5,$6,$7)`, [w.id, position, line.kind, line.serviceId, line.description, line.quantity, line.unitPrice])
    await tx.query('UPDATE app.work_orders SET version=$2,updated_by=$3,updated_at=$4 WHERE id=$1', [w.id, version, adminId, now])
    await tx.query(`INSERT INTO app.work_order_changes(work_order_id,version,action,actor_id,reason,"before","after",idempotency_key,request_hash,occurred_at)
      VALUES($1,$2,'save',$3,$4,$5,$6,$7,$8,$9)`, [w.id, version, adminId, input.reason, { workOrder: w, lines: beforeLines, status: b.status }, { lines, ...totals, status: 'collected', paymentId }, input.idempotencyKey, hash, now])
    await tx.query(`INSERT INTO app.payments(id,booking_id,work_order_id,method,reference,total,received,change,paid_by,paid_at,idempotency_key,request_hash)
      VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`, [paymentId, bookingId, w.id, input.method, input.reference, totals.total, input.received, snapshot.change, adminId, now, input.idempotencyKey, hash])
    const job = await runtime.boss.send(INVOICE_QUEUE, { invoiceId }, { db: fromDrizzle(drizzle(tx), sql) })
    if (!job) throw new Error('Invoice enqueue failed')
    await tx.query('INSERT INTO app.invoices(id,payment_id,number,snapshot,queue_job_id) VALUES($1,$2,$3,$4,$5)', [invoiceId, paymentId, number, snapshot, job])
    for (const [position, line] of lines.entries()) await tx.query('INSERT INTO app.invoice_lines(invoice_id,position,kind,description,quantity,unit_price) VALUES($1,$2,$3,$4,$5,$6)', [invoiceId, position, line.kind, line.description, line.quantity, line.unitPrice])
    await tx.query("UPDATE app.bookings SET status='collected',version=version+1 WHERE id=$1", [bookingId])
    await tx.query(`INSERT INTO app.booking_history(booking_id,version,status,action,scheduled_at,actor_id,occurred_at)
      VALUES($1,$2,'collected','collected',$3,$4,$5)`, [bookingId, b.version + 1, b.scheduled_at, adminId, now])
    const history = (await tx.query('SELECT * FROM app.booking_history WHERE booking_id=$1 ORDER BY version', [bookingId])).rows
    await tx.query('INSERT INTO app.service_archives(id,booking_id,invoice_id,customer_id,vehicle_id,snapshot,archived_at) VALUES($1,$2,$3,$4,$5,$6,$7)',
      [randomUUID(), bookingId, invoiceId, b.customer_id, b.vehicle_id, { ...snapshot, lines, workOrder: { ...w, version, updated_by: adminId, updated_at: now }, complaint: b.complaint, scheduledAt: b.scheduled_at, history }, now])
    await tx.query("UPDATE app.notifications SET status='stale' WHERE booking_id=$1 AND status IN ('queued','retrying','sending')", [bookingId])
    return { payment: (await readPayment(tx, bookingId))!, replayed: false }
  }).catch((error: unknown) => {
    if ((error as { code?: string }).code === '23505') throw new DomainError(409, 'Kunci pembayaran sudah dipakai. Muat ulang transaksi sebelum mencoba lagi.')
    throw error
  })
}
