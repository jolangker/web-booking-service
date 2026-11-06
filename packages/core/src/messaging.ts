import { createHmac, timingSafeEqual } from 'node:crypto'
import type { Database } from '@booking/db'
import type { Environment } from './env.js'
import { decryptOtp, uuid } from './customer.js'
import { DomainError, object, text, transaction } from './workshop.js'

export async function gatewayFetch(env: Environment, path: string, body?: unknown) {
  return fetch(new URL(path, env.wahaBaseUrl), {
    method: body ? 'POST' : 'GET', redirect: 'error', signal: AbortSignal.timeout(8000),
    headers: { 'X-Api-Key': env.wahaApiKey, 'Content-Type': 'application/json' },
    ...(body ? { body: JSON.stringify(body) } : {}),
  })
}
function serializedMessageKey(value: unknown): string | null {
  if (typeof value !== 'string') return null
  return /^true_\d+@(s\.whatsapp\.net|c\.us|lid)_([a-zA-Z0-9-]{1,150})$/.exec(value)?.[2] ?? null
}
export function gatewayMessageId(value: unknown): string | null {
  const data = object(value)
  if (typeof data.id === 'string') return serializedMessageKey(data.id)
  // NOWEB sendText can use a phone JID while ACK uses @lid. The stable key is identical.
  if (!data.key || typeof data.key !== 'object' || Array.isArray(data.key)) return null
  const key = data.key as Record<string, unknown>
  if (key.fromMe !== true || typeof key.id !== 'string' || !/^[a-zA-Z0-9-]{1,150}$/.test(key.id)
    || typeof key.remoteJid !== 'string' || !/^\d+@(s\.whatsapp\.net|c\.us|lid)$/.test(key.remoteJid)) return null
  return key.id
}
export async function gatewayStatus(env: Environment) {
  try {
    const response = await gatewayFetch(env, '/api/sessions/default')
    if (!response.ok) return { status: 'UNAVAILABLE', checkedAt: new Date().toISOString() }
    const data = object(await response.json())
    const status = typeof data.status === 'string' && ['WORKING', 'STOPPED', 'STARTING', 'SCAN_QR_CODE', 'FAILED', 'PASSKEY_REQUIRED', 'PASSKEY_CONFIRMATION_REQUIRED'].includes(data.status) ? data.status : 'UNAVAILABLE'
    return { status, checkedAt: new Date().toISOString() }
  } catch { return { status: 'UNAVAILABLE', checkedAt: new Date().toISOString() } }
}

export async function startGatewayPairing(env: Environment) {
  try {
    const existing = await gatewayFetch(env, '/api/sessions/default')
    let path: string | undefined, body: object = {}
    if (existing.status === 404) { path = '/api/sessions'; body = { name: 'default', start: true } }
    else {
      if (!existing.ok) throw new Error('Gateway unavailable')
      const session = object(await existing.json())
      if (session.status === 'STOPPED') path = '/api/sessions/default/start'
      if (session.status === 'FAILED') path = '/api/sessions/default/restart'
      // Reading a QR must never restart an active or already connected session.
    }
    if (path && !(await gatewayFetch(env, path, body)).ok) throw new Error('Pairing unavailable')
    return gatewayStatus(env)
  } catch { throw new DomainError(503, 'WhatsApp belum dapat dihubungkan. Periksa gateway lalu coba lagi.') }
}

export async function gatewayPairingQr(env: Environment) {
  try {
    const response = await fetch(new URL('/api/default/auth/qr?format=image', env.wahaBaseUrl), {
      headers: { 'X-Api-Key': env.wahaApiKey, Accept: 'image/png' },
      redirect: 'error', signal: AbortSignal.timeout(8000),
    })
    if ([404, 409, 422].includes(response.status)) throw new DomainError(409, 'QR belum tersedia atau sudah berubah. Perbarui status WhatsApp.')
    if (!response.ok || !response.headers.get('content-type')?.toLowerCase().startsWith('image/png')) throw new Error('QR unavailable')
    const data = Buffer.from(await response.arrayBuffer())
    if (data.length > 1048576 || !data.subarray(0, 8).equals(Buffer.from('89504e470d0a1a0a', 'hex'))) throw new Error('Invalid QR image')
    return data
  } catch (error) {
    if (error instanceof DomainError) throw error
    throw new DomainError(503, 'QR WhatsApp belum dapat dibaca. Coba lagi sebentar.')
  }
}

