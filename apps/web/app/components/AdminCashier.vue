<script setup lang="ts">
import type { CostLine } from './DraftCostEditor.vue'
const props = defineProps<{ initialBookingId?: string }>()
interface Order { id: string, code: string, status: string, customerName: string, vehicle: { plate: string }, number: string | null, pdfStatus: string | null }
interface Detail { workOrder: { bookingId: string, code: string, version: number, status: string, customerName: string, vehicle: { plate: string } }, draft: { lines: CostLine[], serviceSubtotal: number, partSubtotal: number, total: number } }
interface Payment { id: string, invoiceId: string, number: string, total: number, received: number, change: number, method: string, reference: string, paidAt: string, pdfStatus: string }
const { request } = useAdmin()
const orders = ref<Order[]>([]), services = ref<{ id: string, name: string, price: number, active: boolean }[]>([])
const detail = ref<Detail>(), payment = ref<Payment | null>(null), lines = ref<CostLine[]>([]), method = ref('cash'), received = ref<number>(0), reference = ref(''), reason = ref('')
const error = ref(''), notice = ref(''), busy = ref(false), form = ref<HTMLFormElement>()
const pending = ref<{ url: string, body: Record<string, unknown> }>(), storageKey = 'cashier-payment'
const preview = computed(() => lines.value.reduce((sum, l) => sum + Number(l.quantity) * Number(l.unitPrice), 0))
let polling: ReturnType<typeof setInterval> | undefined
async function load() {
  try {
    const [list, catalog] = await Promise.all([$fetch<{ workOrders: Order[] }>('/api/admin/cashier'), $fetch<{ services: typeof services.value }>('/api/admin/services')])
    orders.value = list.workOrders; services.value = catalog.services.filter(s => s.active)
  } catch (e) { error.value = adminError(e) }
}
async function refreshPayment() {
  if (!detail.value || busy.value) return
  try { payment.value = (await $fetch<{ payment: Payment | null }>(`/api/admin/work-orders/${detail.value.workOrder.bookingId}/payment`)).payment }
  catch (e) { error.value = adminError(e) }
}
async function open(id: string) {
  if (busy.value || pending.value) return
  busy.value = true; error.value = ''; notice.value = ''
  try {
    const [d, p] = await Promise.all([$fetch<Detail>(`/api/admin/work-orders/${id}`), $fetch<{ payment: Payment | null }>(`/api/admin/work-orders/${id}/payment`)])
    detail.value = d; payment.value = p.payment; lines.value = d.draft.lines.map(l => ({ ...l })); received.value = d.draft.total
    method.value = 'cash'; reference.value = ''; reason.value = ''
  } catch (e) { error.value = adminError(e) }
  finally { busy.value = false }
}
async function settle() {
  if (busy.value) return
  if (!pending.value) {
    if (!detail.value || payment.value || !form.value?.reportValidity()) return
    pending.value = { url: `/api/admin/work-orders/${detail.value.workOrder.bookingId}/payment`, body: { version: detail.value.workOrder.version,
      idempotencyKey: crypto.randomUUID(), method: method.value, received: received.value, reference: reference.value, reason: reason.value, lines: lines.value.map(l => ({ ...l })) } }
    sessionStorage.setItem(storageKey, JSON.stringify(pending.value))
  }
  busy.value = true; error.value = ''; notice.value = ''
  try {
    const result = await request<{ payment: Payment, replayed: boolean }>(pending.value.url, 'POST', pending.value.body)
    payment.value = result.payment
    const id = pending.value.url.split('/')[4]!
    pending.value = undefined; sessionStorage.removeItem(storageKey)
    detail.value = await $fetch<Detail>(`/api/admin/work-orders/${id}`)
    notice.value = `Pembayaran LUNAS${result.replayed ? ' (transaksi yang sudah tercatat)' : ''}. Status servis: Siap Diambil / Transaksi Selesai. Penerbitan PDF diproses terpisah.`
    await load()
  } catch (e) {
    error.value = adminError(e)
    const status = (e as { status?: number, statusCode?: number }).status ?? (e as { statusCode?: number }).statusCode
    if (status && status >= 400 && status < 500) { pending.value = undefined; sessionStorage.removeItem(storageKey) }
  } finally { busy.value = false }
}
async function retryPdf() {
  if (!payment.value || busy.value) return
  busy.value = true; error.value = ''
  try {
    const result = await request<{ invoice: { status: string } }>(`/api/admin/invoices/${payment.value.invoiceId}/retry`, 'POST')
    payment.value.pdfStatus = result.invoice.status
    notice.value = 'Penerbitan PDF diperiksa / dijadwalkan ulang dari snapshot dan nomor yang sama. Pembayaran tetap LUNAS.'
  } catch (e) { error.value = adminError(e) }
  finally { busy.value = false }
}
watch(method, value => { if (value === 'cash') reference.value = '' })
onMounted(() => {
  const stored = sessionStorage.getItem(storageKey)
  if (stored) { try { pending.value = JSON.parse(stored) } catch { sessionStorage.removeItem(storageKey) } }
  void load()
  if (props.initialBookingId) void open(props.initialBookingId)
  polling = setInterval(() => { if (payment.value && payment.value.pdfStatus !== 'ready') void refreshPayment() }, 5000)
})
onBeforeUnmount(() => clearInterval(polling))
</script>

