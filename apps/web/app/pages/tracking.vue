<script setup lang="ts">
interface Tracking { status: string, reservationStatus: string, scheduledAt: string, history: { status: string, reservationStatus: string, action: string, scheduledAt: string, occurredAt: string }[] }
useHead({ title: 'Tracking booking', meta: [{ name: 'robots', content: 'noindex,nofollow,noarchive' }, { name: 'referrer', content: 'no-referrer' }] })
const data = ref<Tracking>(), error = ref(''), busy = ref(false), token = ref('')
let timer: ReturnType<typeof setInterval> | undefined
async function load() {
  if (busy.value || document.hidden) return
  if (!/^[A-Za-z0-9_-]{43}$/.test(token.value)) { error.value = 'Tautan tracking tidak berlaku. Buka tautan lengkap dari booking atau WhatsApp.'; return }
  busy.value = true
  try { data.value = await $fetch<Tracking>('/api/tracking', { method: 'POST', body: { token: token.value } }); error.value = '' }
  catch (e) { error.value = adminError(e); if ((e as { statusCode?: number }).statusCode === 404) data.value = undefined }
  finally { busy.value = false }
}
function updateToken() { token.value = window.location.hash.slice(1); data.value = undefined; void load() }
onMounted(() => {
  updateToken()
  document.addEventListener('visibilitychange', load)
  window.addEventListener('hashchange', updateToken)
  timer = setInterval(load, 10000)
})
onBeforeUnmount(() => { clearInterval(timer); document.removeEventListener('visibilitychange', load); window.removeEventListener('hashchange', updateToken) })
</script>

<template>
  <main class="admin customer-account">
    <p class="eyebrow">BOOKING BENGKEL</p><h1>Status booking</h1>
    <p class="muted">Diperbarui setiap 10 detik saat halaman aktif. Simpan tautan ini untuk memantau kunjungan Anda.</p>
    <p v-if="error" class="notice error" role="alert">{{ error }}</p>
    <p v-if="busy && !data" role="status">Memuat status…</p>
    <section v-if="data" class="panel" aria-live="polite">
      <h2>{{ bookingStatus(data.status, data.reservationStatus) }}</h2><p>{{ data.reservationStatus === 'cancelled' ? 'Jadwal yang dibatalkan' : 'Jadwal kedatangan' }}: {{ bookingTime(data.scheduledAt) }}</p>
      <ol><li v-for="(h, i) in data.history" :key="i"><strong>{{ h.action === 'rescheduled' ? 'Jadwal diubah' : bookingStatus(h.status, h.reservationStatus) }}</strong><p>{{ bookingTime(h.occurredAt) }}</p><p v-if="h.action === 'rescheduled'">Jadwal: {{ bookingTime(h.scheduledAt) }}</p></li></ol>
    </section>
    <button :disabled="busy" class="section-actions" @click="load">Perbarui sekarang</button>
  </main>
</template>
