import { createHash, randomUUID } from 'node:crypto'
import { mkdir, open, readFile, readdir, rename, rm } from 'node:fs/promises'
import { join } from 'node:path'
import type { PoolClient } from 'pg'
import { drizzle, fromDrizzle, INVOICE_QUEUE, sql } from '@booking/db'
import type { Database } from '@booking/db'
import type { Runtime } from './index.js'
import type { Environment } from './env.js'
import { uuid } from './customer.js'
import { DomainError, transaction } from './workshop.js'

export { INVOICE_QUEUE }
export interface InvoiceSnapshot {
  schemaVersion: number, number: string, bookingCode: string, currency: string, status: string, paidAt: string,
  workshop: { name: string, address: string, phone: string }, customer: { name: string, phone: string },
  vehicle: { plate: string, brand: string, model: string, year: number }, odometer: number, notes: string,
  method: 'cash' | 'qris' | 'edc', reference: string, received: number, change: number,
  serviceSubtotal: number, partSubtotal: number, total: number,
  lines: { kind: string, description: string, quantity: number, unitPrice: number }[],
}
async function readInvoice(tx: PoolClient, id: string) {
  const { rows: [invoice] } = await tx.query<{ id: string, number: string, snapshot: Omit<InvoiceSnapshot, 'lines'>, status: string, queueJobId: string, attempts: number, lastError: string | null, fileHash: string | null, fileSize: number | null, readyAt: Date | null }>(`SELECT id,number,snapshot,status,queue_job_id AS "queueJobId",attempts,last_error AS "lastError",file_hash AS "fileHash",file_size AS "fileSize",ready_at AS "readyAt" FROM app.invoices WHERE id=$1`, [id])
  if (!invoice) throw new DomainError(404, 'Invoice tidak ditemukan.')
  const { rows: lines } = await tx.query<InvoiceSnapshot['lines'][number]>('SELECT kind,description,quantity,unit_price AS "unitPrice" FROM app.invoice_lines WHERE invoice_id=$1 ORDER BY position', [id])
  return { ...invoice, snapshot: { ...invoice.snapshot, lines } }
}
export async function getInvoice(database: Database, id: unknown) {
  const invoice = await transaction(database, tx => readInvoice(tx, uuid(id)))
  return { invoice: { id: invoice.id, number: invoice.number, snapshot: invoice.snapshot, status: invoice.status, attempts: invoice.attempts, lastError: invoice.lastError, readyAt: invoice.readyAt } }
}
function filePath(env: Environment, id: string) { return join(env.invoiceStoragePath, `${uuid(id)}.pdf`) }
function checksum(data: Uint8Array) { return createHash('sha256').update(data).digest('hex') }
async function verifiedFile(env: Environment, invoice: Awaited<ReturnType<typeof readInvoice>>) {
  const data = await readFile(filePath(env, invoice.id))
  if (data.length !== invoice.fileSize || checksum(data) !== invoice.fileHash) throw new Error('Invoice file integrity failed')
  return data
}
export async function invoiceFile(database: Database, env: Environment, id: unknown, tx?: PoolClient) {
  const invoice = tx ? await readInvoice(tx, uuid(id)) : await transaction(database, client => readInvoice(client, uuid(id)))
  if (invoice.status !== 'ready') throw new DomainError(409, 'Pembayaran LUNAS; PDF belum siap. Periksa status penerbitan.')
  try { return { number: invoice.number, data: await verifiedFile(env, invoice) } }
  catch { throw new DomainError(503, 'Arsip PDF tidak tersedia. Admin dapat menerbitkan ulang dari snapshot yang sama.') }
}
export async function retryInvoice(runtime: Runtime, env: Environment, id: unknown) {
  const invoiceId = uuid(id)
  await runtime.startQueue()
  await transaction(runtime, async tx => {
    // Same lock as the renderer: retry cannot supersede an active filesystem write.
    await tx.query('SELECT pg_advisory_xact_lock(hashtext($1))', [`invoice:${invoiceId}`])
    const invoice = await readInvoice(tx, invoiceId)
    if (invoice.status === 'ready') {
      let available = false
      try { await verifiedFile(env, invoice); available = true } catch { /* Missing/corrupt archive can be restored. */ }
      if (available) throw new DomainError(409, 'PDF sudah siap; gunakan lihat/unduh invoice.')
    } else if (invoice.status === 'pending') {
      const job = await runtime.boss.getJobById(INVOICE_QUEUE, invoice.queueJobId, { db: fromDrizzle(drizzle(tx), sql) })
      if (job && !['failed', 'cancelled', 'completed'].includes(job.state)) return
    }
    const job = await runtime.boss.send(INVOICE_QUEUE, { invoiceId }, { db: fromDrizzle(drizzle(tx), sql) })
    if (!job) throw new Error('Invoice retry enqueue failed')
    await tx.query("UPDATE app.invoices SET status='pending',queue_job_id=$2,last_error=NULL WHERE id=$1", [invoiceId, job])
  })
  return getInvoice(runtime, invoiceId)
}