<template>
  <section>
    <div class="admin-header"><h2>Kasir / Invoice</h2><button :disabled="busy" @click="load">Perbarui daftar kasir</button></div>
    <p class="muted">Finalkan rincian aktual dan validasi pembayaran di tempat. QRIS statis dan EDC dicatat manual setelah dana dikonfirmasi. Transaksi LUNAS tidak dapat diedit.</p>
    <p v-if="error" role="alert" class="notice error">{{ error }}</p><p v-if="notice" data-payment-success role="status" class="notice success">{{ notice }}</p>
    <div v-if="pending" class="notice"><p>Hasil pelunasan belum dipastikan. Request asli disimpan sampai hasil diterima.</p><button data-retry-payment :disabled="busy" @click="settle">Periksa / ulangi request pembayaran yang sama</button></div>
    <div class="admin-columns section-actions">
      <section class="panel"><h3>Siap dibayar & transaksi terakhir</h3><p v-if="!orders.length">Belum ada servis selesai.</p><ul class="customer-list"><li v-for="w in orders" :key="w.id"><button :data-cashier-booking="w.id" :disabled="busy || Boolean(pending)" @click="open(w.id)"><strong>{{ w.code }} · {{ w.vehicle.plate }}</strong><br>{{ w.customerName }}<br>{{ w.status === 'collected' ? `LUNAS · ${w.number}` : 'Selesai dikerjakan · belum lunas' }}</button></li></ul></section>
      <section v-if="detail" class="panel">
        <div class="admin-header"><h3>{{ detail.workOrder.code }} · {{ detail.workOrder.vehicle.plate }}</h3><button data-reload-cashier :disabled="busy || Boolean(pending)" @click="open(detail.workOrder.bookingId)">Muat ulang rincian</button></div>
        <p>{{ detail.workOrder.customerName }} · {{ bookingStatus(detail.workOrder.status) }}</p>
        <section v-if="payment" data-paid-invoice>
          <h3>LUNAS · {{ payment.number }}</h3><p>Total server: <strong>{{ bookingMoney(payment.total) }}</strong></p><p>Diterima {{ bookingMoney(payment.received) }} · Kembalian {{ bookingMoney(payment.change) }}</p><p>{{ bookingTime(payment.paidAt) }} · {{ payment.method }} {{ payment.reference }}</p>
          <h4>Rincian aktual terkunci</h4>
          <ul><li v-for="(line, index) in detail.draft.lines" :key="index">{{ line.kind === 'service' ? 'Jasa' : 'Part' }} · {{ line.description }} · {{ line.quantity }} × {{ bookingMoney(line.unitPrice) }} = {{ bookingMoney(line.quantity * line.unitPrice) }}</li></ul>
          <p>Jasa {{ bookingMoney(detail.draft.serviceSubtotal) }} · Part {{ bookingMoney(detail.draft.partSubtotal) }}</p>
          <p data-pdf-status role="status">PDF: {{ ({ pending: 'Masih diproses', failed: 'Penerbitan gagal; pembayaran tetap LUNAS', ready: 'Siap dilihat / diunduh / dicetak' })[payment.pdfStatus] ?? payment.pdfStatus }}</p>
          <div v-if="payment.pdfStatus === 'ready'" class="actions"><a data-invoice-view :href="`/api/admin/invoices/${payment.invoiceId}/file`" target="_blank" rel="noopener">Lihat / cetak PDF</a><a :href="`/api/admin/invoices/${payment.invoiceId}/file?download=1`">Unduh PDF</a></div>
          <p v-if="payment.pdfStatus === 'ready'" class="muted">Buka PDF dan gunakan tombol cetak browser untuk kertas A4. Jika arsip hilang / rusak, terbitkan ulang dari snapshot.</p>
          <div class="actions section-actions"><button :disabled="busy" @click="refreshPayment">Perbarui status PDF</button><button data-retry-pdf :disabled="busy" @click="retryPdf">{{ payment.pdfStatus === 'ready' ? 'Pulihkan arsip PDF yang hilang / rusak' : 'Coba lagi penerbitan PDF' }}</button></div>
          <InvoiceDelivery :key="payment.invoiceId" :invoice-id="payment.invoiceId" :ready="payment.pdfStatus === 'ready'" />
        </section>
        <form v-else-if="detail.workOrder.status === 'completed'" ref="form" @submit.prevent="settle">
          <fieldset :disabled="busy || Boolean(pending)">
            <DraftCostEditor v-model="lines" :services="services" />
            <p>Total draft tersimpan di server: <strong>{{ bookingMoney(detail.draft.total) }}</strong></p>
            <p>Pratinjau final: {{ bookingMoney(preview) }} · Kembalian tunai sementara: {{ bookingMoney(method === 'cash' ? Math.max(0, Number(received) - preview) : 0) }}. Total dan kembalian final dihitung server saat validasi.</p>
            <label>Metode pembayaran<select v-model="method" name="paymentMethod"><option value="cash">Tunai</option><option value="qris">QRIS statis meja kasir</option><option value="edc">Kartu debit/kredit via EDC</option></select></label>
            <label>Nominal diterima (Rp)<input v-model.number="received" name="paymentReceived" type="number" min="1" max="2147483647" step="1" required></label>
            <label v-if="method !== 'cash'">Referensi transaksi QRIS/EDC<input v-model="reference" name="paymentReference" maxlength="100" required></label>
            <p v-if="method !== 'cash'" class="muted">Nominal harus tepat sebesar total. Isi referensi bukti transaksi; jangan masukkan nomor kartu atau PIN.</p>
            <label>Ringkasan finalisasi rincian / pembayaran<textarea v-model="reason" name="paymentReason" maxlength="500" required /></label>
            <p class="notice">Validasi berikut mengunci rincian dan mencatat LUNAS secara permanen. Pastikan nominal dan bukti pembayaran sudah diperiksa.</p>
            <button data-settle-payment class="primary" type="submit">Validasi pembayaran & terbitkan invoice</button>
          </fieldset>
        </form>
      </section><p v-else class="muted">Pilih servis selesai untuk finalisasi tagihan atau melihat invoice.</p>
    </div>
  </section>
</template>
