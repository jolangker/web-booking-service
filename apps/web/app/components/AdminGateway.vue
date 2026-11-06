<script setup lang="ts">
const gateway = ref<{ status: string, checkedAt: string }>(), error = ref(''), busy = ref(false)
const { request } = useAdmin()
const pairing = ref(false), pairingError = ref(''), qrUrl = ref(''), polling = ref(false)
let timer: ReturnType<typeof setInterval> | undefined, disposed = false
const notifications = ref<{ id: string, queueJobId: string, status: string, recipient: string, purpose: string, bookingCode: string | null, invoiceNumber: string | null, createdAt: string, attempts: { id: string, outcome: string, httpStatus: number | null }[] }[]>([])
function clearQr() {
  if (qrUrl.value) URL.revokeObjectURL(qrUrl.value)
  qrUrl.value = ''
}
async function updateQr() {
  if (gateway.value?.status === 'WORKING') { pairing.value = false; pairingError.value = '' }
  if (!pairing.value || gateway.value?.status !== 'SCAN_QR_CODE') { clearQr(); return }
  try {
    const image = await $fetch<Blob>('/api/admin/gateway/qr', { responseType: 'blob' })
    if (disposed || !pairing.value) return
    clearQr(); qrUrl.value = URL.createObjectURL(image); pairingError.value = ''
  } catch (e) { clearQr(); pairingError.value = adminError(e) }
}
async function readGateway() {
  const result = await $fetch<{ status: string, checkedAt: string }>('/api/admin/gateway')
  if (disposed) return
  gateway.value = result
  await updateQr()
}
async function pair() {
  if (busy.value || polling.value) return
  busy.value = true; pairingError.value = ''; pairing.value = true; clearQr()
  try {
    const result = await request<{ status: string, checkedAt: string }>('/api/admin/gateway/pair', 'POST', {})
    if (disposed) return
    gateway.value = result; await updateQr()
  } catch (e) { pairingError.value = adminError(e) }
  finally { busy.value = false }
}
async function load() {
  busy.value = true; error.value = ''
  const results = await Promise.allSettled([
    readGateway(),
    $fetch<{ notifications: typeof notifications.value }>('/api/admin/deliveries'),
  ])
  if (results[0].status === 'rejected') error.value = adminError(results[0].reason)
  if (results[1].status === 'fulfilled') notifications.value = results[1].value.notifications
  else error.value = adminError(results[1].reason)
  busy.value = false
}
onMounted(() => {
  void load()
  timer = setInterval(async () => {
    if (busy.value || polling.value || document.visibilityState !== 'visible') return
    polling.value = true
    try { await readGateway() }
    catch (e) { clearQr(); pairingError.value = adminError(e) }
    finally { polling.value = false }
  }, 3000)
})
onBeforeUnmount(() => { disposed = true; clearInterval(timer); clearQr() })
</script>

<template>
  <section class="panel">
    <div class="admin-header"><h2>WhatsApp gateway</h2><div class="actions"><button v-if="gateway?.status !== 'WORKING'" data-gateway-pair :disabled="busy || polling || gateway?.status === 'STARTING'" @click="pair">{{ pairing ? 'Tampilkan QR baru' : 'Hubungkan WhatsApp' }}</button><button :disabled="busy || polling" @click="load">{{ busy ? 'Memuat…' : 'Baca status terbaru' }}</button></div></div>
    <p v-if="error" role="alert" class="notice error">{{ error }}</p>
    <p v-if="gateway" role="status">Sesi default: <strong>{{ gateway.status }}</strong> · Diperiksa {{ new Date(gateway.checkedAt).toLocaleString('id-ID') }}</p>
    <p v-if="pairingError" role="alert" class="notice error">{{ pairingError }}</p>
    <div v-if="pairing" class="section-actions" data-gateway-pairing>
      <p v-if="qrUrl">Di HP buka <strong>WhatsApp → Perangkat tertaut → Tautkan perangkat</strong>, lalu scan QR ini.</p>
      <img v-if="qrUrl" data-gateway-qr :src="qrUrl" class="gateway-qr" alt="QR untuk menghubungkan WhatsApp bengkel">
      <p v-else-if="gateway?.status === 'FAILED'">QR kedaluwarsa atau sesi gagal. Pilih Tampilkan QR baru untuk mencoba lagi.</p>
      <p v-else-if="gateway?.status.startsWith('PASSKEY_')">Selesaikan konfirmasi keamanan pada WhatsApp di HP.</p>
      <p v-else role="status">Menunggu QR dari WhatsApp. Status diperbarui otomatis.</p>
      <p class="muted">QR diperbarui otomatis dan hanya terlihat oleh Admin. Setelah WORKING, WhatsApp tetap berjalan di server meskipun halaman ini ditutup.</p>
    </div>
    <p class="muted">WORKING berarti terhubung. Status accepted hanya berarti API gateway menerima request; delivered/read berasal dari webhook.</p>
    <h3>50 notifikasi terakhir</h3>
    <p v-if="!notifications.length && !busy">Belum ada pengiriman.</p>
    <div class="table-scroll"><table v-if="notifications.length"><thead><tr><th>Waktu / korelasi</th><th>Penerima</th><th>Status</th><th>Attempt</th></tr></thead><tbody>
      <tr v-for="item in notifications" :key="item.id"><td>{{ new Date(item.createdAt).toLocaleString('id-ID') }}<p>{{ item.purpose }}<span v-if="item.bookingCode"> · {{ item.bookingCode }}</span><span v-if="item.invoiceNumber"> · {{ item.invoiceNumber }}</span></p><details><summary>ID pengiriman</summary><p>{{ item.id }}</p><p>Job: {{ item.queueJobId }}</p></details></td><td>{{ item.recipient }}</td><td>{{ item.status }}</td><td><ul><li v-for="(attempt, i) in item.attempts" :key="attempt.id">{{ i + 1 }}: {{ attempt.outcome }}{{ attempt.httpStatus ? ` (HTTP ${attempt.httpStatus})` : '' }}</li></ul><span v-if="!item.attempts.length">Belum ada attempt</span></td></tr>
    </tbody></table></div>
  </section>
</template>

<style scoped>
.gateway-qr { display: block; width: 320px; max-width: 100%; height: auto; background: white; }
</style>