export async function issueInvoice(database: Database, env: Environment, id: string, jobId: string, render: (snapshot: InvoiceSnapshot) => Promise<Uint8Array>) {
  const invoiceId = uuid(id), tx = await database.pool.connect(), lock = `invoice:${invoiceId}`
  let locked = false
  try {
    locked = (await tx.query('SELECT pg_try_advisory_lock(hashtext($1)) AS locked', [lock])).rows[0].locked
    if (!locked) throw new Error('Invoice renderer busy')
    const invoice = await readInvoice(tx, invoiceId)
    if (invoice.queueJobId !== jobId || invoice.status === 'ready') return
    await tx.query("UPDATE app.invoices SET status='pending',attempts=attempts+1,last_error=NULL WHERE id=$1", [invoiceId])
    try {
      const pdf = await render(invoice.snapshot)
      if (pdf.length < 5 || Buffer.from(pdf.subarray(0, 5)).toString() !== '%PDF-') throw new Error('Invalid PDF')
      await mkdir(env.invoiceStoragePath, { recursive: true, mode: 0o700 })
      const target = filePath(env, invoiceId), temporary = `${target}.${randomUUID()}.tmp`
      // A killed process may leave an incomplete temporary file. Only this invoice's locked writer cleans it.
      for (const name of await readdir(env.invoiceStoragePath)) {
        if (name.startsWith(`${invoiceId}.pdf.`) && /^[0-9a-f-]{36}\.tmp$/.test(name.slice(invoiceId.length + 5))) await rm(join(env.invoiceStoragePath, name), { force: true })
      }
      try {
        const file = await open(temporary, 'wx', 0o600)
        try { await file.writeFile(pdf); await file.sync() } finally { await file.close() }
        await rename(temporary, target)
      } finally { await rm(temporary, { force: true }) }
      await tx.query("UPDATE app.invoices SET status='ready',file_hash=$2,file_size=$3,ready_at=now(),last_error=NULL WHERE id=$1", [invoiceId, checksum(pdf), pdf.length])
    } catch {
      await tx.query("UPDATE app.invoices SET status='failed',last_error='PDF_GENERATION_FAILED' WHERE id=$1", [invoiceId])
      throw new Error('Invoice generation failed')
    }
  } finally {
    try { if (locked) await tx.query('SELECT pg_advisory_unlock(hashtext($1))', [lock]); tx.release() }
    catch { tx.release(true) }
  }
}

