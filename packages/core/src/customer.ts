import { createCipheriv, createDecipheriv, createHash, createHmac, randomBytes, randomInt, randomUUID, timingSafeEqual } from 'node:crypto'
import type { Database } from '@booking/db'
import type { Runtime } from './index.js'
import type { Environment } from './env.js'
import { tokenHash } from './admin.js'
import { DomainError, integer, object, text, transaction } from './workshop.js'

export const OTP_QUEUE = 'customer-otp'
export const CUSTOMER_SESSION_SECONDS = 7 * 24 * 60 * 60
export const uuid = (value: unknown) => {
  if (typeof value !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(value)) throw new DomainError(422, 'ID tidak valid.')
  return value
}
export function phoneNumber(value: unknown) {
  let phone = text(value, 'Nomor WhatsApp', 30).replace(/[\s()-]/g, '')
  if (phone.startsWith('08')) phone = `+62${phone.slice(1)}`
  else if (phone.startsWith('628')) phone = `+${phone}`
  if (!/^[+]628\d{8,11}$/.test(phone)) throw new DomainError(422, 'Gunakan nomor seluler Indonesia +628… atau 08… (10–13 digit nasional).')
  return phone
}
export function vehicleInput(value: unknown) {
  const v = object(value), plate = text(v.plate, 'Plat', 15).replace(/\s/g, '').toUpperCase()
  if (!/^[A-Z]{1,2}\d{1,4}[A-Z]{0,3}$/.test(plate)) throw new DomainError(422, 'Plat harus berisi kode wilayah, 1–4 angka dan maksimal 3 huruf belakang.')
  return { plate, brand: text(v.brand, 'Merek', 60), model: text(v.model, 'Tipe/model', 80), year: integer(v.year, 'Tahun', 1900, new Date().getFullYear() + 1) }
}
const secretKey = (secret: string) => createHash('sha256').update(secret).digest()
export const otpVerifier = (secret: string, id: string, code: string) => createHmac('sha256', secret).update(`${id}:${code}`).digest('hex')
function encryptCode(secret: string, id: string, code: string) {
  const iv = randomBytes(12), cipher = createCipheriv('aes-256-gcm', secretKey(secret), iv)
  cipher.setAAD(Buffer.from(id))
  const encrypted = Buffer.concat([cipher.update(code, 'utf8'), cipher.final()])
  return Buffer.concat([iv, cipher.getAuthTag(), encrypted]).toString('base64')
}
export function decryptOtp(secret: string, id: string, payload: string) {
  const buffer = Buffer.from(payload, 'base64'), cipher = createDecipheriv('aes-256-gcm', secretKey(secret), buffer.subarray(0, 12))
  cipher.setAAD(Buffer.from(id)); cipher.setAuthTag(buffer.subarray(12, 28))
  return Buffer.concat([cipher.update(buffer.subarray(28)), cipher.final()]).toString('utf8')
}
export interface OtpScope { binding: string, customerId?: string }
export async function requestOtp(runtime: Runtime, env: Environment, value: unknown, ip: string, scope: OtpScope) {
  const phone = phoneNumber(object(value).phone), id = randomUUID(), code = String(randomInt(0, 10000)).padStart(4, '0')
  if (scope.customerId) uuid(scope.customerId)
  await runtime.startQueue()
  return transaction(runtime, async (tx) => {
    // The worker takes the same lock through dispatch, so resend cannot overtake a send.
    await tx.query('SELECT pg_advisory_xact_lock(hashtext($1))', [`otp:${phone}`])
    if (scope.customerId) {
      const { rows: [customer] } = await tx.query('SELECT phone FROM app.customers WHERE id=$1', [scope.customerId])
      if (!customer) throw new DomainError(404, 'Pelanggan tidak ditemukan.')
      if (customer.phone === phone) throw new DomainError(422, 'Nomor baru harus berbeda.')
      if ((await tx.query('SELECT id FROM app.customers WHERE phone=$1', [phone])).rowCount) throw new DomainError(409, 'Nomor sudah digunakan pelanggan lain. Akun tidak digabungkan.')
    }
    const { rows: [last] } = await tx.query("SELECT created_at+interval '60 seconds' AS resend_at,created_at+interval '60 seconds'>now() AS cooling FROM app.otp_challenges WHERE phone=$1 ORDER BY created_at DESC LIMIT 1", [phone])
    if (last?.cooling) throw new DomainError(429, 'Tunggu 60 detik sebelum meminta kode lagi.', { resendAt: last.resend_at })
    // Number and IP quotas share the transaction with enqueue. Never trust forwarded IP headers.
    for (const [key, limit] of [[`otp-number:${tokenHash(phone)}`, 5], [`otp-ip:${tokenHash(ip)}`, 20]] as const) {
      const { rows: [rate] } = await tx.query(`INSERT INTO app.login_throttles(key,attempts,resets_at) VALUES($1,1,now()+interval '15 minutes')
        ON CONFLICT(key) DO UPDATE SET attempts=CASE WHEN app.login_throttles.resets_at<=now() THEN 1 ELSE app.login_throttles.attempts+1 END,
        resets_at=CASE WHEN app.login_throttles.resets_at<=now() THEN now()+interval '15 minutes' ELSE app.login_throttles.resets_at END RETURNING attempts`, [key])
      if (rate.attempts > limit) throw new DomainError(429, 'Batas permintaan tercapai. Coba setelah 15 menit.')
    }
    await tx.query('UPDATE app.otp_challenges SET invalidated_at=now(),ciphertext=NULL,verifier=NULL WHERE phone=$1 AND consumed_at IS NULL AND invalidated_at IS NULL', [phone])
    // A fresh contact target also replaces any earlier contact challenge for this account.
    if (scope.customerId) await tx.query("UPDATE app.otp_challenges SET invalidated_at=now(),ciphertext=NULL,verifier=NULL WHERE customer_id=$1 AND consumed_at IS NULL AND invalidated_at IS NULL", [scope.customerId])
    const { rows: [challenge] } = await tx.query(`INSERT INTO app.otp_challenges(id,phone,purpose,customer_id,binding,verifier,ciphertext,expires_at)
      VALUES($1,$2,$3,$4,$5,$6,$7,now()+interval '5 minutes') RETURNING id,expires_at AS "expiresAt",created_at+interval '60 seconds' AS "resendAt"`,
    [id, phone, scope.customerId ? 'contact' : 'login', scope.customerId ?? null, scope.binding, otpVerifier(env.otpSecret, id, code), encryptCode(env.otpSecret, id, code)])
    const jobId = await runtime.boss.send(OTP_QUEUE, { challengeId: id }, { priority: 100, db: { executeSql: (query, values) => tx.query(query, values) } })
    if (!jobId) throw new Error('OTP enqueue failed')
    await tx.query('INSERT INTO app.notifications(challenge_id,queue_job_id) VALUES($1,$2)', [id, jobId])
    return { ...challenge, status: 'queued' as const }
  })
}

