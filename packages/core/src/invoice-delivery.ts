import { randomUUID } from 'node:crypto'
import { drizzle, fromDrizzle, INVOICE_DELIVERY_QUEUE, sql } from '@booking/db'
import type { Database } from '@booking/db'
import type { Runtime } from './index.js'
import type { Environment } from './env.js'
import { uuid } from './customer.js'
import { invoiceFile } from './invoice.js'
import { deliveryStateSql, gatewayFetch, gatewayMessageId, gatewayStatus } from './messaging.js'
import { DomainError, object, transaction } from './workshop.js'

export { INVOICE_DELIVERY_QUEUE }
export async function invoiceDeliveries(database: Database, id: unknown) {
  const invoiceId = uuid(id)
  if (!(await database.pool.query('SELECT id FROM app.invoices WHERE id=$1', [invoiceId])).rowCount) throw new DomainError(404, 'Invoice tidak ditemukan.')
  return { deliveries: (await database.pool.query(`SELECT n.id,n.status,n.created_at AS "createdAt",'+62••••' || right(n.recipient_phone,4) AS recipient,
    COALESCE((SELECT json_agg(json_build_object('outcome',a.outcome,'httpStatus',a.http_status,'startedAt',a.started_at,'finishedAt',a.finished_at) ORDER BY a.started_at)
    FROM app.delivery_attempts a WHERE a.notification_id=n.id),'[]') AS attempts
    FROM app.notifications n WHERE n.invoice_id=$1 ORDER BY n.created_at DESC,n.id DESC LIMIT 20`, [invoiceId])).rows }
}

export async function sendInvoice(runtime: Runtime, env: Environment, admin: string, id: unknown, value: unknown) {
  const invoiceId = uuid(id), adminId = uuid(admin), requestKey = uuid(object(value).idempotencyKey)
  await runtime.startQueue()
  await transaction(runtime, async tx => {
    await tx.query('SELECT pg_advisory_xact_lock(hashtext($1))', [`invoice-delivery:${invoiceId}`])
    const { rows: [replay] } = await tx.query('SELECT invoice_id,requested_by FROM app.notifications WHERE request_key=$1', [requestKey])
    if (replay) {
      if (replay.invoice_id !== invoiceId || replay.requested_by !== adminId) throw new DomainError(409, 'Kunci pengiriman sudah digunakan untuk request berbeda.')
      return
    }
    const { rows: [target] } = await tx.query(`SELECT c.phone FROM app.service_archives a JOIN app.customers c ON c.id=a.customer_id WHERE a.invoice_id=$1 FOR SHARE OF c`, [invoiceId])
    if (!target) throw new DomainError(404, 'Invoice tidak ditemukan.')
    // Read and verify the actual private PDF before advertising it as ready to the recipient.
    await invoiceFile(runtime, env, invoiceId, tx)
    const { rows: [active] } = await tx.query(`SELECT id FROM app.notifications WHERE invoice_id=$1 AND status IN ('queued','retrying','sending')`, [invoiceId])
    if (active) throw new DomainError(409, 'Pengiriman invoice masih dalam antrean. Perbarui status pengiriman.')
    const { rows: [limit] } = await tx.query(`SELECT count(*)::int AS count,max(created_at)>now()-interval '60 seconds' AS cooldown
      FROM app.notifications WHERE invoice_id=$1 AND created_at>now()-interval '1 hour'`, [invoiceId])
    if (limit.cooldown || limit.count >= 3) throw new DomainError(429, 'Tunggu 60 detik antar pengiriman; maksimal 3 pengiriman invoice per jam.')
    const notificationId = randomUUID()
    const job = await runtime.boss.send(INVOICE_DELIVERY_QUEUE, { notificationId }, { db: fromDrizzle(drizzle(tx), sql) })
    if (!job) throw new Error('Invoice delivery enqueue failed')
    await tx.query(`INSERT INTO app.notifications(id,invoice_id,request_key,requested_by,recipient_phone,kind,queue_job_id)
      VALUES($1,$2,$3,$4,$5,'invoice',$6)`, [notificationId, invoiceId, requestKey, adminId, target.phone, job])
  }).catch((error: unknown) => {
    if ((error as { code?: string }).code === '23505') throw new DomainError(409, 'Kunci pengiriman sudah digunakan untuk request berbeda.')
    throw error
  })
  return invoiceDeliveries(runtime, invoiceId)
}