const escape = (value: unknown) => String(value).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!)
const money = (value: number) => `Rp${new Intl.NumberFormat('id-ID').format(value)}`
export function invoiceHtml(s: InvoiceSnapshot) {
  const method = { cash: 'Tunai', qris: 'QRIS statis', edc: 'Kartu via EDC' }[s.method]
  const time = new Date(s.paidAt).toLocaleString('id-ID', { timeZone: 'Asia/Jakarta', dateStyle: 'long', timeStyle: 'short' })
  return `<!doctype html><html lang="id"><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'"><title>${escape(s.number)}</title>
  <style>@page{size:A4}*{box-sizing:border-box}body{font:11px/1.5 Arial,"Liberation Sans",sans-serif;color:#17202a;margin:0}h1{font-size:24px;margin:0}h2{font-size:15px;margin:0 0 5px}p{margin:3px 0;overflow-wrap:anywhere;white-space:pre-wrap}.top{border-bottom:2px solid #17202a;padding-bottom:14px}.badge{display:inline-block;border:2px solid #176343;color:#176343;font-size:17px;font-weight:bold;padding:3px 12px;margin:10px 0}.meta{display:table;width:100%;margin:16px 0}.meta>div{display:table-cell;width:50%;padding-right:16px;vertical-align:top}table{width:100%;border-collapse:collapse;table-layout:fixed;margin-top:16px}thead{display:table-header-group}th,td{text-align:left;padding:8px 6px;border-bottom:1px solid #d8dde3;vertical-align:top;overflow-wrap:anywhere}th{background:#eef1f4}tr{break-inside:avoid}.num{text-align:right;white-space:nowrap}.summary{width:65%;margin:16px 0 16px auto;break-inside:avoid}.summary p{display:flex;justify-content:space-between;gap:15px}.total{font-size:15px;font-weight:bold;border-top:2px solid;padding-top:6px}.notes{margin-top:20px;white-space:pre-wrap}.muted{color:#52606d}</style></head><body>
  <div class="top"><h1>${escape(s.workshop.name)}</h1><p>${escape(s.workshop.address)}</p><p>Tel. ${escape(s.workshop.phone)}</p></div>
  <div class="meta"><div><h2>INVOICE ${escape(s.number)}</h2><p>${escape(time)} WIB</p><p>Booking / WO: ${escape(s.bookingCode)}</p><span class="badge">LUNAS</span></div><div><h2>Pelanggan</h2><p>${escape(s.customer.name)}</p><p>${escape(s.customer.phone)}</p><p>${escape(s.vehicle.plate)} | ${escape(s.vehicle.brand)} ${escape(s.vehicle.model)} (${escape(s.vehicle.year)})</p><p>Odometer: ${escape(s.odometer)} km</p></div></div>
  <table><colgroup><col style="width:7%"><col style="width:43%"><col style="width:9%"><col style="width:20%"><col style="width:21%"></colgroup><thead><tr><th>No.</th><th>Rincian jasa / part aktual</th><th class="num">Jml</th><th class="num">Harga satuan</th><th class="num">Subtotal</th></tr></thead><tbody>${s.lines.map((l, i) => `<tr><td>${i + 1}</td><td><strong>${l.kind === 'service' ? 'Jasa' : 'Part'}</strong><br>${escape(l.description)}</td><td class="num">${l.quantity}</td><td class="num">${money(l.unitPrice)}</td><td class="num">${money(l.quantity * l.unitPrice)}</td></tr>`).join('')}</tbody></table>
  <div class="summary"><p><span>Subtotal jasa</span><span>${money(s.serviceSubtotal)}</span></p><p><span>Subtotal part</span><span>${money(s.partSubtotal)}</span></p><p class="total"><span>Total LUNAS</span><span>${money(s.total)}</span></p><p><span>${escape(method)} diterima</span><span>${money(s.received)}</span></p><p><span>Kembalian</span><span>${money(s.change)}</span></p>${s.reference ? `<p>Referensi: ${escape(s.reference)}</p>` : ''}</div>
  <div class="notes"><h2>Catatan pekerjaan</h2><p>${escape(s.notes)}</p></div><p class="muted">Pembayaran telah divalidasi Admin. Dokumen ini adalah arsip transaksi servis.</p></body></html>`
}