export async function otpStatus(database: Database, id: unknown, scope: OtpScope) {
  const { rows: [row] } = await database.pool.query(`SELECT c.id,c.expires_at AS "expiresAt",c.created_at+interval '60 seconds' AS "resendAt",
    CASE WHEN c.consumed_at IS NOT NULL THEN 'used' WHEN c.invalidated_at IS NOT NULL THEN 'stale' WHEN c.expires_at<=now() THEN 'expired'
    WHEN c.attempts>=3 THEN 'locked' ELSE n.status END AS status FROM app.otp_challenges c JOIN app.notifications n ON n.challenge_id=c.id
    WHERE c.id=$1 AND c.binding=$2 AND c.customer_id IS NOT DISTINCT FROM $3::uuid`, [uuid(id), scope.binding, scope.customerId ?? null])
  if (!row) throw new DomainError(404, 'Permintaan OTP tidak ditemukan.')
  return row
}

export async function verifyOtp(database: Database, env: Environment, value: unknown, scope: OtpScope) {
  const v = object(value), id = uuid(v.id)
  const code = text(v.code, 'OTP', 4)
  if (!/^\d{4}$/.test(code)) throw new DomainError(422, 'OTP harus 4 angka.')
  const result = await transaction(database, async (tx) => {
    const { rows: [hint] } = await tx.query('SELECT phone FROM app.otp_challenges WHERE id=$1 AND binding=$2 AND customer_id IS NOT DISTINCT FROM $3::uuid', [id, scope.binding, scope.customerId ?? null])
    if (!hint) return { error: true as const }
    await tx.query('SELECT pg_advisory_xact_lock(hashtext($1))', [`otp:${hint.phone}`])
    const { rows: [c] } = await tx.query('SELECT *,expires_at>now() AS active FROM app.otp_challenges WHERE id=$1 FOR UPDATE', [id])
    if (!c.active || c.invalidated_at || c.consumed_at || c.attempts >= 3 || !c.verifier) return { error: true as const }
    const valid = timingSafeEqual(Buffer.from(c.verifier), Buffer.from(otpVerifier(env.otpSecret, id, code)))
    await tx.query('UPDATE app.otp_challenges SET attempts=attempts+1 WHERE id=$1', [id])
    if (!valid) {
      if (c.attempts === 2) await tx.query('UPDATE app.otp_challenges SET ciphertext=NULL,verifier=NULL WHERE id=$1', [id])
      return { error: true as const }
    }
    let customerId = c.customer_id as string | null
    if (c.purpose === 'contact') {
      // The unique constraint is the final arbiter when two accounts verify the same target.
      const { rows: [updated] } = await tx.query('UPDATE app.customers SET phone=$2,verified_at=now(),version=version+1 WHERE id=$1 RETURNING id', [customerId, c.phone])
      if (!updated) return { error: true as const }
      await tx.query('DELETE FROM app.customer_sessions WHERE customer_id=$1', [customerId])
      await tx.query('UPDATE app.otp_challenges SET invalidated_at=now(),ciphertext=NULL,verifier=NULL WHERE customer_id=$1 AND id<>$2 AND consumed_at IS NULL', [customerId, id])
    } else {
      const { rows: [customer] } = await tx.query(`INSERT INTO app.customers(phone,verified_at) VALUES($1,now())
        ON CONFLICT(phone) DO UPDATE SET verified_at=now() RETURNING id`, [c.phone])
      customerId = customer.id
    }
    await tx.query('UPDATE app.otp_challenges SET consumed_at=now(),ciphertext=NULL,verifier=NULL WHERE id=$1', [id])
    if (scope.customerId) return { ok: true as const }
    const token = randomBytes(32).toString('hex'), csrfToken = randomBytes(32).toString('hex')
    await tx.query("INSERT INTO app.customer_sessions(token_hash,customer_id,csrf_token,expires_at) VALUES($1,$2,$3,now()+interval '7 days')", [tokenHash(token), customerId, csrfToken])
    return { token, csrfToken, customerId }
  }).catch((error: unknown) => {
    if ((error as { code?: string }).code === '23505') throw new DomainError(409, 'Nomor sudah digunakan. Akun tidak digabungkan.')
    throw error
  })
  // Throw AFTER commit: incorrect attempts must not be rolled back.
  if ('error' in result) throw new DomainError(401, 'OTP salah, kedaluwarsa, diganti, atau batas 3 percobaan tercapai.')
  return result
}