// Called periodically by the worker even when the queue is empty or the gateway is down.
export async function expireOtpPayloads(database: Database) {
  await transaction(database, async (tx) => {
    await tx.query('UPDATE app.otp_challenges SET ciphertext=NULL,verifier=NULL WHERE (expires_at<=now() OR consumed_at IS NOT NULL OR invalidated_at IS NOT NULL OR attempts>=3) AND (ciphertext IS NOT NULL OR verifier IS NOT NULL)')
    await tx.query(`UPDATE app.notifications n SET status='stale' FROM app.otp_challenges c
      WHERE n.challenge_id=c.id AND (c.expires_at<=now() OR c.invalidated_at IS NOT NULL OR c.consumed_at IS NOT NULL OR c.attempts>=3) AND n.status IN ('queued','retrying')`)
    await tx.query("DELETE FROM app.customer_sessions WHERE expires_at<=now() OR last_seen_at<=now()-interval '24 hours'")
    await tx.query('DELETE FROM app.login_throttles WHERE resets_at<=now()')
    await tx.query("DELETE FROM app.delivery_events WHERE received_at<now()-interval '7 days'")
    await tx.query("UPDATE app.delivery_attempts SET outcome='unknown',finished_at=now() WHERE outcome='started' AND started_at<now()-interval '30 seconds'")
    await tx.query("UPDATE app.notifications n SET status='unknown' WHERE status='sending' AND EXISTS (SELECT 1 FROM app.delivery_attempts a WHERE a.notification_id=n.id AND a.outcome='unknown')")
    await tx.query("UPDATE app.notifications n SET status='failed' FROM queue.job j WHERE n.queue_job_id=j.id AND j.state='failed' AND n.status IN ('queued','retrying')")
  })
}

export const deliveryStateSql = `CASE WHEN EXISTS(SELECT 1 FROM app.delivery_events e JOIN app.delivery_attempts a ON a.message_id=e.message_id WHERE a.notification_id=n.id AND e.ack>=3) THEN 'read'
  WHEN EXISTS(SELECT 1 FROM app.delivery_events e JOIN app.delivery_attempts a ON a.message_id=e.message_id WHERE a.notification_id=n.id AND e.ack=2) THEN 'delivered'
  WHEN EXISTS(SELECT 1 FROM app.delivery_events e JOIN app.delivery_attempts a ON a.message_id=e.message_id WHERE a.notification_id=n.id AND e.ack=1) THEN 'sent'
  WHEN EXISTS(SELECT 1 FROM app.delivery_events e JOIN app.delivery_attempts a ON a.message_id=e.message_id WHERE a.notification_id=n.id AND e.ack=-1) THEN 'failed' ELSE n.status END`