export async function dispatchInvoice(database: Database, env: Environment, notificationId: string, queueJobId: string) {
  uuid(notificationId)
  const tx = await database.pool.connect(), lock = `invoice-send:${notificationId}`
  try {
    await tx.query('SELECT pg_advisory_lock(hashtext($1))', [lock])
    await tx.query('BEGIN')
    const { rows: [n] } = await tx.query(`SELECT n.*,i.number,i.status AS pdf_status,c.phone FROM app.notifications n
      JOIN app.invoices i ON i.id=n.invoice_id JOIN app.service_archives a ON a.invoice_id=i.id
      JOIN app.customers c ON c.id=a.customer_id WHERE n.id=$1 FOR UPDATE OF n FOR SHARE OF c`, [notificationId])
    if (!n || n.queue_job_id !== queueJobId || !['queued', 'retrying', 'sending'].includes(n.status)) { await tx.query('COMMIT'); return }
    const { rows: attempts } = await tx.query('SELECT outcome FROM app.delivery_attempts WHERE notification_id=$1', [n.id])
    if (attempts.some(a => a.outcome === 'started')) {
      await tx.query("UPDATE app.delivery_attempts SET outcome='unknown',finished_at=now() WHERE notification_id=$1 AND outcome='started'", [n.id])
      await tx.query("UPDATE app.notifications SET status='unknown' WHERE id=$1", [n.id])
      await tx.query('COMMIT'); return
    }
    if (n.phone !== n.recipient_phone) {
      await tx.query("UPDATE app.notifications SET status='stale' WHERE id=$1", [n.id])
      await tx.query('COMMIT'); return
    }
    if (attempts.length >= 5) {
      await tx.query("UPDATE app.notifications SET status='failed' WHERE id=$1", [n.id])
      await tx.query('COMMIT'); return
    }
    let available = n.pdf_status === 'ready'
    if (available) { try { await invoiceFile(database, env, n.invoice_id, tx) } catch { available = false } }
    if (!available || (await gatewayStatus(env)).status !== 'WORKING') {
      await tx.query("INSERT INTO app.delivery_attempts(notification_id,outcome,finished_at) VALUES($1,'unavailable',now())", [n.id])
      await tx.query('UPDATE app.notifications SET status=$2 WHERE id=$1', [n.id, attempts.length < 4 ? 'retrying' : 'failed'])
      await tx.query('COMMIT')
      if (attempts.length < 4) throw new Error('Invoice delivery unavailable')
      return
    }
    const { rows: [otp] } = await tx.query(`SELECT EXISTS(SELECT 1 FROM app.notifications n
      JOIN app.otp_challenges c ON c.id=n.challenge_id JOIN queue.job j ON j.id=n.queue_job_id
      WHERE n.kind='otp' AND n.status IN ('queued','retrying','sending') AND c.expires_at>clock_timestamp()+interval '10 seconds'
      AND c.consumed_at IS NULL AND c.invalidated_at IS NULL AND c.attempts<3 AND c.ciphertext IS NOT NULL
      AND j.state IN ('created','retry','active') AND j.start_after<=clock_timestamp()) AS pending`)
    if (otp.pending) throw new Error('Invoice yields to OTP')
    await tx.query('INSERT INTO app.gateway_dispatch(id) VALUES(1) ON CONFLICT DO NOTHING')
    const { rows: [gate] } = await tx.query('SELECT next_at<=clock_timestamp() AS ready FROM app.gateway_dispatch WHERE id=1 FOR UPDATE')
    if (!gate.ready) throw new Error('Invoice dispatch rate limited')
    await tx.query("UPDATE app.gateway_dispatch SET next_at=clock_timestamp()+interval '1 second' WHERE id=1")
    const { rows: [attempt] } = await tx.query("INSERT INTO app.delivery_attempts(notification_id,outcome) VALUES($1,'started') RETURNING id", [n.id])
    await tx.query("UPDATE app.notifications SET status='sending' WHERE id=$1", [n.id])
    await tx.query('COMMIT')
    let outcome = 'unknown', status = 'unknown', httpStatus: number | null = null, messageId: string | null = null
    try {
      const response = await gatewayFetch(env, '/api/sendText', { session: 'default', chatId: `${n.recipient_phone.slice(1)}@c.us`,
        text: `Invoice ${n.number} LUNAS tersedia: ${env.appOrigin}/invoices/${n.invoice_id} . Masuk dengan OTP WhatsApp pemilik transaksi untuk melihat, mengunduh atau mencetak invoice.` })
      httpStatus = response.status
      if (response.ok) {
        messageId = gatewayMessageId(await response.json())
        if (messageId) { outcome = 'accepted'; status = 'accepted' }
      } else if (response.status === 429 || response.status >= 500) {
        outcome = 'retryable'; status = attempts.length < 4 ? 'retrying' : 'failed'
      } else { outcome = 'failed'; status = 'failed' }
    } catch { /* Ambiguous sends require a deliberate Admin resend; never auto-duplicate. */ }
    await tx.query('BEGIN')
    if (messageId) await tx.query('SELECT pg_advisory_xact_lock(hashtext($1))', [`ack:${messageId}`])
    await tx.query('UPDATE app.delivery_attempts SET outcome=$2,http_status=$3,message_id=$4,finished_at=now() WHERE id=$1', [attempt.id, outcome, httpStatus, messageId])
    await tx.query('UPDATE app.notifications SET status=$2 WHERE id=$1', [n.id, status])
    if (messageId) await tx.query(`UPDATE app.notifications n SET status=${deliveryStateSql} WHERE id=$1`, [n.id])
    await tx.query('COMMIT')
    if (status === 'retrying') throw new Error('Invoice gateway retry')
  } catch {
    await tx.query('ROLLBACK')
    throw new Error('Invoice dispatch incomplete')
  } finally {
    try { await tx.query('SELECT pg_advisory_unlock(hashtext($1))', [lock]); tx.release() }
    catch { tx.release(true) }
  }
}
