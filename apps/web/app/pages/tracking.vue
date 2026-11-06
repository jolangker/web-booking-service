<script setup lang="ts">
interface Tracking { status: string, reservationStatus: string, scheduledAt: string, code: string, maskedPlate: string, fetchedAt: string, updatedAt: string, expiresAt: string, terminal: boolean, history: { status: string, reservationStatus: string, action: string, scheduledAt: string, occurredAt: string }[] }
useHead({ title: 'Tracking booking', meta: [{ name: 'robots', content: 'noindex,nofollow,noarchive' }, { name: 'referrer', content: 'no-referrer' }] })
const data = ref<Tracking>(), error = ref(''), busy = ref(false), token = ref('')
let timer: ReturnType<typeof setTimeout> | undefined, controller: AbortController | undefined, invalid = false, disposed = false
function stop() { clearTimeout(timer) }
function schedule() {
  stop()
  if (disposed || document.hidden || invalid || data.value?.terminal) return
  timer = setTimeout(() => void load(), 10000)
}
async function load() {
  if (busy.value || document.hidden || disposed) return
  stop()
  if (!/^[A-Za-z0-9_-]{43}$/.test(token.value)) { invalid = true; error.value = 'Tautan tracking tidak berlaku. Buka tautan lengkap dari booking atau WhatsApp.'; return }
  const requestedToken = token.value
  busy.value = true
  const request = new AbortController(); controller = request
  try {
    const result = await $fetch<Tracking>('/api/tracking', { method: 'POST', body: { token: requestedToken }, signal: request.signal, timeout: 10000 })
    if (requestedToken === token.value) { data.value = result; error.value = ''; invalid = false }
  } catch (e) {
    if (requestedToken !== token.value || request.signal.aborted) return
    error.value = adminError(e)
    if ((e as { statusCode?: number }).statusCode === 404) { data.value = undefined; invalid = true }
  } finally {
    busy.value = false
    if (!document.hidden && (requestedToken !== token.value || request.signal.aborted)) void load()
    else schedule()
  }
}
function updateToken() {
  controller?.abort(); stop(); token.value = window.location.hash.slice(1); data.value = undefined; invalid = false
  void load()
}
function visibility() {
  if (document.hidden) { stop(); controller?.abort() }
  else if (!invalid && !data.value?.terminal) void load()
}
onMounted(() => { void updateToken(); document.addEventListener('visibilitychange', visibility); window.addEventListener('hashchange', updateToken) })
onBeforeUnmount(() => { disposed = true; stop(); controller?.abort(); document.removeEventListener('visibilitychange', visibility); window.removeEventListener('hashchange', updateToken) })
</script>

<template>
  <main class="admin customer-account">
    <header class="page-heading"><h1>Ikuti kunjungan Anda</h1><p>Dari kendaraan diterima sampai transaksi selesai.</p></header>
    <p class="page-note">Diperbarui setiap 10 detik saat halaman aktif. Simpan tautan ini untuk memantau kunjungan Anda.</p>
    <p v-if="error" class="notice error" role="alert">{{ error }}</p>
    <p v-if="busy && !data" role="status">Memuat status…</p>
    <section v-if="data" class="panel" aria-live="polite">
      <div class="tracking-heading"><AppIcon name="wrench" /><div><h2>{{ bookingStatus(data.status, data.reservationStatus) }}</h2><p>{{ data.code }} · Kendaraan {{ data.maskedPlate }}</p></div></div>
      <VisitProgress :status="data.status" :reservation-status="data.reservationStatus" />
      <p>{{ data.reservationStatus === 'cancelled' ? 'Jadwal yang dibatalkan' : 'Jadwal kedatangan' }}: {{ bookingTime(data.scheduledAt) }}</p>
      <p v-if="data.status === 'completed'" class="notice">Pengerjaan selesai. Pembayaran belum lunas; estimasi dikirim melalui WhatsApp.</p>
      <p class="muted" data-tracking-timestamps>Status terakhir: {{ bookingTime(data.updatedAt) }}<br>Terakhir diperiksa: {{ bookingTime(data.fetchedAt) }}<br>Tautan berlaku sampai {{ bookingTime(data.expiresAt) }}</p>
      <h3 class="section-actions">Perjalanan kunjungan</h3><ol class="customer-timeline"><li v-for="(h, i) in data.history" :key="i"><strong>{{ h.action === 'rescheduled' ? 'Jadwal diubah' : bookingStatus(h.status, h.reservationStatus) }}</strong><p>{{ bookingTime(h.occurredAt) }}</p><p v-if="h.action === 'rescheduled'">Jadwal: {{ bookingTime(h.scheduledAt) }}</p></li></ol>
      <p v-if="data.terminal" class="muted">Status akhir tercatat. Pembaruan otomatis dihentikan.</p>
    </section>
    <button :disabled="busy" class="section-actions" @click="load"><AppIcon name="history" /> Perbarui sekarang</button>
  </main>
</template>
