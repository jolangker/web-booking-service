import { createHash, randomBytes } from 'node:crypto'
import { compare, hash, hashSync } from 'bcryptjs'
import type { Database } from '@booking/db'
import { DomainError, object, text, transaction } from './workshop.js'

export const SESSION_SECONDS = 8 * 60 * 60
export const tokenHash = (value: string) => createHash('sha256').update(value).digest('hex')
const randomToken = () => randomBytes(32).toString('hex')
const dummyHash = hashSync(randomToken(), 12)
export function username(value: unknown) {
  const name = text(value, 'Username', 64).toLowerCase()
  if (!/^[a-z0-9._-]{3,64}$/.test(name)) throw new DomainError(422, 'Username: gunakan 3–64 huruf, angka, titik, _ atau -.')
  return name
}
export function password(value: unknown, provisioning = false) {
  if (typeof value !== 'string' || value.length < (provisioning ? 12 : 1) || Buffer.byteLength(value, 'utf8') > 72) throw new DomainError(422, 'Password harus 12 karakter atau lebih saat bootstrap/reset, maksimal 72 byte.')
  return value
}
export async function provisionAdmin(database: Database, name: unknown, secret: unknown, reset: boolean) {
  const user = username(name), passwordHash = await hash(password(secret, true), 12)
  return transaction(database, async (tx) => {
    // Serialize provisioning of the same username, including the first insert.
    await tx.query('SELECT pg_advisory_xact_lock(hashtext($1))', [`admin:${user}`])
    const { rows: [existing] } = await tx.query('SELECT id FROM app.admins WHERE username=$1 FOR UPDATE', [user])
    if (reset && !existing) throw new DomainError(404, 'Admin tidak ditemukan.')
    if (!reset && existing) throw new DomainError(409, 'Admin sudah ada. Gunakan reset eksplisit.')
    if (existing) {
      await tx.query('UPDATE app.admins SET password_hash=$2 WHERE id=$1', [existing.id, passwordHash])
      await tx.query('DELETE FROM app.admin_sessions WHERE admin_id=$1', [existing.id])
      await tx.query('DELETE FROM app.login_throttles WHERE key=$1', [`user:${tokenHash(user)}`])
    } else await tx.query('INSERT INTO app.admins(username,password_hash) VALUES($1,$2)', [user, passwordHash])
    return { ok: true }
  })
}
export async function loginAdmin(database: Database, value: unknown) {
  const v = object(value), name = username(v.username), secret = password(v.password)
  const blocked = await transaction(database, async (tx) => {
    await tx.query('DELETE FROM app.login_throttles WHERE resets_at<=now()')
    let blocked = false
    for (const [key, limit] of [['global', 100], [`user:${tokenHash(name)}`, 5]] as const) {
      const { rows: [row] } = await tx.query(`INSERT INTO app.login_throttles(key,attempts,resets_at) VALUES($1,1,now()+interval '15 minutes')
        ON CONFLICT(key) DO UPDATE SET attempts=CASE WHEN app.login_throttles.resets_at<=now() THEN 1 ELSE app.login_throttles.attempts+1 END,
        resets_at=CASE WHEN app.login_throttles.resets_at<=now() THEN now()+interval '15 minutes' ELSE app.login_throttles.resets_at END RETURNING attempts`, [key])
      if (row.attempts > limit) blocked = true
    }
    return blocked
  })
  if (blocked) throw new DomainError(429, 'Terlalu banyak percobaan. Coba kembali setelah 15 menit.')
  return transaction(database, async (tx) => {
    const { rows: [admin] } = await tx.query('SELECT id,username,password_hash FROM app.admins WHERE username=$1 AND role=\'admin\' FOR UPDATE', [name])
    const valid = await compare(secret, admin?.password_hash ?? dummyHash)
    if (!admin || !valid) throw new DomainError(401, 'Username atau password salah.')
    const token = randomToken(), csrfToken = randomToken()
    await tx.query("DELETE FROM app.admin_sessions WHERE expires_at<=now() OR last_seen_at<=now()-interval '30 minutes'")
    await tx.query('INSERT INTO app.admin_sessions(token_hash,admin_id,csrf_token,expires_at) VALUES($1,$2,$3,now()+interval \'8 hours\')', [tokenHash(token), admin.id, csrfToken])
    return { token, csrfToken, username: admin.username as string }
  })
}
export async function findAdminSession(database: Database, token: string | undefined) {
  if (!token || !/^[a-f0-9]{64}$/.test(token)) return undefined
  const { rows: [session] } = await database.pool.query(`UPDATE app.admin_sessions AS s SET last_seen_at=now() FROM app.admins AS a
    WHERE s.admin_id=a.id AND a.role='admin' AND s.token_hash=$1 AND s.expires_at>now()
    AND s.last_seen_at>now()-interval '30 minutes' RETURNING a.id,a.username,s.csrf_token AS "csrfToken",s.expires_at AS "expiresAt"`, [tokenHash(token)])
  return session as { id: string, username: string, csrfToken: string, expiresAt: Date } | undefined
}
export async function logoutAdmin(database: Database, token: string) {
  await database.pool.query('DELETE FROM app.admin_sessions WHERE token_hash=$1', [tokenHash(token)])
}
