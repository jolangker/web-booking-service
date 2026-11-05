<script setup lang="ts">
import type { OperationalReport } from '@booking/core'
const mode = ref('daily'), period = ref(new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Jakarta', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date()))
const report = ref<OperationalReport>(), error = ref(''), busy = ref(false), visitPage = ref(1), paymentPage = ref(1)
const methodNames = { cash: 'Tunai', qris: 'QRIS', edc: 'EDC' }
watch(mode, value => { period.value = value === 'monthly' ? period.value.slice(0, 7) : `${period.value}-01` })
watch([mode, period], () => { report.value = undefined; error.value = ''; visitPage.value = 1; paymentPage.value = 1 })
async function load(visits = 1, payments = 1) {
  if (busy.value) return
  busy.value = true; error.value = ''; visitPage.value = visits; paymentPage.value = payments
  try { report.value = await $fetch<OperationalReport>('/api/admin/reports', { query: { mode: mode.value, period: period.value, visitPage: visits, paymentPage: payments } }) }
  catch (e) { error.value = adminError(e); report.value = undefined }
  finally { busy.value = false }
}
onMounted(() => load())
</script>

<template>
  <section data-reports :aria-busy="busy">
    <h2>Laporan operasional</h2>
    <p class="muted">Asia/Jakarta (WIB), pukul 00.00 hingga sebelum 00.00 hari / bulan berikutnya.</p>
    <form class="panel" @submit.prevent="load()">
      <fieldset :disabled="busy" class="form-row">
        <label>Jenis periode<select v-model="mode" name="reportMode"><option value="daily">Harian</option><option value="monthly">Bulanan</option></select></label>
        <label>{{ mode === 'daily' ? 'Tanggal (WIB)' : 'Bulan (WIB)' }}<input v-model="period" name="reportPeriod" :type="mode === 'daily' ? 'date' : 'month'" :placeholder="mode === 'daily' ? 'YYYY-MM-DD' : 'YYYY-MM'" required></label>
        <button class="primary" data-load-report type="submit">Tampilkan laporan</button>
      </fieldset>
    </form>
    <p class="muted">Kunjungan mengikuti waktu check-in, termasuk servis belum lunas; booking batal dan belum check-in tidak dihitung. Kendaraan unik dihitung berdasarkan ID kendaraan dalam periode check-in, sehingga kendaraan yang kembali hanya dihitung sekali.</p>
    <p class="muted">Pendapatan mengikuti waktu pembayaran tervalidasi (LUNAS), terpisah dari waktu servis. Total = jasa + part aktual pada invoice (tunai: uang diterima dikurangi kembalian). Estimasi belum lunas bukan pendapatan. Status PDF / pengiriman invoice tidak memengaruhi hitungan.</p>
    <p v-if="busy" role="status">Memuat laporan…</p>
    <div v-else-if="error" class="notice error"><p role="alert">{{ error }}</p><button @click="load(visitPage, paymentPage)">Coba lagi</button></div>
    <template v-else-if="report">
      <p data-report-period>Periode {{ report.period.period }} · {{ report.period.mode === 'daily' ? 'Harian' : 'Bulanan' }} · WIB</p>
      <div class="reception-summary" data-report-summary>
        <p>Kunjungan (check-in)<strong data-report-visits>{{ report.summary.visits }}</strong></p>
        <p>Kendaraan unik (check-in)<strong data-report-vehicles>{{ report.summary.uniqueVehicles }}</strong></p>
        <p>Transaksi LUNAS (waktu bayar)<strong data-report-transactions>{{ report.summary.transactions }}</strong></p>
        <p>Pendapatan (waktu bayar)<strong data-report-total>{{ bookingMoney(report.summary.total) }}</strong></p>
      </div>
      <p v-if="!report.summary.visits && !report.summary.transactions" data-report-empty class="notice">Tidak ada kunjungan atau pembayaran pada periode ini.</p>
      <section class="panel section-actions">
        <h3>Rekap pendapatan per metode pembayaran</h3>
        <p>Total jasa: <strong data-report-service>{{ bookingMoney(report.summary.serviceSubtotal) }}</strong> · Total part: <strong data-report-part>{{ bookingMoney(report.summary.partSubtotal) }}</strong></p>
        <p v-if="!report.methods.length">Belum ada pembayaran LUNAS pada periode ini.</p>
        <div v-else class="table-scroll" tabindex="0" role="region" aria-label="Rekap metode pembayaran">
          <table><caption class="sr-only">Rekap seluruh pembayaran LUNAS dalam periode, tidak terbatas halaman rincian</caption><thead><tr><th scope="col">Metode</th><th scope="col">Transaksi</th><th scope="col">Jasa</th><th scope="col">Part</th><th scope="col">Total</th></tr></thead>
            <tbody><tr v-for="m in report.methods" :key="m.method"><th scope="row">{{ methodNames[m.method] }}</th><td>{{ m.transactions }}</td><td>{{ bookingMoney(m.serviceSubtotal) }}</td><td>{{ bookingMoney(m.partSubtotal) }}</td><td>{{ bookingMoney(m.total) }}</td></tr></tbody>
          </table>
        </div>
      </section>
      <section class="panel section-actions">
        <h3>Rincian transaksi · berdasarkan waktu bayar WIB</h3>
        <p v-if="!report.payments.length">Tidak ada transaksi pada halaman ini.</p>
        <div v-else class="table-scroll" tabindex="0" role="region" aria-label="Rincian transaksi">
          <table class="report-transactions"><caption class="sr-only">Setiap baris adalah satu pembayaran; buka invoice untuk memeriksa rincian sumber</caption><thead><tr><th scope="col">Invoice / kendaraan</th><th scope="col">Waktu bayar</th><th scope="col">Metode / referensi</th><th scope="col">Jasa</th><th scope="col">Part</th><th scope="col">Total</th></tr></thead>
            <tbody><tr v-for="p in report.payments" :key="p.paymentId" :data-report-payment="p.paymentId"><th scope="row"><NuxtLink :to="{ path: '/admin', query: { tab: 'cashier', booking: p.bookingId } }">{{ p.number }}</NuxtLink><br>{{ p.vehicle.plate }}</th><td>{{ bookingTime(p.paidAt) }}</td><td>{{ methodNames[p.method] }}<br>{{ p.reference || '—' }}</td><td>{{ bookingMoney(p.serviceSubtotal) }}</td><td>{{ bookingMoney(p.partSubtotal) }}</td><td>{{ bookingMoney(p.total) }}</td></tr></tbody>
          </table>
        </div>
        <nav class="actions section-actions" aria-label="Halaman transaksi"><button data-payment-prev :disabled="report.period.paymentPage <= 1" @click="load(report.period.visitPage, report.period.paymentPage - 1)">Transaksi sebelumnya</button><span>Halaman {{ report.period.paymentPage }} · {{ report.summary.transactions }} transaksi</span><button data-payment-next :disabled="report.period.paymentPage * report.period.pageSize >= report.summary.transactions" @click="load(report.period.visitPage, report.period.paymentPage + 1)">Transaksi berikutnya</button></nav>
      </section>
      <section class="panel section-actions">
        <h3>Rincian kunjungan · berdasarkan waktu check-in WIB</h3>
        <p v-if="!report.visits.length">Tidak ada kunjungan pada halaman ini.</p>
        <div v-else class="table-scroll" tabindex="0" role="region" aria-label="Rincian kunjungan">
          <table><caption class="sr-only">Satu baris per kunjungan; kendaraan dapat kembali dalam periode yang sama</caption><thead><tr><th scope="col">Booking / WO</th><th scope="col">Kendaraan</th><th scope="col">Check-in</th><th scope="col">Status saat ini</th></tr></thead>
            <tbody><tr v-for="v in report.visits" :key="v.bookingId" :data-report-visit="v.bookingId"><th scope="row"><NuxtLink :to="{ path: '/admin', query: { tab: v.status === 'collected' ? 'cashier' : 'progress', booking: v.bookingId } }">{{ v.code }}</NuxtLink></th><td>{{ v.vehicle.plate }}</td><td>{{ bookingTime(v.checkedInAt) }}</td><td>{{ bookingStatus(v.status) }}</td></tr></tbody>
          </table>
        </div>
        <nav class="actions section-actions" aria-label="Halaman kunjungan"><button data-visit-prev :disabled="report.period.visitPage <= 1" @click="load(report.period.visitPage - 1, report.period.paymentPage)">Kunjungan sebelumnya</button><span>Halaman {{ report.period.visitPage }} · {{ report.summary.visits }} kunjungan</span><button data-visit-next :disabled="report.period.visitPage * report.period.pageSize >= report.summary.visits" @click="load(report.period.visitPage + 1, report.period.paymentPage)">Kunjungan berikutnya</button></nav>
      </section>
      <p class="muted">Ringkasan mencakup seluruh periode; rincian maksimal 50 baris per halaman. Dibaca ulang saat memilih halaman atau menampilkan laporan.</p>
    </template>
  </section>
</template>

<style scoped>
.reception-summary strong { font-size: clamp(1.15rem, 2vw, 1.7rem); overflow-wrap: anywhere; }
td { overflow-wrap: anywhere; }
.report-transactions { min-width: 900px; }
.report-transactions td:nth-child(n + 4) { white-space: nowrap; }
</style>
