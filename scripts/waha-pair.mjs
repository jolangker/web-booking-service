import { createServer } from 'node:http'
import { spawn, spawnSync } from 'node:child_process'
import { setTimeout as delay } from 'node:timers/promises'

const controller = new AbortController()
let server
let qr
let status = 'STARTING'
let message = 'Menyiapkan sesi default...'

const page = `<!doctype html>
<html lang="id"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Pairing WAHA lokal</title>
<style>
body{font:17px system-ui,sans-serif;background:#f5f7f8;color:#172b35;margin:0;padding:24px}
main{max-width:520px;margin:32px auto}img{display:block;width:320px;max-width:100%;height:auto;background:white}img[hidden]{display:none}
</style>
<main><h1>Pairing WAHA</h1><p>Di HP: WhatsApp → Perangkat tertaut → Tautkan perangkat.</p>
<p id="status" role="status">Menunggu gateway...</p><img id="qr" alt="QR pairing WhatsApp" hidden>
<p>Sesi: default. Halaman ini memperbarui QR otomatis. Setelah terhubung, tutup script dengan Ctrl+C.</p></main>
<script>
const image=document.getElementById('qr');
async function refresh(){
  try{
    const response=await fetch('/status');
    if(!response.ok)throw new Error();
    const data=await response.json();
    document.getElementById('status').textContent=data.status+' — '+data.message;
    image.hidden=!data.hasQr;
    if(data.hasQr)image.src='/qr.png?t='+Date.now();
    else image.removeAttribute('src');
  }catch{image.hidden=true;image.removeAttribute('src');document.getElementById('status').textContent='Script berhenti. Halaman ini bisa ditutup.'}
}
refresh();setInterval(refresh,2000);
</script></html>`

async function main() {
  const base = new URL(process.env.WAHA_BASE_URL ?? 'http://127.0.0.1:3001')
  const key = process.env.WAHA_API_KEY ?? ''
  if (process.env.APP_ENV !== 'development'
    || !['http://127.0.0.1:3001', 'http://localhost:3001'].includes(base.origin)
    || base.username || base.password || base.pathname !== '/' || base.search || base.hash) {
    throw new Error('Gunakan APP_ENV=development dan WAHA_BASE_URL=http://127.0.0.1:3001.')
  }
  if (key.length < 32 || key.startsWith('REPLACE')) throw new Error('Isi WAHA_API_KEY pada .env terlebih dahulu.')
  console.log('Menjalankan WAHA development...')
  const compose = spawnSync('docker', ['compose', '--env-file', '.env', '-f', 'infra/compose.dev.yml', 'up', '-d', '--wait', 'waha'], { stdio: 'pipe' })
  if (compose.status !== 0) throw new Error('WAHA gagal dimulai. Periksa Docker dengan pnpm infra:up.')

  async function api(path, method = 'GET', body) {
    return fetch(new URL(path, base), {
      method, headers: { 'X-Api-Key': key, 'Content-Type': 'application/json', Accept: path.includes('/auth/qr') ? 'image/png' : 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
      redirect: 'error', signal: AbortSignal.any([controller.signal, AbortSignal.timeout(10000)]),
    })
  }
  async function mutate(path, body) {
    const response = await api(path, 'POST', body)
    if (!response.ok) throw new Error(`WAHA menolak operasi sesi (HTTP ${response.status}).`)
  }
  const existing = await api('/api/sessions/default')
  if (existing.status === 404) await mutate('/api/sessions', { name: 'default', start: true })
  else {
    if (!existing.ok) throw new Error(`Gagal membaca sesi WAHA (HTTP ${existing.status}). Periksa API key.`)
    const session = await existing.json()
    if (session.status === 'STOPPED') await mutate('/api/sessions/default/start')
    if (session.status === 'FAILED') await mutate('/api/sessions/default/restart')
  }

  server = createServer((request, response) => {
    response.setHeader('Cache-Control', 'no-store')
    response.setHeader('X-Content-Type-Options', 'nosniff')
    response.setHeader('Referrer-Policy', 'no-referrer')
    response.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; frame-ancestors 'none'")
    if (request.headers.host !== `127.0.0.1:${server.address().port}`) {
      response.writeHead(403).end()
    } else if (request.url === '/') {
      response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' }).end(page)
    } else if (request.url === '/status') {
      response.writeHead(200, { 'Content-Type': 'application/json' }).end(JSON.stringify({ status, message, hasQr: Boolean(qr) }))
    } else if (request.url?.split('?')[0] === '/qr.png' && qr) {
      response.writeHead(200, { 'Content-Type': 'image/png' }).end(qr)
    } else response.writeHead(404).end()
  })
  await new Promise((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', resolve)
  })
  const url = `http://127.0.0.1:${server.address().port}`
  console.log(`Buka ${url} lalu scan QR dari WhatsApp di HP. Ctrl+C untuk selesai.`)
  if (!process.argv.includes('--no-open')) {
    const [command, args] = process.platform === 'win32'
      ? ['rundll32.exe', ['url.dll,FileProtocolHandler', url]]
      : process.platform === 'darwin' ? ['open', [url]] : ['xdg-open', [url]]
    const browser = spawn(command, args, { stdio: 'ignore', detached: true })
    browser.on('error', () => console.log('Browser tidak terbuka otomatis; buka URL di atas.'))
    browser.unref()
  }

  let previous
  while (!controller.signal.aborted) {
    try {
      const response = await api('/api/sessions/default')
      if (!response.ok) throw new Error('Status unavailable')
      const session = await response.json()
      const statuses = ['STOPPED', 'STARTING', 'SCAN_QR_CODE', 'WORKING', 'FAILED', 'PASSKEY_REQUIRED', 'PASSKEY_CONFIRMATION_REQUIRED']
      status = statuses.includes(session.status) ? session.status : 'UNKNOWN'
      qr = undefined
      message = 'Menunggu gateway...'
      if (status === 'SCAN_QR_CODE') {
        message = 'Scan QR ini lewat menu Perangkat tertaut.'
        const image = await api('/api/default/auth/qr?format=image')
        if (image.ok && image.headers.get('content-type')?.includes('image/png')) qr = Buffer.from(await image.arrayBuffer())
      }
      if (status === 'WORKING') message = 'Terhubung! Pairing berhasil. Script boleh ditutup.'
      if (status === 'FAILED' || status === 'STOPPED') message = 'Sesi berhenti. Jalankan ulang pnpm waha:pair untuk mencoba lagi.'
      if (status.startsWith('PASSKEY_')) message = 'Selesaikan konfirmasi keamanan pada WhatsApp di HP; alur passkey belum ditangani script ini.'
      if (status !== previous) console.log(`${status}: ${message}`)
      previous = status
    } catch {
      qr = undefined
      message = 'Koneksi WAHA terganggu atau API key ditolak. Mencoba lagi...'
    }
    await delay(2000, undefined, { signal: controller.signal })
  }
}

for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => controller.abort())
try {
  await main()
} catch (error) {
  if (!controller.signal.aborted) {
    // Only our fixed messages are logged; never print gateway responses or credentials.
    const known = ['Gunakan ', 'Isi WAHA_API_KEY', 'WAHA gagal', 'WAHA menolak', 'Gagal membaca sesi']
    console.error(known.some(prefix => error.message?.startsWith(prefix)) ? error.message : 'Tidak dapat menghubungi WAHA. Periksa Docker dan konfigurasi .env.')
    process.exitCode = 1
  }
} finally {
  qr = undefined
  server?.closeAllConnections()
  if (server) await new Promise(resolve => server.close(resolve))
}
