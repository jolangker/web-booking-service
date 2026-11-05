<script setup lang="ts">
const route = useRoute(), { read } = useHistory(), detail = ref<HistoryInvoice>(), error = ref(''), loading = ref(false)
const snapshot = computed(() => detail.value?.invoice.snapshot)
async function load() {
  loading.value = true; error.value = ''
  try { detail.value = await read(`/api/customer/invoices/${route.params.id}`) }
  catch (e) { error.value = adminError(e) }
  finally { loading.value = false }
}
onMounted(load)
</script>

<template>
  <main class="admin customer-account invoice-detail">
    <p><NuxtLink to="/history">Buku servis</NuxtLink><template v-if="detail"> · <NuxtLink :to="`/history/${detail.visit.vehicleId}`">Riwayat kendaraan</NuxtLink></template></p>
    <h1>Detail servis & invoice</h1><p v-if="loading" role="status">Memuat arsip…</p><p v-if="error" class="notice error" role="alert">{{ error }}</p><button v-if="error" @click="load">Coba lagi</button>
    <template v-if="detail && snapshot">
      <section class="panel" data-customer-invoice><h2>{{ snapshot.number }}</h2><p><strong>LUNAS · {{ bookingMoney(snapshot.total) }}</strong></p>
        <p>{{ bookingTime(snapshot.paidAt) }} · {{ snapshot.bookingCode }}</p><p>{{ snapshot.workshop.name }} · {{ snapshot.workshop.address }} · {{ snapshot.workshop.phone }}</p>
        <p>Jadwal kunjungan: {{ bookingTime(detail.visit.scheduledAt) }} · Diterima: {{ bookingTime(detail.visit.receivedAt) }}</p>
        <p>{{ snapshot.customer.name }} · {{ snapshot.customer.phone }}</p>
        <p>{{ snapshot.vehicle.plate }} · {{ snapshot.vehicle.brand }} {{ snapshot.vehicle.model }} · {{ snapshot.vehicle.year }} · {{ snapshot.odometer }} km</p>
        <h3>Pekerjaan aktual</h3><p class="booking-complaint">Keluhan: {{ detail.visit.complaint }}</p><p class="booking-complaint">Kondisi awal: {{ detail.visit.initialCondition }}</p>
        <p class="booking-complaint">Diagnosis: {{ detail.visit.diagnosis }}</p><p class="booking-complaint">Pemeriksaan: {{ detail.visit.inspection }}</p><p class="booking-complaint">Hasil: {{ snapshot.notes }}</p>
        <h3>Jasa & komponen aktual</h3><ul class="booking-list"><li v-for="(line, index) in snapshot.lines" :key="index" class="invoice-line"><strong>{{ line.description }}</strong><span>{{ line.kind === 'part' ? 'Komponen' : 'Jasa' }} · {{ line.quantity }} × {{ bookingMoney(line.unitPrice) }} = {{ bookingMoney(line.quantity * line.unitPrice) }}</span></li></ul>
        <p>Subtotal jasa {{ bookingMoney(snapshot.serviceSubtotal) }} · Komponen {{ bookingMoney(snapshot.partSubtotal) }}</p>
        <p>Metode: {{ ({ cash: 'Tunai', qris: 'QRIS statis', edc: 'Kartu via EDC' })[snapshot.method] }} {{ snapshot.reference }}</p><p>Diterima {{ bookingMoney(snapshot.received) }} · Kembalian {{ bookingMoney(snapshot.change) }}</p>
        <h3>Timeline kunjungan</h3><ol><li v-for="(h, index) in detail.visit.history" :key="index">{{ bookingAction(h.action) }} · {{ bookingTime(h.occurredAt) }}</li></ol>
      </section>
      <section class="panel"><h2>Invoice PDF</h2><p>Membaca riwayat tidak mengunduh PDF.</p>
        <div v-if="detail.invoice.status === 'ready'" class="actions"><a data-customer-pdf :href="`/api/customer/invoices/${detail.invoice.id}/file`" target="_blank" rel="noopener">Lihat / cetak PDF</a><a data-customer-download :href="`/api/customer/invoices/${detail.invoice.id}/file?download=1`">Unduh PDF</a></div>
        <p v-else role="status">{{ detail.invoice.status === 'failed' ? 'Penerbitan PDF gagal. Hubungi Admin untuk pemulihan.' : 'PDF sedang diproses. Perbarui status beberapa saat lagi.' }} Pembayaran tetap LUNAS.</p>
        <p class="muted">Untuk mencetak, buka PDF dan gunakan tombol cetak browser dengan kertas A4. Jika file tidak tersedia, hubungi Admin; arsip transaksi tetap tersimpan.</p><button :disabled="loading" @click="load">Perbarui status PDF</button>
      </section>
    </template>
  </main>
</template>