export async function dispatchOtp(database: Database, env: Environment, challengeId: string, queueJobId: string) {
  uuid(challengeId)
  const tx = await database.pool.connect()
  let phone: string | undefined
  try {
    const { rows: [hint] } = await tx.query('SELECT phone FROM app.otp_challenges WHERE id=$1', [challengeId])
    if (!hint) return
    phone = hint.phone
    // Session lock survives the committed attempt, but is automatically released on worker crash.
    await tx.query('SELECT pg_advisory_lock(hashtext($1))', [`otp:${phone}`])
    await tx.query('BEGIN')
    const { rows: [c] } = await tx.query(`SELECT c.*,n.id AS notification_id,n.status,n.queue_job_id,c.expires_at>now()+interval '10 seconds' AS active
      FROM app.otp_challenges c JOIN app.notifications n ON n.challenge_id=c.id WHERE c.id=$1 FOR UPDATE OF c,n`, [challengeId])
    if (!c || c.queue_job_id !== queueJobId) { await tx.query('COMMIT'); return }
    if (!['queued', 'retrying', 'sending'].includes(c.status)) { await tx.query('COMMIT'); return }
    const { rows: attempts } = await tx.query('SELECT id,outcome FROM app.delivery_attempts WHERE notification_id=$1', [c.notification_id])
    if (attempts.some(a => a.outcome === 'started')) {
      await tx.query("UPDATE app.delivery_attempts SET outcome='unknown',finished_at=now() WHERE notification_id=$1 AND outcome='started'", [c.notification_id])
      await tx.query("UPDATE app.notifications SET status='unknown' WHERE id=$1", [c.notification_id])
      await tx.query('UPDATE app.otp_challenges SET ciphertext=NULL WHERE id=$1', [challengeId])
      await tx.query('COMMIT'); return
    }
    if (!c.active || c.consumed_at || c.invalidated_at || c.attempts >= 3 || !c.ciphertext) {
      await tx.query("UPDATE app.notifications SET status='stale' WHERE id=$1", [c.notification_id])
      await tx.query('UPDATE app.otp_challenges SET ciphertext=NULL,verifier=NULL WHERE id=$1', [challengeId])
      await tx.query('COMMIT'); return
    }
    if (attempts.length >= 3) {
      await tx.query("UPDATE app.notifications SET status='failed' WHERE id=$1", [c.notification_id])
      await tx.query('UPDATE app.otp_challenges SET ciphertext=NULL WHERE id=$1', [challengeId])
      await tx.query('COMMIT'); return
    }
    await tx.query('INSERT INTO app.gateway_dispatch(id) VALUES(1) ON CONFLICT DO NOTHING')
    const { rows: [gate] } = await tx.query('SELECT next_at<=clock_timestamp() AS ready FROM app.gateway_dispatch WHERE id=1 FOR UPDATE')
    if (!gate.ready) throw new Error('OTP dispatch rate limited')
    await tx.query("UPDATE app.gateway_dispatch SET next_at=clock_timestamp()+interval '1 second' WHERE id=1")
    const code = decryptOtp(env.otpSecret, c.id, c.ciphertext)
    const { rows: [attempt] } = await tx.query("INSERT INTO app.delivery_attempts(notification_id,outcome) VALUES($1,'started') RETURNING id", [c.notification_id])
    await tx.query("UPDATE app.notifications SET status='sending' WHERE id=$1", [c.notification_id])
    await tx.query('COMMIT')
    // Never log gateway responses/errors: both may contain OTP, phone or API keys.
    let outcome = 'unknown', status = 'unknown', httpStatus: number | null = null, messageId: string | null = null
    try {
      const response = await gatewayFetch(env, '/api/sendText', {
        session: 'default', chatId: `${c.phone.slice(1)}@c.us`,
        text: `Kode OTP Booking Bengkel: ${code}. Berlaku sampai ${new Date(c.expires_at).toLocaleTimeString('id-ID', { timeZone: 'Asia/Jakarta' })} WIB (maksimal 5 menit sejak diminta). Jangan bagikan kode ini.`,
      })
      httpStatus = response.status
      if (response.ok) {
        messageId = gatewayMessageId(await response.json())
        if (messageId) { outcome = 'accepted'; status = 'accepted' }
      } else if (response.status === 429 || response.status >= 500) {
        outcome = 'retryable'; status = attempts.length < 2 ? 'retrying' : 'failed'
      } else { outcome = 'failed'; status = 'failed' }
    } catch { /* Timeout, malformed 2xx, or connection failure is ambiguous. Never resend automatically. */ }
    await tx.query('BEGIN')
    if (messageId) await tx.query('SELECT pg_advisory_xact_lock(hashtext($1))', [`ack:${messageId}`])
    await tx.query('UPDATE app.delivery_attempts SET outcome=$2,http_status=$3,message_id=$4,finished_at=now() WHERE id=$1', [attempt.id, outcome, httpStatus, messageId])
    await tx.query('UPDATE app.notifications SET status=$2 WHERE id=$1', [c.notification_id, status])
    if (status !== 'retrying') await tx.query('UPDATE app.otp_challenges SET ciphertext=NULL WHERE id=$1', [challengeId])
    if (messageId) await tx.query(`UPDATE app.notifications n SET status=${deliveryStateSql} WHERE id=$1`, [c.notification_id])
    await tx.query('COMMIT')
    if (status === 'retrying') throw new Error('OTP gateway retry')
  } catch {
    await tx.query('ROLLBACK')
    throw new Error('OTP dispatch incomplete')
  } finally {
    // Do not return a pooled connection carrying a session advisory lock.
    try { if (phone) await tx.query('SELECT pg_advisory_unlock(hashtext($1))', [`otp:${phone}`]); tx.release() }
    catch { tx.release(true) }
  }
}

