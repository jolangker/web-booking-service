<script setup lang="ts">
const props = defineProps<{ invoiceId: string, ready: boolean }>(), { request } = useAdmin()
interface Delivery { id: string, status: string, createdAt: string, recipient: string, attempts: { outcome: string, startedAt: string, finishedAt: string | null }[] }
const deliveries = ref<Delivery[]>([]), error = ref(''), notice = ref(''), busy = ref(false)
const descriptions: Record<string, string> = { queued: 'Pending — menunggu worker', retrying: 'Pending — akan dicoba kembali', sending: 'Sedang mengirim', accepted: 'Diterima gateway; belum terkonfirmasi terkirim', sent: 'Terkirim ke server WhatsApp', delivered: 'Diterima perangkat WhatsApp', read: 'Dibaca', failed: 'Gagal; dapat dikirim ulang setelah penyebab diperbaiki', unknown: 'Hasil belum pasti; periksa WhatsApp sebelum mengirim ulang', stale: 'Dibatalkan karena kontak berubah; kirim ulang ke kontak terbaru' }
const active = computed(() => deliveries.value.some(d => ['queued', 'retrying', 'sending'].includes(d.status)))
let timer: ReturnType<typeof setInterval> | undefined
async function load() {
  try { deliveries.value = (await $fetch<{ deliveries: Delivery[] }>(`/api/admin/invoices/${props.invoiceId}/deliveries`)).deliveries }
  catch (e) { error.value = adminError(e) }
}
async function send() {
  if (busy.value) return
  busy.value = true; error.value = ''; notice.value = ''
  const storageKey = `invoice-delivery:${props.invoiceId}`, key = sessionStorage.getItem(storageKey) ?? crypto.randomUUID()
  sessionStorage.setItem(storageKey, key)
  try {
    deliveries.value = (await request<{ deliveries: Delivery[] }>(`/api/admin/invoices/${props.invoiceId}/deliveries`, 'POST', { idempotencyKey: key })).deliveries
    sessionStorage.removeItem(storageKey); notice.value = 'Request pengiriman tercatat. Periksa hasil di bawah; status antrean belum berarti pesan diterima.'
  } catch (e) {
    error.value = adminError(e)
    const status = (e as { status?: number }).status
    if (status && status >= 400 && status < 500) sessionStorage.removeItem(storageKey)
    await load()
  } finally { busy.value = false }
}
onMounted(() => { void load(); timer = setInterval(() => { if (!busy.value) void load() }, 5000) })
onBeforeUnmount(() => clearInterval(timer))
</script>

<template>
  <section class="section-actions" data-invoice-delivery>
    <h3>Kirim Invoice Digital</h3><p>Tautan dikirim ke WhatsApp kontak pelanggan saat ini. Pelanggan masuk dengan OTP untuk mengakses invoice.</p>
    <p v-if="error" class="notice error" role="alert">{{ error }}</p><p v-if="notice" role="status">{{ notice }}</p>
    <div class="actions"><button data-send-invoice :disabled="busy || !ready || active" @click="send">{{ deliveries.length ? 'Kirim ulang Invoice Digital' : 'Kirim Invoice Digital' }}</button><button :disabled="busy" @click="load">Perbarui status pengiriman</button></div>
    <p class="muted">Hanya dikirim saat Admin memilih tindakan ini. Jeda 60 detik; maksimal 3 pengiriman per jam. Untuk hasil belum pasti, periksa penerimaan pesan sebelum kirim ulang.</p>
    <p v-if="!deliveries.length">Belum ada pengiriman invoice.</p>
    <ol><li v-for="d in deliveries" :key="d.id"><p data-invoice-delivery-status>{{ bookingTime(d.createdAt) }} · {{ d.recipient }} · {{ descriptions[d.status] ?? d.status }}</p><details v-if="d.attempts.length"><summary>{{ d.attempts.length }} percobaan</summary><ul><li v-for="(a, index) in d.attempts" :key="index">{{ bookingTime(a.startedAt) }} · {{ a.outcome }}</li></ul></details></li></ol>
  </section>
</template>
