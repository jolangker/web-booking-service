import type { Database } from '@booking/db'
import type { Environment } from './env.js'
import { uuid } from './customer.js'
import { openTrackingToken } from './booking.js'
import { deliveryStateSql, gatewayFetch, gatewayMessageId, gatewayStatus } from './messaging.js'

export interface BookingMessage { bookingId: string, version: number, scheduledAt: string, notificationId: string }

export async function dispatchBooking(database: Database, env: Environment, job: BookingMessage, queueJobId: string) {
  uuid(job.bookingId); uuid(job.notificationId)
  const tx = await database.pool.connect()
  const lock = `booking:${job.bookingId}`
  try {
    // Mutations/reception acquire pg_advisory_xact_lock on this key; hold it through the gateway send.
    await tx.query('SELECT pg_advisory_lock(hashtext($1))', [lock])
    await tx.query('BEGIN')
    const { rows: [n] } = await tx.query(`SELECT n.*,b.status AS booking_status,b.reservation_status,b.version AS current_version,b.scheduled_at AS current_schedule,b.code,
      c.phone,t.ciphertext,t.expires_at,t.revoked_at,h.status AS event_status,h.action AS event_action,h.occurred_at AS event_time,h.scheduled_at AS event_schedule,h.estimate AS event_estimate
      FROM app.notifications n JOIN app.bookings b ON b.id=n.booking_id
      JOIN app.customers c ON c.id=b.customer_id JOIN app.tracking_tokens t ON t.booking_id=b.id
      LEFT JOIN app.booking_history h ON h.booking_id=b.id AND h.version=n.booking_version
      WHERE n.id=$1 AND b.id=$2 FOR UPDATE OF b,n`, [job.notificationId, job.bookingId])
    if (!n || n.queue_job_id !== queueJobId || !['queued', 'retrying', 'sending'].includes(n.status)) { await tx.query('COMMIT'); return }
    const { rows: attempts } = await tx.query('SELECT outcome FROM app.delivery_attempts WHERE notification_id=$1', [n.id])
    if (attempts.some(a => a.outcome === 'started')) {
      await tx.query("UPDATE app.delivery_attempts SET outcome='unknown',finished_at=now() WHERE notification_id=$1 AND outcome='started'", [n.id])
      await tx.query("UPDATE app.notifications SET status='unknown' WHERE id=$1", [n.id])
      await tx.query('COMMIT'); return
    }
    let now = new Date()
    const progress = ['received', 'in_progress', 'completed'].includes(n.kind)
    if (n.reservation_status !== 'active' || n.booking_status !== (progress ? n.kind : 'confirmed') || n.current_version !== job.version || n.booking_version !== job.version
      || (progress && (n.event_status !== n.kind || n.event_action !== n.kind || n.event_schedule?.toISOString() !== job.scheduledAt))
      || (n.kind === 'completed' && !n.event_estimate)
      || n.current_schedule.toISOString() !== job.scheduledAt || n.scheduled_at.toISOString() !== job.scheduledAt || (!progress && n.current_schedule <= now)) {
      await tx.query("UPDATE app.notifications SET status='stale' WHERE id=$1", [n.id])
      await tx.query('COMMIT'); return
    }
    if (attempts.length >= 5) {
      await tx.query("UPDATE app.notifications SET status='failed' WHERE id=$1", [n.id])
      await tx.query('COMMIT'); return
    }
    // Gateway preflight has no send side effect; a stopped gateway can be retried safely.
    const gateway = await gatewayStatus(env)
    now = new Date()
    if (!progress && n.current_schedule <= now) {
      await tx.query("UPDATE app.notifications SET status='stale' WHERE id=$1", [n.id])
      await tx.query('COMMIT'); return
    }
    if (gateway.status !== 'WORKING') {
      await tx.query("INSERT INTO app.delivery_attempts(notification_id,outcome,finished_at) VALUES($1,'unavailable',now())", [n.id])
      await tx.query("UPDATE app.notifications SET status=$2 WHERE id=$1", [n.id, attempts.length < 4 ? 'retrying' : 'failed'])
      await tx.query('COMMIT')
      if (attempts.length < 4) throw new Error('Booking gateway unavailable')
      return
    }
    // Priorities in pg-boss are per queue; explicitly yield the shared gateway to live, due OTP work.
    const { rows: [otp] } = await tx.query(`SELECT EXISTS(SELECT 1 FROM app.notifications n
      JOIN app.otp_challenges c ON c.id=n.challenge_id JOIN queue.job j ON j.id=n.queue_job_id
      WHERE n.kind='otp' AND n.status IN ('queued','retrying','sending') AND c.expires_at>clock_timestamp()+interval '10 seconds'
      AND c.consumed_at IS NULL AND c.invalidated_at IS NULL AND c.attempts<3 AND c.ciphertext IS NOT NULL
      AND j.state IN ('created','retry','active') AND j.start_after<=clock_timestamp()) AS pending`)
    if (otp.pending) throw new Error('Booking yields to OTP')
    await tx.query('INSERT INTO app.gateway_dispatch(id) VALUES(1) ON CONFLICT DO NOTHING')
    const { rows: [gate] } = await tx.query('SELECT next_at<=clock_timestamp() AS ready FROM app.gateway_dispatch WHERE id=1 FOR UPDATE')
    if (!gate.ready) throw new Error('Booking dispatch rate limited')
    now = new Date()
    if (!progress && n.current_schedule <= now) {
      await tx.query("UPDATE app.notifications SET status='stale' WHERE id=$1", [n.id])
      await tx.query('COMMIT'); return
    }
    await tx.query("UPDATE app.gateway_dispatch SET next_at=clock_timestamp()+interval '1 second' WHERE id=1")
    const { rows: [attempt] } = await tx.query("INSERT INTO app.delivery_attempts(notification_id,outcome) VALUES($1,'started') RETURNING id", [n.id])
    await tx.query("UPDATE app.notifications SET status='sending' WHERE id=$1", [n.id])
    await tx.query('COMMIT')
    const schedule = n.current_schedule.toLocaleString('id-ID', { timeZone: 'Asia/Jakarta', dateStyle: 'long', timeStyle: 'short' })
    const link = !n.revoked_at && n.expires_at > now ? ` Tracking: ${env.appOrigin}/tracking#${openTrackingToken(env, job.bookingId, n.ciphertext)}` : ''
    const eventTime = n.event_time?.toLocaleString('id-ID', { timeZone: 'Asia/Jakarta', dateStyle: 'long', timeStyle: 'short' })
    const message = progress
      ? `${n.kind === 'received' ? 'Kendaraan Diterima' : n.kind === 'in_progress' ? 'Sedang Dikerjakan' : 'Selesai Dikerjakan'} ${n.code}. Waktu: ${eventTime} WIB.${n.kind === 'completed' ? ` Estimasi tagihan ${new Intl.NumberFormat('id-ID', { style: 'currency', currency: 'IDR', maximumFractionDigits: 0 }).format(n.event_estimate.total)} (draft saat selesai). Pembayaran belum lunas; tagihan dapat berubah sebelum pembayaran.` : ''}${link}`
      : `${n.kind === 'reminder' ? 'Pengingat booking aktif' : 'Booking Terkonfirmasi'} ${n.code}. Jadwal kedatangan: ${schedule} WIB. Tunjukkan kode atau QR di bengkel.${link}`
    let outcome = 'unknown', status = 'unknown', httpStatus: number | null = null, messageId: string | null = null
    try {
      const response = await gatewayFetch(env, '/api/sendText', { session: 'default', chatId: `${n.phone.slice(1)}@c.us`,
        text: message })
      httpStatus = response.status
      if (response.ok) {
        messageId = gatewayMessageId(await response.json())
        if (messageId) { outcome = 'accepted'; status = 'accepted' }
      } else if (response.status === 429 || response.status >= 500) {
        outcome = 'retryable'; status = attempts.length < 4 ? 'retrying' : 'failed'
      } else { outcome = 'failed'; status = 'failed' }
    } catch { /* A timeout or broken response after send is ambiguous: do not resend automatically. */ }
    await tx.query('BEGIN')
    if (messageId) await tx.query('SELECT pg_advisory_xact_lock(hashtext($1))', [`ack:${messageId}`])
    await tx.query('UPDATE app.delivery_attempts SET outcome=$2,http_status=$3,message_id=$4,finished_at=now() WHERE id=$1', [attempt.id, outcome, httpStatus, messageId])
    await tx.query('UPDATE app.notifications SET status=$2 WHERE id=$1', [n.id, status])
    if (messageId) await tx.query(`UPDATE app.notifications n SET status=${deliveryStateSql} WHERE id=$1`, [n.id])
    await tx.query('COMMIT')
    if (status === 'retrying') throw new Error('Booking gateway retry')
  } catch {
    await tx.query('ROLLBACK')
    throw new Error('Booking dispatch incomplete')
  } finally {
    try { await tx.query('SELECT pg_advisory_unlock(hashtext($1))', [lock]); tx.release() }
    catch { tx.release(true) }
  }
}