export function verifyWebhookSignature(raw: string, signature: string | undefined, algorithm: string | undefined, secret: string) {
  if (algorithm !== 'sha512' || !signature || !/^[a-f0-9]{128}$/.test(signature)) return false
  const expected = createHmac('sha512', secret).update(raw).digest('hex')
  return timingSafeEqual(Buffer.from(signature), Buffer.from(expected))
}
export async function receiveDeliveryEvent(database: Database, value: unknown) {
  const v = object(value)
  if (v.session !== 'default' || v.event !== 'message.ack') return { ok: true }
  const payload = object(v.payload)
  if (payload.fromMe !== true) return { ok: true }
  const messageId = serializedMessageKey(text(payload.id, 'Message ID', 300)), ack = payload.ack
  if (!messageId) throw new DomainError(422, 'Message ID tidak valid.')
  if (typeof ack !== 'number' || !Number.isInteger(ack) || ack < -1 || ack > 4) throw new DomainError(422, 'ACK tidak valid.')
  return transaction(database, async (tx) => {
    await tx.query('SELECT pg_advisory_xact_lock(hashtext($1))', [`ack:${messageId}`])
    await tx.query('INSERT INTO app.delivery_events(message_id,ack) VALUES($1,$2) ON CONFLICT DO NOTHING', [messageId, ack])
    // An early ACK is retained and reconciled when sendText returns its message ID.
    await tx.query(`UPDATE app.notifications n SET status=${deliveryStateSql} WHERE n.id IN (SELECT notification_id FROM app.delivery_attempts WHERE message_id=$1)`, [messageId])
    return { ok: true }
  })
}
export async function deliveryLog(database: Database) {
  return { notifications: (await database.pool.query(`SELECT n.id,n.queue_job_id AS "queueJobId",n.status,n.created_at AS "createdAt",
    c.id AS "challengeId",COALESCE(c.purpose,n.kind) AS purpose,b.code AS "bookingCode",i.number AS "invoiceNumber",'+62••••' || right(COALESCE(n.recipient_phone,c.phone,customer.phone),4) AS recipient,
    COALESCE((SELECT json_agg(json_build_object('id',a.id,'outcome',a.outcome,'httpStatus',a.http_status,'messageRef',md5(a.message_id),'startedAt',a.started_at,'finishedAt',a.finished_at) ORDER BY a.started_at)
      FROM app.delivery_attempts a WHERE a.notification_id=n.id),'[]') AS attempts
    FROM app.notifications n LEFT JOIN app.otp_challenges c ON c.id=n.challenge_id
    LEFT JOIN app.bookings b ON b.id=n.booking_id LEFT JOIN app.invoices i ON i.id=n.invoice_id LEFT JOIN app.customers customer ON customer.id=b.customer_id ORDER BY n.created_at DESC LIMIT 50`)).rows }
}