export async function findCustomerSession(database: Database, token: string | undefined) {
  if (!token || !/^[a-f0-9]{64}$/.test(token)) return undefined
  const { rows: [session] } = await database.pool.query(`UPDATE app.customer_sessions s SET last_seen_at=now() FROM app.customers c
    WHERE s.customer_id=c.id AND s.token_hash=$1 AND s.expires_at>now() AND s.last_seen_at>now()-interval '24 hours'
    RETURNING c.id,s.csrf_token AS "csrfToken",s.token_hash AS binding`, [tokenHash(token)])
  return session as { id: string, csrfToken: string, binding: string } | undefined
}
export async function logoutCustomer(database: Database, token: string) {
  await database.pool.query('DELETE FROM app.customer_sessions WHERE token_hash=$1', [tokenHash(token)])
}

export async function customerProfile(database: Database, id: string) {
  const { rows: [customer] } = await database.pool.query('SELECT id,name,phone,verified_at AS "verifiedAt",version FROM app.customers WHERE id=$1', [uuid(id)])
  if (!customer) throw new DomainError(404, 'Pelanggan tidak ditemukan.')
  const { rows: vehicles } = await database.pool.query('SELECT id,plate,brand,model,year,version FROM app.vehicles WHERE customer_id=$1 ORDER BY created_at,id', [id])
  return { customer, vehicles }
}
export async function customerVehicle(database: Database, customerId: string, id: string) {
  const { rows: [vehicle] } = await database.pool.query('SELECT id,plate,brand,model,year,version FROM app.vehicles WHERE id=$1 AND customer_id=$2', [uuid(id), uuid(customerId)])
  if (!vehicle) throw new DomainError(404, 'Kendaraan tidak ditemukan.')
  return vehicle as { id: string, plate: string, brand: string, model: string, year: number, version: number }
}
export async function saveCustomer(database: Database, value: unknown, id?: string) {
  const v = object(value), name = text(v.name, 'Nama', 100)
  try {
    if (!id) {
      const { rows: [row] } = await database.pool.query('INSERT INTO app.customers(name,phone) VALUES($1,$2) RETURNING id', [name, phoneNumber(v.phone)])
      return row as { id: string }
    }
    // Phone edits have a separate OTP flow for both Admin and customer.
    if ('phone' in v) throw new DomainError(422, 'Gunakan verifikasi nomor baru untuk mengubah nomor WhatsApp.')
    const { rows: [row] } = await database.pool.query('UPDATE app.customers SET name=$2,version=version+1 WHERE id=$1 AND version=$3 RETURNING id', [uuid(id), name, integer(v.version, 'Versi', 1, 2147483647)])
    if (!row) throw new DomainError(409, 'Profil berubah. Muat ulang sebelum menyimpan.')
    return row as { id: string }
  } catch (error) {
    if ((error as { code?: string }).code === '23505') throw new DomainError(409, 'Nomor sudah terdaftar. Cari dan gunakan profil yang sudah ada.')
    throw error
  }
}
export async function saveVehicle(database: Database, customerId: string, value: unknown, id?: string) {
  const v = vehicleInput(value)
  return transaction(database, async (tx) => {
    if (!(await tx.query('SELECT id FROM app.customers WHERE id=$1', [uuid(customerId)])).rowCount) throw new DomainError(404, 'Pelanggan tidak ditemukan.')
    if (id && !(await tx.query('SELECT id FROM app.vehicles WHERE id=$1 AND customer_id=$2 FOR UPDATE', [uuid(id), customerId])).rowCount) throw new DomainError(404, 'Kendaraan tidak ditemukan.')
    try {
      const query = id ? 'UPDATE app.vehicles SET plate=$2,brand=$3,model=$4,year=$5,version=version+1 WHERE id=$1 AND version=$6 RETURNING id' : 'INSERT INTO app.vehicles(customer_id,plate,brand,model,year) VALUES($1,$2,$3,$4,$5) RETURNING id'
      const params = [id ?? customerId, v.plate, v.brand, v.model, v.year, ...(id ? [integer(object(value).version, 'Versi', 1, 2147483647)] : [])]
      const { rows: [row] } = await tx.query(query, params)
      if (!row) throw new DomainError(409, 'Kendaraan berubah. Muat ulang sebelum menyimpan.')
      return row as { id: string }
    } catch (error) {
      if ((error as { code?: string }).code === '23505') throw new DomainError(409, 'Plat sudah terdaftar. Kepemilikan tidak dipindahkan otomatis; hubungi Admin.')
      throw error
    }
  })
}
export async function searchCustomers(database: Database, value: unknown) {
  const search = text(value ?? '', 'Pencarian', 100, 0)
  // Strip separators as well so a formatted plate/phone can find its canonical identity.
  const compact = search.replace(/[\s()+-]/g, '')
  const { rows } = await database.pool.query(`SELECT c.id,c.name,c.phone,c.verified_at AS "verifiedAt" FROM app.customers c
    WHERE strpos(lower(c.name),lower($1))>0 OR strpos(c.phone,$2)>0 OR EXISTS
    (SELECT 1 FROM app.vehicles v WHERE v.customer_id=c.id AND strpos(v.plate,upper($2))>0) ORDER BY c.created_at DESC,c.id LIMIT 50`, [search, compact])
  return { customers: rows }
}
