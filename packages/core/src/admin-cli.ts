import { createDatabase } from '@booking/db'
import { DomainError } from './workshop.js'
import { provisionAdmin } from './admin.js'

const mode = process.argv[2]
if (!['bootstrap', 'reset'].includes(mode ?? '') || !process.env.DATABASE_URL || !process.env.ADMIN_USERNAME || !process.env.ADMIN_PASSWORD) {
  console.error('Gunakan bootstrap|reset dengan DATABASE_URL, ADMIN_USERNAME, ADMIN_PASSWORD pada environment proses; jangan kirim password sebagai argumen.')
  process.exit(1)
}
const database = createDatabase(process.env.DATABASE_URL)
try {
  await provisionAdmin(database, process.env.ADMIN_USERNAME, process.env.ADMIN_PASSWORD, mode === 'reset')
  console.log(JSON.stringify({ event: `admin.${mode}.completed` }))
} catch (error) {
  console.error(error instanceof DomainError ? error.message : 'Operasi Admin gagal. Periksa migration dan koneksi DB.')
  process.exitCode = 1
} finally {
  delete process.env.ADMIN_PASSWORD
  await database.pool.end()
}
